import {
  type AiProviderType,
  type AiResolvedRoute,
  decryptApiKey,
  type KeyPoolEntry,
} from "@whatsapp-platform/ai-gateway";
import type { PrismaClient } from "./generated/prisma/client";

export type AiRoutingDatabase = Pick<
  PrismaClient,
  "aiVirtualAlias" | "aiModelRoute" | "aiProviderConfig" | "aiKeyPool" | "tenant" | "$transaction"
>;

export interface CreateModelRouteInput {
  providerConfigId: string;
  targetModelId: string;
  priority?: number | undefined;
  timeoutMs?: number | undefined;
  maxRetries?: number | undefined;
  isEnabled?: boolean | undefined;
}

export interface CreateVirtualAliasInput {
  tenantId?: string | null | undefined;
  aliasKey: string;
  name: string;
  description?: string | null | undefined;
  routes?: readonly CreateModelRouteInput[] | undefined;
}

export interface UpdateVirtualAliasRoutesInput {
  aliasId: string;
  tenantId?: string | null | undefined;
  routes: readonly CreateModelRouteInput[];
}

export interface ResolveRoutesForAliasInput {
  tenantId: string | null;
  aliasKey: string;
  encryptionSecret: string | Uint8Array;
}

export interface ResolvedVirtualAlias {
  aliasId: string;
  aliasKey: string;
  name: string;
  description: string | null;
  tenantId: string | null;
  isOverride: boolean;
  routes: readonly AiResolvedRoute[];
}

