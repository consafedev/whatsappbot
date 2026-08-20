import { type Contact, Prisma } from "./generated/prisma/client";
import { normalizePhoneNumber } from "./phone-utils";
import { createTenantContext, type TenantContext } from "./tenant-context";
import { createTenantDataAccess, type TenantTransactionDatabase } from "./tenant-data-access";
import { assertTenantOperational } from "./tenant-operational";

export const CONTACT_STATUSES = ["ACTIVE", "BLOCKED", "ARCHIVED"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export type ContactItem = Readonly<{
  id: string;
  tenantId: string;
  name: string;
  phoneNumber: string;
  email: string | null;
  avatarUrl: string | null;
  status: ContactStatus;
  tags: readonly string[];
  customAttributes: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type ContactCreateInput = Readonly<{
  name?: string;
  phoneNumber: string;
  email?: string | null;
  avatarUrl?: string | null;
  status?: ContactStatus;
  tags?: readonly string[];
  customAttributes?: Prisma.InputJsonValue | null;
}>;

export type ContactUpdateInput = Readonly<{
  name?: string;
  email?: string | null;
  avatarUrl?: string | null;
  status?: ContactStatus;
  tags?: readonly string[];
  customAttributes?: Prisma.InputJsonValue | null;
}>;

export type ContactListOptions = Readonly<{
  search?: string;
  tag?: string;
  status?: ContactStatus;
  page?: number;
  limit?: number;
}>;

export type ContactPage = Readonly<{
  items: readonly ContactItem[];
  page: number;
  limit: number;
  total: number;
}>;

export type ContactMutationMetadata = Readonly<{
  actorUserId?: string | null;
  requestId?: string;
}>;

export type ContactManagerDatabase = TenantTransactionDatabase &
  Pick<Prisma.TransactionClient, "contact" | "tenant">;
export type ContactTransaction = Prisma.TransactionClient;

export class ContactNotFoundError extends Error {
  override readonly name = "ContactNotFoundError";

  constructor() {
    super("Contact was not found");
  }
}

export class ContactPhoneConflictError extends Error {
  override readonly name = "ContactPhoneConflictError";

  constructor() {
    super("A contact already uses this phone number");
  }
}

export class ContactValidationError extends Error {
  override readonly name = "ContactValidationError";
}

const DEFAULT_METADATA: Required<ContactMutationMetadata> = {
  actorUserId: null,
  requestId: "contact-manager",
};

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function cleanString(value: string, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new ContactValidationError(`Invalid ${field}`);
  const result = value.trim();
  if (result.length === 0 || result.length > maxLength) {
    throw new ContactValidationError(`Invalid ${field}`);
  }
  return result;
}

function contactName(value: string | undefined): string {
  return value === undefined ? "Sin Nombre" : cleanString(value, "contact name", 160);
}

function contactEmail(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const result = cleanString(value, "contact email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) {
    throw new ContactValidationError("Invalid contact email");
  }
  return result;
}

function contactAvatarUrl(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const result = cleanString(value, "contact avatar URL", 2048);
  let parsed: URL;
  try {
    parsed = new URL(result);
  } catch {
    throw new ContactValidationError("Invalid contact avatar URL");
  }
  if (parsed.protocol !== "https:") {
    throw new ContactValidationError("Contact avatar URL must use HTTPS");
  }
  return result;
}

function contactStatus(value: ContactStatus | undefined): ContactStatus | undefined {
  if (value === undefined) return undefined;
  if (!CONTACT_STATUSES.includes(value)) throw new ContactValidationError("Invalid contact status");
  return value;
}

function contactTags(value: readonly string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 50) {
    throw new ContactValidationError("Invalid contact tags");
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const tag of value) {
    const normalized = cleanString(tag, "contact tag", 50);
    const key = normalized.toLocaleLowerCase("en-US");
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }
  return result;
}

function contactAttributes(
  value: Prisma.InputJsonValue | null | undefined,
): Prisma.InputJsonValue | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ContactValidationError("Contact customAttributes must be an object");
  }
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 64 * 1024) {
    throw new ContactValidationError("Contact customAttributes are too large");
  }
  return value;
}

