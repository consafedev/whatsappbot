import { type AuditLog, Prisma } from "./generated/prisma/client";

export type AuditEntryInput = Readonly<{
  actorType: string;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  organizationUnitId?: string | null;
  beforeSummary?: Prisma.InputJsonValue | null;
  afterSummary?: Prisma.InputJsonValue | null;
  requestId: string;
  ipMetadata?: Prisma.InputJsonValue | null;
}>;

export interface AuditWriter {
  append(entry: AuditEntryInput): Promise<AuditLog>;
}

export type AuditDatabaseClient = Pick<Prisma.TransactionClient, "auditLog">;

export function auditCreateData(
  input: AuditEntryInput,
  tenantId: string | null,
): Prisma.AuditLogUncheckedCreateInput {
  const data: Prisma.AuditLogUncheckedCreateInput = {
    action: input.action,
    actorType: input.actorType,
    entityId: input.entityId,
    entityType: input.entityType,
    requestId: input.requestId,
    tenantId,
  };

  if (input.actorId !== undefined) data.actorId = input.actorId;
  if (input.organizationUnitId !== undefined) data.organizationUnitId = input.organizationUnitId;
  if (input.beforeSummary !== undefined)
    data.beforeSummary = input.beforeSummary === null ? Prisma.DbNull : input.beforeSummary;
  if (input.afterSummary !== undefined)
    data.afterSummary = input.afterSummary === null ? Prisma.DbNull : input.afterSummary;
  if (input.ipMetadata !== undefined)
    data.ipMetadata = input.ipMetadata === null ? Prisma.DbNull : input.ipMetadata;

  return data;
}