export interface VirtualAliasListItem {
  id: string;
  tenantId: string | null;
  aliasKey: string;
  name: string;
  description: string | null;
  isOverride: boolean;
  routesCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export class VirtualAliasNotFoundError extends Error {
  override readonly name = "VirtualAliasNotFoundError";
}

export class VirtualAliasConflictError extends Error {
  override readonly name = "VirtualAliasConflictError";
}

export async function createVirtualAlias(
  db: AiRoutingDatabase,
  input: CreateVirtualAliasInput,
): Promise<{ id: string; aliasKey: string; tenantId: string | null }> {
  const existing = await db.aiVirtualAlias.findFirst({
    where: {
      tenantId: input.tenantId ?? null,
      aliasKey: input.aliasKey,
    },
    select: { id: true },
  });

  if (existing) {
    throw new VirtualAliasConflictError(
      `Virtual alias '${input.aliasKey}' already exists for ${input.tenantId ? `tenant ${input.tenantId}` : "platform"}`,
    );
  }

  const created = await db.aiVirtualAlias.create({
    data: {
      tenantId: input.tenantId ?? null,
      aliasKey: input.aliasKey,
      name: input.name,
      description: input.description ?? null,
      ...(input.routes && input.routes.length > 0
        ? {
            routes: {
              create: input.routes.map((r, index) => ({
                providerConfigId: r.providerConfigId,
                targetModelId: r.targetModelId,
                priority: r.priority ?? index + 1,
                timeoutMs: r.timeoutMs ?? 10000,
                maxRetries: r.maxRetries ?? 2,
                isEnabled: r.isEnabled ?? true,
              })),
            },
          }
        : {}),
    },
    select: {
      id: true,
      aliasKey: true,
      tenantId: true,
    },
  });

  return created;
}

export async function updateVirtualAliasRoutes(
  db: AiRoutingDatabase,
  input: UpdateVirtualAliasRoutesInput,
): Promise<void> {
  const alias = await db.aiVirtualAlias.findUnique({
    where: { id: input.aliasId },
    select: { id: true, tenantId: true },
  });

  if (!alias) {
    throw new VirtualAliasNotFoundError(`Virtual alias ${input.aliasId} not found`);
  }

  if (input.tenantId !== undefined && alias.tenantId !== input.tenantId) {
    throw new VirtualAliasNotFoundError(
      `Virtual alias ${input.aliasId} not found in tenant context`,
    );
  }

  await db.aiModelRoute.deleteMany({
    where: { virtualAliasId: input.aliasId },
  });

  if (input.routes.length > 0) {
    await db.aiModelRoute.createMany({
      data: input.routes.map((r, index) => ({
        virtualAliasId: input.aliasId,
        providerConfigId: r.providerConfigId,
        targetModelId: r.targetModelId,
        priority: r.priority ?? index + 1,
        timeoutMs: r.timeoutMs ?? 10000,
        maxRetries: r.maxRetries ?? 2,
        isEnabled: r.isEnabled ?? true,
      })),
    });
  }
}

export async function resolveRoutesForAlias(
  db: AiRoutingDatabase,
  input: ResolveRoutesForAliasInput,
): Promise<ResolvedVirtualAlias | null> {
  // 1. Try resolving tenant override alias first (if tenantId provided)
  let aliasRecord = input.tenantId
    ? await db.aiVirtualAlias.findFirst({
        where: {
          tenantId: input.tenantId,
          aliasKey: input.aliasKey,
        },
        include: {
          routes: {
            where: { isEnabled: true },
            orderBy: { priority: "asc" },
            include: {
              providerConfig: {
                include: {
                  keyPool: true,
                },
              },
            },
          },
        },
      })
    : null;

  let isOverride = true;

  // 2. If no tenant override exists, resolve platform global alias
  if (!aliasRecord) {
    aliasRecord = await db.aiVirtualAlias.findFirst({
      where: {
        tenantId: null,
        aliasKey: input.aliasKey,
      },
      include: {
        routes: {
          where: { isEnabled: true },
          orderBy: { priority: "asc" },
          include: {
            providerConfig: {
              include: {
                keyPool: true,
              },
            },
          },
        },
      },
    });
    isOverride = false;
  }

  if (!aliasRecord) {
    return null;
  }

  const resolvedRoutes: AiResolvedRoute[] = [];

  for (const route of aliasRecord.routes) {
    if (!route.providerConfig.isEnabled) {
      continue;
    }

    const keys: KeyPoolEntry[] = [];
    for (const key of route.providerConfig.keyPool) {
      let rawApiKey: string | undefined;
      try {
        rawApiKey = decryptApiKey(key.encryptedKey, input.encryptionSecret);
      } catch {
        // If decryption fails, skip this key
        continue;
      }

      keys.push({
        id: key.id,
        providerConfigId: key.providerConfigId,
        encryptedKey: key.encryptedKey,
        rawApiKey,
        keyMask: key.keyMask,
        status: key.status,
        rateLimitedUntil: key.rateLimitedUntil,
        priority: key.priority,
        totalCalls: key.totalCalls,
      });
    }

    resolvedRoutes.push({
      routeId: route.id,
      targetModelId: route.targetModelId,
      priority: route.priority,
      timeoutMs: route.timeoutMs,
      maxRetries: route.maxRetries,
      providerType: route.providerConfig.providerType as AiProviderType,
      baseUrl: route.providerConfig.baseUrl,
      keys,
      providerConfigId: route.providerConfig.id,
    });
  }

  return {
    aliasId: aliasRecord.id,
    aliasKey: aliasRecord.aliasKey,
    name: aliasRecord.name,
    description: aliasRecord.description,
    tenantId: aliasRecord.tenantId,
    isOverride,
    routes: resolvedRoutes,
  };
}

export async function listTenantAliases(
  db: AiRoutingDatabase,
  tenantId: string,
): Promise<VirtualAliasListItem[]> {
  const records = await db.aiVirtualAlias.findMany({
    where: {
      OR: [{ tenantId }, { tenantId: null }],
    },
    include: {
      routes: {
        select: { id: true },
      },
    },
    orderBy: [{ aliasKey: "asc" }, { tenantId: "desc" }],
  });

  return records.map((r) => ({
    id: r.id,
    tenantId: r.tenantId,
    aliasKey: r.aliasKey,
    name: r.name,
    description: r.description,
    isOverride: r.tenantId !== null,
    routesCount: r.routes.length,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

export async function seedDefaultPlatformAliases(
  db: AiRoutingDatabase,
  platformProviderConfigId: string,
): Promise<void> {
  const defaults = [
    {
      aliasKey: "platform-fast",
      name: "Modelo Rápido (Triage)",
      description:
        "Modelo optimizado para clasificación, enrutamiento y respuestas de baja latencia",
      targetModelId: "mock-fast-model",
      timeoutMs: 10000,
      maxRetries: 2,
    },
    {
      aliasKey: "platform-smart",
      name: "Modelo Inteligente (Smart Reply)",
      description: "Modelo equilibrado para generación conversacional y asistencia a operadores",
      targetModelId: "mock-smart-model",
      timeoutMs: 15000,
      maxRetries: 2,
    },
    {
      aliasKey: "platform-reasoning",
      name: "Modelo de Razonamiento (Análisis Profundo)",
      description: "Modelo avanzado con capacidad de razonamiento para casos complejos",
      targetModelId: "mock-reasoning-model",
      timeoutMs: 30000,
      maxRetries: 2,
    },
  ];

  for (const def of defaults) {
    const existing = await db.aiVirtualAlias.findFirst({
      where: {
        tenantId: null,
        aliasKey: def.aliasKey,
      },
      select: { id: true },
    });

    if (!existing) {
      await db.aiVirtualAlias.create({
        data: {
          tenantId: null,
          aliasKey: def.aliasKey,
          name: def.name,
          description: def.description,
          routes: {
            create: [
              {
                providerConfigId: platformProviderConfigId,
                targetModelId: def.targetModelId,
                priority: 1,
                timeoutMs: def.timeoutMs,
                maxRetries: def.maxRetries,
                isEnabled: true,
              },
            ],
          },
        },
      });
    } else {
      const activeRouteCount = await db.aiModelRoute.count({
        where: { virtualAliasId: existing.id, isEnabled: true },
      });
      if (activeRouteCount === 0) {
        await db.aiModelRoute.create({
          data: {
            virtualAliasId: existing.id,
            providerConfigId: platformProviderConfigId,
            targetModelId: def.targetModelId,
            priority: 1,
            timeoutMs: def.timeoutMs,
            maxRetries: def.maxRetries,
            isEnabled: true,
          },
        });
      }
    }
  }
}
