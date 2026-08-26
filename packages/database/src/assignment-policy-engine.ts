import type { PrismaClient } from "./generated/prisma/client";
import {
  ActiveTenantUserNotFoundError,
  createInboxMutationManager,
  type InboxMutationManagerDatabase,
} from "./inbox-mutation-manager";
import { OrganizationUnitNotFoundError } from "./organization-unit-manager";
import { ConversationNotFoundError } from "./outbound-conversation-message-manager";
import { createTenantContext, type TenantContext } from "./tenant-context";
import { assertTenantModuleEntitled } from "./tenant-entitlements";
import { assertTenantOperational } from "./tenant-operational";

export const ASSIGNMENT_POLICIES = ["ROUND_ROBIN", "LEAST_BUSY", "STICKY_AGENT"] as const;
export type AssignmentPolicy = (typeof ASSIGNMENT_POLICIES)[number];

export class InvalidAssignmentPolicyError extends Error {
  override readonly name = "InvalidAssignmentPolicyError";

  constructor(readonly invalidPolicy: string) {
    super(`Invalid assignment policy: ${invalidPolicy}`);
  }
}

export type AssignmentPolicyOptions = Readonly<{
  unitId?: string;
  requestId?: string;
  actorId?: string;
}>;

export type AssignmentPolicyResult = Readonly<{
  assignedUserId: string | null;
  policyUsed: AssignmentPolicy;
}>;

export type AssignmentPolicyEngineDatabase = InboxMutationManagerDatabase &
  Pick<PrismaClient, "conversation" | "user" | "organizationUnit" | "auditLog" | "message">;

export interface AssignmentPolicyEngine {
  resolveAssignmentByPolicy(
    context: TenantContext,
    conversationId: string,
    policy: AssignmentPolicy,
    options?: AssignmentPolicyOptions,
  ): Promise<AssignmentPolicyResult>;
}

export function createAssignmentPolicyEngine(
  database: AssignmentPolicyEngineDatabase,
): AssignmentPolicyEngine {
  const resolveAssignmentByPolicy = async (
    context: TenantContext,
    conversationId: string,
    policy: AssignmentPolicy,
    options?: AssignmentPolicyOptions,
  ): Promise<AssignmentPolicyResult> => {
    if (!ASSIGNMENT_POLICIES.includes(policy)) {
      throw new InvalidAssignmentPolicyError(String(policy));
    }

    const tenant = createTenantContext(context.tenantId);
    await assertTenantOperational(tenant, database);
    await assertTenantModuleEntitled(tenant, "module.messaging.basic", database);
    await assertTenantModuleEntitled(tenant, "module.crm_lite", database);

    const conv = await database.conversation.findUnique({
      select: {
        assignedUnitId: true,
        assignedUserId: true,
        channelAccountId: true,
        contactId: true,
        id: true,
        tenantId: true,
      },
      where: { tenantId_id: { id: conversationId, tenantId: tenant.tenantId } },
    });

    if (conv === null) {
      throw new ConversationNotFoundError();
    }

    if (options?.unitId) {
      const unit = await database.organizationUnit.findFirst({
        select: { id: true },
        where: { active: true, id: options.unitId, tenantId: tenant.tenantId },
      });
      if (unit === null) {
        throw new OrganizationUnitNotFoundError();
      }
    }

    const eligibleUsers = await database.user.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
      where: {
        status: "active",
        tenantId: tenant.tenantId,
        ...(options?.unitId
          ? {
              roleAssignments: {
                some: {
                  organizationUnitId: options.unitId,
                },
              },
            }
          : {}),
      },
    });

    if (eligibleUsers.length === 0) {
      return {
        assignedUserId: null,
        policyUsed: policy,
      };
    }

    let selectedUser = eligibleUsers[0];

    if (policy === "ROUND_ROBIN") {
      const lastAssignedConv = await database.conversation.findFirst({
        orderBy: { updatedAt: "desc" },
        select: { assignedUserId: true },
        where: {
          assignedUserId: { in: eligibleUsers.map((u) => u.id) },
          tenantId: tenant.tenantId,
          ...(options?.unitId ? { assignedUnitId: options.unitId } : {}),
        },
      });

      if (lastAssignedConv?.assignedUserId) {
        const lastIdx = eligibleUsers.findIndex((u) => u.id === lastAssignedConv.assignedUserId);
        if (lastIdx >= 0) {
          selectedUser = eligibleUsers[(lastIdx + 1) % eligibleUsers.length];
        }
      }
    } else if (policy === "LEAST_BUSY") {
      const openCounts = await database.conversation.groupBy({
        by: ["assignedUserId"],
        where: {
          assignedUserId: { in: eligibleUsers.map((u) => u.id) },
          status: "open",
          tenantId: tenant.tenantId,
        },
        _count: { id: true },
      });

      const countMap = new Map<string, number>();
      for (const item of openCounts) {
        if (item.assignedUserId) {
          countMap.set(item.assignedUserId, item._count.id);
        }
      }

      let minCount = Infinity;
      for (const user of eligibleUsers) {
        const count = countMap.get(user.id) ?? 0;
        if (count < minCount) {
          minCount = count;
          selectedUser = user;
        }
      }
    } else if (policy === "STICKY_AGENT") {
      const previousContactConv = await database.conversation.findFirst({
        orderBy: { updatedAt: "desc" },
        select: { assignedUserId: true },
        where: {
          assignedUserId: { not: null },
          contactId: conv.contactId,
          id: { not: conv.id },
          tenantId: tenant.tenantId,
        },
      });

      const stickyUserId = previousContactConv?.assignedUserId;
      const stickyUser = stickyUserId
        ? eligibleUsers.find((u) => u.id === stickyUserId)
        : undefined;

      if (stickyUser) {
        selectedUser = stickyUser;
      } else {
        const openCounts = await database.conversation.groupBy({
          by: ["assignedUserId"],
          where: {
            assignedUserId: { in: eligibleUsers.map((u) => u.id) },
            status: "open",
            tenantId: tenant.tenantId,
          },
          _count: { id: true },
        });

        const countMap = new Map<string, number>();
        for (const item of openCounts) {
          if (item.assignedUserId) {
            countMap.set(item.assignedUserId, item._count.id);
          }
        }

        let minCount = Infinity;
        for (const user of eligibleUsers) {
          const count = countMap.get(user.id) ?? 0;
          if (count < minCount) {
            minCount = count;
            selectedUser = user;
          }
        }
      }
    }

    if (!selectedUser) {
      throw new ActiveTenantUserNotFoundError();
    }

    const mutationManager = createInboxMutationManager(database);
    const actorId = options?.actorId ?? selectedUser.id;

    await mutationManager.assignConversation(
      tenant,
      conversationId,
      actorId,
      {
        assignedUnitId: options?.unitId ?? null,
        assignedUserId: selectedUser.id,
      },
      options?.requestId ?? "auto-assignment-policy",
    );

    return {
      assignedUserId: selectedUser.id,
      policyUsed: policy,
    };
  };

  return Object.freeze({ resolveAssignmentByPolicy });
}

export async function resolveAssignmentByPolicy(
  tenantContext: TenantContext,
  conversationId: string,
  policy: AssignmentPolicy,
  options?: AssignmentPolicyOptions,
  database?: AssignmentPolicyEngineDatabase,
): Promise<AssignmentPolicyResult> {
  if (!database) {
    throw new Error("Database client is required for resolveAssignmentByPolicy");
  }
  const engine = createAssignmentPolicyEngine(database);
  return engine.resolveAssignmentByPolicy(tenantContext, conversationId, policy, options);
}