function contactItem(contact: Contact): ContactItem {
  return {
    avatarUrl: contact.avatarUrl,
    createdAt: contact.createdAt,
    customAttributes: contact.customAttributes,
    email: contact.email,
    id: contact.id,
    name: contact.name,
    phoneNumber: contact.phoneNumber,
    status: contact.status as ContactStatus,
    tags: contact.tags,
    tenantId: contact.tenantId,
    updatedAt: contact.updatedAt,
  };
}

function summary(contact: ContactItem): Prisma.InputJsonValue {
  return {
    email: contact.email,
    name: contact.name,
    phoneNumber: contact.phoneNumber,
    status: contact.status,
    tags: [...contact.tags],
  };
}

function requestMetadata(metadata?: ContactMutationMetadata): Required<ContactMutationMetadata> {
  return {
    actorUserId: metadata?.actorUserId ?? DEFAULT_METADATA.actorUserId,
    requestId: metadata?.requestId ?? DEFAULT_METADATA.requestId,
  };
}

function lockTenantContacts(
  transaction: Prisma.TransactionClient,
  tenantId: string,
): Promise<unknown> {
  return transaction.$queryRaw`
    SELECT 1 FROM pg_advisory_xact_lock(
      hashtextextended(${tenantId}::text || ':contacts'::text, 0::bigint)
    )`;
}

function createData(
  context: TenantContext,
  input: ContactCreateInput,
): Prisma.ContactUncheckedCreateInput {
  const email = contactEmail(input.email);
  const avatarUrl = contactAvatarUrl(input.avatarUrl);
  const tags = contactTags(input.tags) ?? [];
  const customAttributes = contactAttributes(input.customAttributes);
  const data: Prisma.ContactUncheckedCreateInput = {
    name: contactName(input.name),
    phoneNumber: normalizePhoneNumber(input.phoneNumber),
    status: contactStatus(input.status) ?? "ACTIVE",
    tags,
    tenantId: context.tenantId,
  };
  if (email !== undefined) data.email = email;
  if (avatarUrl !== undefined) data.avatarUrl = avatarUrl;
  if (customAttributes === null) data.customAttributes = Prisma.DbNull;
  else if (customAttributes !== undefined) data.customAttributes = customAttributes;
  return data;
}

function updateData(input: ContactUpdateInput): Prisma.ContactUncheckedUpdateInput {
  const data: Prisma.ContactUncheckedUpdateInput = {};
  if (input.name !== undefined) data.name = contactName(input.name);
  if (input.email !== undefined) {
    const email = contactEmail(input.email);
    if (email !== undefined) data.email = email;
  }
  if (input.avatarUrl !== undefined) {
    const avatarUrl = contactAvatarUrl(input.avatarUrl);
    if (avatarUrl !== undefined) data.avatarUrl = avatarUrl;
  }
  if (input.status !== undefined) {
    const status = contactStatus(input.status);
    if (status !== undefined) data.status = status;
  }
  if (input.tags !== undefined) {
    const tags = contactTags(input.tags);
    if (tags !== undefined) data.tags = tags;
  }
  if (input.customAttributes !== undefined) {
    const customAttributes = contactAttributes(input.customAttributes);
    if (customAttributes !== undefined) {
      data.customAttributes = customAttributes === null ? Prisma.DbNull : customAttributes;
    }
  }
  if (Object.keys(data).length === 0) throw new ContactValidationError("Contact update is empty");
  return data;
}

async function appendMutation(
  context: TenantContext,
  transaction: Prisma.TransactionClient,
  metadata: Required<ContactMutationMetadata>,
  action: string,
  eventType: "crm.contact.created" | "crm.contact.updated",
  before: ContactItem | null,
  after: ContactItem,
): Promise<void> {
  const access = createTenantDataAccess(context, transaction);
  await access.audit.append({
    action,
    actorId: metadata.actorUserId,
    actorType: metadata.actorUserId === null ? "system" : "tenant_user",
    afterSummary: summary(after),
    beforeSummary: before === null ? null : summary(before),
    entityId: after.id,
    entityType: "Contact",
    requestId: metadata.requestId,
  });
  await access.outbox.append({
    aggregateId: after.id,
    aggregateType: "Contact",
    eventType,
    payload: {
      contactId: after.id,
      phoneNumber: after.phoneNumber,
      status: after.status,
      tenantId: context.tenantId,
    },
  });
}

export function createContactManager(database: ContactManagerDatabase) {
  const runInTransaction = <Result>(
    transaction: ContactTransaction | undefined,
    callback: (transaction: ContactTransaction) => Promise<Result>,
  ): Promise<Result> =>
    transaction === undefined ? database.$transaction(callback) : callback(transaction);

  const createWithinTransaction = async (
    context: TenantContext,
    input: ContactCreateInput,
    metadata: Required<ContactMutationMetadata>,
    transaction: ContactTransaction,
  ): Promise<ContactItem> => {
    await assertTenantOperational(context, transaction);
    await lockTenantContacts(transaction, context.tenantId);
    try {
      const created = await transaction.contact.create({ data: createData(context, input) });
      const after = contactItem(created);
      await appendMutation(
        context,
        transaction,
        metadata,
        "contact.created",
        "crm.contact.created",
        null,
        after,
      );
      return after;
    } catch (error) {
      if (isUniqueViolation(error)) throw new ContactPhoneConflictError();
      throw error;
    }
  };

  const create = async (
    context: TenantContext,
    input: ContactCreateInput,
    metadata?: ContactMutationMetadata,
  ): Promise<ContactItem> => {
    const validatedContext = createTenantContext(context.tenantId);
    return runInTransaction(undefined, (transaction) =>
      createWithinTransaction(validatedContext, input, requestMetadata(metadata), transaction),
    );
  };

  const findOrCreateContactByPhone = async (
    context: TenantContext,
    phoneNumber: string,
    defaultName = "Sin Nombre",
    transaction?: ContactTransaction,
  ): Promise<ContactItem> => {
    const validatedContext = createTenantContext(context.tenantId);
    return runInTransaction(transaction, async (currentTransaction) => {
      await assertTenantOperational(validatedContext, currentTransaction);
      await lockTenantContacts(currentTransaction, validatedContext.tenantId);
      const normalizedPhone = normalizePhoneNumber(phoneNumber);
      const existing = await currentTransaction.contact.findUnique({
        where: {
          tenantId_phoneNumber: {
            phoneNumber: normalizedPhone,
            tenantId: validatedContext.tenantId,
          },
        },
      });
      if (existing !== null) return contactItem(existing);
      const created = await currentTransaction.contact.create({
        data: createData(validatedContext, { name: defaultName, phoneNumber: normalizedPhone }),
      });
      const after = contactItem(created);
      await appendMutation(
        validatedContext,
        currentTransaction,
        requestMetadata(),
        "contact.created",
        "crm.contact.created",
        null,
        after,
      );
      return after;
    });
  };

  const findById = async (
    context: TenantContext,
    contactId: string,
  ): Promise<ContactItem | null> => {
    const validatedContext = createTenantContext(context.tenantId);
    await assertTenantOperational(validatedContext, database);
    const contact = await database.contact.findFirst({
      where: { id: contactId, tenantId: validatedContext.tenantId },
    });
    return contact === null ? null : contactItem(contact);
  };

  const updateWithinTransaction = async (
    context: TenantContext,
    contactId: string,
    input: ContactUpdateInput,
    metadata: Required<ContactMutationMetadata>,
    transaction: ContactTransaction,
  ): Promise<ContactItem> => {
    await assertTenantOperational(context, transaction);
    await lockTenantContacts(transaction, context.tenantId);
    const current = await transaction.contact.findFirst({
      where: { id: contactId, tenantId: context.tenantId },
    });
    if (current === null) throw new ContactNotFoundError();
    const before = contactItem(current);
    const updated = await transaction.contact.update({
      data: updateData(input),
      where: { id: current.id },
    });
    const after = contactItem(updated);
    await appendMutation(
      context,
      transaction,
      metadata,
      after.status === "ARCHIVED" ? "contact.archived" : "contact.updated",
      "crm.contact.updated",
      before,
      after,
    );
    return after;
  };

  const update = async (
    context: TenantContext,
    contactId: string,
    input: ContactUpdateInput,
    metadata?: ContactMutationMetadata,
  ): Promise<ContactItem> => {
    const validatedContext = createTenantContext(context.tenantId);
    return runInTransaction(undefined, (transaction) =>
      updateWithinTransaction(
        validatedContext,
        contactId,
        input,
        requestMetadata(metadata),
        transaction,
      ),
    );
  };

  const archive = (
    context: TenantContext,
    contactId: string,
    metadata?: ContactMutationMetadata,
  ): Promise<ContactItem> => update(context, contactId, { status: "ARCHIVED" }, metadata);

  const block = (
    context: TenantContext,
    contactId: string,
    metadata?: ContactMutationMetadata,
  ): Promise<ContactItem> => update(context, contactId, { status: "BLOCKED" }, metadata);

  const list = async (
    context: TenantContext,
    options: ContactListOptions = {},
  ): Promise<ContactPage> => {
    const validatedContext = createTenantContext(context.tenantId);
    await assertTenantOperational(validatedContext, database);
    const page = options.page ?? 1;
    const limit = options.limit ?? 25;
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      throw new ContactValidationError("Invalid contact pagination");
    }
    const where: Prisma.ContactWhereInput = { tenantId: validatedContext.tenantId };
    if (options.status !== undefined) {
      const status = contactStatus(options.status);
      if (status !== undefined) where.status = status;
    }
    if (options.tag !== undefined)
      where.tags = { has: cleanString(options.tag, "contact tag", 50) };
    const search = options.search === undefined ? "" : options.search.trim();
    if (search.length > 0) {
      if (search.length > 100) throw new ContactValidationError("Invalid contact search");
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { phoneNumber: { contains: search } },
        { email: { contains: search, mode: "insensitive" } },
      ];
    }
    const [total, contacts] = await Promise.all([
      database.contact.count({ where }),
      database.contact.findMany({
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
        where,
      }),
    ]);
    return { items: contacts.map(contactItem), limit, page, total };
  };

  return Object.freeze({
    archive,
    archiveContact: archive,
    block,
    blockContact: block,
    create,
    createContact: (
      context: TenantContext,
      input: ContactCreateInput,
      transaction?: ContactTransaction,
    ) => {
      const validatedContext = createTenantContext(context.tenantId);
      return runInTransaction(transaction, (currentTransaction) =>
        createWithinTransaction(validatedContext, input, requestMetadata(), currentTransaction),
      );
    },
    findById,
    findOrCreateContactByPhone,
    getContactById: findById,
    list,
    listContacts: list,
    update,
    updateContact: (
      context: TenantContext,
      contactId: string,
      input: ContactUpdateInput,
      transaction?: ContactTransaction,
    ) => {
      const validatedContext = createTenantContext(context.tenantId);
      return runInTransaction(transaction, (currentTransaction) =>
        updateWithinTransaction(
          validatedContext,
          contactId,
          input,
          requestMetadata(),
          currentTransaction,
        ),
      );
    },
  });
}

export type ContactManager = ReturnType<typeof createContactManager>;
