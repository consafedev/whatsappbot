export type Page<T> = Readonly<{ items: readonly T[]; total: number }>;
export type AppointmentStatus =
  | "REQUESTED"
  | "CONFIRMED"
  | "CANCELLED"
  | "COMPLETED"
  | "NO_SHOW"
  | "RESCHEDULED";
export type AppointmentResourceType = "PRACTITIONER" | "FACILITY" | "ROOM" | "EQUIPMENT" | "OTHER";
export type AppointmentExceptionType = "BLOCKED" | "EXTRA_AVAILABILITY";

export type AppointmentItem = Readonly<{
  id: string;
  tenantId: string;
  contactId: string;
  serviceId: string;
  resourceId: string | null;
  organizationUnitId: string | null;
  rescheduledFromId: string | null;
  createdByUserId: string | null;
  idempotencyKey: string;
  status: AppointmentStatus;
  confirmationStatus: "PENDING" | "CONFIRMED";
  startsAt: string;
  endsAt: string;
  occupiedStartsAt: string;
  occupiedEndsAt: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  timezoneSnapshot: string;
  source: string;
  notes: string | null;
  reminderPolicy: Readonly<{ conversationId: string; offsetMinutes: readonly number[] }> | null;
  createdAt: string;
  updatedAt: string;
}>;

export type ServiceItem = Readonly<{
  id: string;
  organizationUnitId: string | null;
  name: string;
  description: string | null;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  price: string | null;
  currency: string;
  active: boolean;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}>;

export type ResourceItem = Readonly<{
  id: string;
  organizationUnitId: string | null;
  userId: string | null;
  type: AppointmentResourceType;
  name: string;
  description: string | null;
  capacity: number;
  active: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}>;

export type RuleItem = Readonly<{
  id: string;
  resourceId: string;
  serviceId: string | null;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  timezone: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  capacity: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}>;

export type ExceptionItem = Readonly<{
  id: string;
  resourceId: string;
  type: AppointmentExceptionType;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}>;

export type ReminderItem = Readonly<{
  id: string;
  tenantId: string;
  appointmentId: string;
  conversationId: string;
  offsetMinutes: number;
  dueAt: string;
  status: "PENDING" | "QUEUED" | "CANCELLED" | "SUPPRESSED";
  reason: string | null;
  taskId: string | null;
  taskStatus: string | null;
  outboundMessageId: string | null;
  outboundStatus: string | null;
}>;

export type AvailabilitySlot = Readonly<{
  startsAt: string;
  endsAt: string;
  resourceId: string;
  capacity: number;
}>;
export type AvailabilityPage = Readonly<{
  timezone: string;
  slots: readonly AvailabilitySlot[];
  nextFrom?: string;
}>;

export type AppointmentListFilters = Readonly<{
  resourceId?: string;
  serviceId?: string;
  contactId?: string;
  organizationUnitId?: string;
  status?: AppointmentStatus;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}>;
export type CreateAppointmentInput = Readonly<{
  serviceId: string;
  resourceId: string;
  contactId: string;
  startsAt: string;
  idempotencyKey: string;
  notes?: string | null;
  reminderPolicy?: Readonly<{ conversationId: string; offsetMinutes: readonly number[] }> | null;
}>;
export type RebookAppointmentInput = Readonly<{
  startsAt: string;
  resourceId?: string;
  idempotencyKey: string;
}>;
export type AppointmentServiceInput = Readonly<{
  name: string;
  description?: string | null;
  durationMinutes: number;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
  price?: number | string | null;
  currency?: string;
  organizationUnitId?: string | null;
  settings?: Record<string, unknown>;
}>;
export type AppointmentServicePatch = Partial<
  Readonly<{
    name: string;
    description: string | null;
    durationMinutes: number;
    bufferBeforeMinutes: number;
    bufferAfterMinutes: number;
    price: number | string | null;
    currency: string;
    organizationUnitId: string | null;
    active: boolean;
    settings: Record<string, unknown>;
  }>
>;
export type AppointmentServiceListFilters = Readonly<{
  active?: boolean;
  organizationUnitId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}>;
export type AppointmentResourceInput = Readonly<{
  name: string;
  type?: AppointmentResourceType;
  description?: string | null;
  capacity?: number;
  organizationUnitId?: string | null;
  userId?: string | null;
  metadata?: Record<string, unknown>;
}>;
export type AppointmentResourcePatch = Partial<
  Readonly<{
    name: string;
    type: AppointmentResourceType;
    description: string | null;
    capacity: number;
    organizationUnitId: string | null;
    userId: string | null;
    active: boolean;
    metadata: Record<string, unknown>;
  }>
>;
export type AppointmentResourceListFilters = AppointmentServiceListFilters &
  Readonly<{ type?: AppointmentResourceType; userId?: string }>;
export type AppointmentAvailabilityRuleInput = Readonly<{
  resourceId: string;
  serviceId?: string | null;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  timezone?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  capacity?: number;
  active?: boolean;
}>;
export type AppointmentAvailabilityRulePatch = Partial<
  Omit<AppointmentAvailabilityRuleInput, "resourceId">
>;
export type AppointmentAvailabilityRuleListFilters = Readonly<{
  resourceId?: string;
  serviceId?: string | null;
  dayOfWeek?: number;
  active?: boolean;
  limit?: number;
  offset?: number;
}>;
export type AppointmentAvailabilityExceptionInput = Readonly<{
  resourceId: string;
  type?: AppointmentExceptionType;
  startsAt: string;
  endsAt: string;
  reason?: string | null;
  active?: boolean;
}>;
export type AppointmentAvailabilityExceptionPatch = Partial<
  Omit<AppointmentAvailabilityExceptionInput, "resourceId">
>;
export type AppointmentAvailabilityExceptionListFilters = Readonly<{
  resourceId?: string;
  type?: AppointmentExceptionType;
  from?: string;
  to?: string;
  active?: boolean;
  limit?: number;
  offset?: number;
}>;
export type AvailabilityQuery = Readonly<{
  serviceId: string;
  resourceId: string;
  from: string;
  to: string;
  limit?: number;
}>;
export type AppointmentRequestOptions = Readonly<{ signal?: AbortSignal }>;

export type AppointmentCapabilityInput = Readonly<{
  modules: readonly string[];
  permissions: readonly string[];
}>;
export type AppointmentCapabilities = Readonly<{
  canReadAppointments: boolean;
  canManageAppointments: boolean;
  canConfigureReminders: boolean;
  canLookupContacts: boolean;
  canLookupConversations: boolean;
  canLookupOrganizationUnits: boolean;
}>;

export function getAppointmentCapabilities(
  input: AppointmentCapabilityInput,
): AppointmentCapabilities {
  const modules = new Set(input.modules);
  const permissions = new Set(input.permissions);
  const hasAppointments = modules.has("module.appointments");
  const canManageAppointments = hasAppointments && permissions.has("appointments.manage");
  return {
    canReadAppointments: hasAppointments && permissions.has("appointments.read"),
    canManageAppointments,
    canConfigureReminders:
      canManageAppointments &&
      modules.has("module.scheduling") &&
      modules.has("module.messaging.basic") &&
      modules.has("module.crm_lite"),
    canLookupContacts: modules.has("module.crm_lite") && permissions.has("contacts.read"),
    canLookupConversations:
      modules.has("module.messaging.basic") &&
      modules.has("module.crm_lite") &&
      permissions.has("conversations.read"),
    canLookupOrganizationUnits: permissions.has("tenant.settings.manage"),
  };
}

export class AppointmentApiError extends Error {
  readonly statusCode: number;
  readonly code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = "AppointmentApiError";
    this.statusCode = statusCode;
    if (code !== undefined) this.code = code;
  }
}

type ApiEnvelope<T> = Readonly<{ success: true; data: T }>;
type RecordValue = Record<string, unknown>;
type PageShape<T> = Readonly<{ items: readonly T[]; total: number }>;
type CollectionClient<T, Create, Patch, Filters> = Readonly<{
  list(filters?: Filters, options?: AppointmentRequestOptions): Promise<Page<T>>;
  get(id: string, options?: AppointmentRequestOptions): Promise<T>;
  create(input: Create): Promise<T>;
  update(id: string, input: Patch): Promise<T>;
  remove(id: string): Promise<T>;
}>;

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPage<T>(value: unknown): value is PageShape<T> {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every((item) => isRecord(item) && typeof item.id === "string") &&
    Number.isInteger(value.total) &&
    Number(value.total) >= 0
  );
}

function isIdentified(value: unknown): value is RecordValue & { id: string } {
  return isRecord(value) && typeof value.id === "string" && value.id.length > 0;
}

function encodeQuery(values: Record<string, string | number | boolean | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) query.set(key, value === null ? "null" : String(value));
  }
  const encoded = query.toString();
  return encoded === "" ? "" : `?${encoded}`;
}

function pick<T extends object>(value: T, keys: readonly (keyof T)[]): RecordValue {
  const input = value as RecordValue;
  const output: RecordValue = {};
  for (const key of keys) {
    const name = String(key);
    if (Object.hasOwn(input, name) && input[name] !== undefined) output[name] = input[name];
  }
  return output;
}

async function parseServerError(response: Response): Promise<AppointmentApiError> {
  let message = `Error del servidor (${response.status})`;
  let code: string | undefined;
  try {
    const body: unknown = await response.json();
    if (isRecord(body)) {
      if (typeof body.message === "string") message = body.message;
      else if (Array.isArray(body.message) && body.message.length > 0) {
        message = body.message.map(String).join(", ");
      } else if (typeof body.error === "string") message = body.error;
      if (typeof body.code === "string") code = body.code;
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    // Preserve a useful status-based error when the server did not return JSON.
  }
  return new AppointmentApiError(message, response.status, code);
}

async function requestData<T>(
  url: string,
  init: RequestInit,
  validate: (value: unknown) => value is T,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new AppointmentApiError("No se pudo conectar con el servidor de citas", 0);
  }
  if (!response.ok) throw await parseServerError(response);

  let envelope: unknown;
  try {
    envelope = await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new AppointmentApiError("Respuesta inválida del servidor de citas", response.status);
  }
  if (!isRecord(envelope) || envelope.success !== true || !Object.hasOwn(envelope, "data")) {
    throw new AppointmentApiError("Respuesta inválida del servidor de citas", response.status);
  }
  const data = (envelope as ApiEnvelope<unknown>).data;
  if (!validate(data)) {
    throw new AppointmentApiError("Datos inválidos en la respuesta de citas", response.status);
  }
  return data;
}

function appointmentsUrl(base: string, path = ""): string {
  return `${base.replace(/\/$/, "")}/api/v1/appointments${path}`;
}

function isOffsetInstant(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function getInit(options?: AppointmentRequestOptions): RequestInit {
  return {
    credentials: "include",
    headers: { Accept: "application/json" },
    method: "GET",
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
  };
}

function mutationInit(method: string, body?: RecordValue): RequestInit {
  return {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    method,
  };
}

function pageRequest<T>(
  url: string,
  options: AppointmentRequestOptions | undefined,
): Promise<Page<T>> {
  return requestData(url, getInit(options), isPage<T>);
}

function itemRequest<T>(url: string, init: RequestInit): Promise<T> {
  return requestData(url, init, isIdentified) as Promise<T>;
}

export function createAppointmentsApi(apiBaseUrl: string) {
  const collection = <T, Create extends object, Patch extends object, Filters extends object>(
    path: string,
    createFields: readonly (keyof Create)[],
    patchFields: readonly (keyof Patch)[],
    filterFields: readonly (keyof Filters)[],
  ): CollectionClient<T, Create, Patch, Filters> => ({
    list(filters, options) {
      return pageRequest(
        appointmentsUrl(
          apiBaseUrl,
          `${path}${encodeQuery(pick(filters ?? ({} as Filters), filterFields) as Record<string, string | number | boolean | null | undefined>)}`,
        ),
        options,
      );
    },
    get(id, options) {
      return itemRequest(
        appointmentsUrl(apiBaseUrl, `${path}/${encodeURIComponent(id)}`),
        getInit(options),
      );
    },
    create(input) {
      return itemRequest(
        appointmentsUrl(apiBaseUrl, path),
        mutationInit("POST", pick(input, createFields)),
      );
    },
    update(id, input) {
      return itemRequest(
        appointmentsUrl(apiBaseUrl, `${path}/${encodeURIComponent(id)}`),
        mutationInit("PATCH", pick(input, patchFields)),
      );
    },
    remove(id) {
      return itemRequest(
        appointmentsUrl(apiBaseUrl, `${path}/${encodeURIComponent(id)}`),
        mutationInit("DELETE"),
      );
    },
  });

  return {
    list(filters: AppointmentListFilters = {}, options?: AppointmentRequestOptions) {
      return pageRequest<AppointmentItem>(
        appointmentsUrl(
          apiBaseUrl,
          encodeQuery({
            resourceId: filters.resourceId,
            serviceId: filters.serviceId,
            contactId: filters.contactId,
            organizationUnitId: filters.organizationUnitId,
            status: filters.status,
            from: filters.from,
            to: filters.to,
            limit: filters.limit,
            offset: filters.offset,
          }),
        ),
        options,
      );
    },
    get(id: string, options?: AppointmentRequestOptions) {
      return itemRequest<AppointmentItem>(
        appointmentsUrl(apiBaseUrl, `/${encodeURIComponent(id)}`),
        getInit(options),
      );
    },
    create(input: CreateAppointmentInput) {
      const body = pick(input, [
        "serviceId",
        "resourceId",
        "contactId",
        "startsAt",
        "idempotencyKey",
        "notes",
        "reminderPolicy",
      ]);
      return itemRequest<AppointmentItem>(appointmentsUrl(apiBaseUrl), mutationInit("POST", body));
    },
    cancel(id: string) {
      return itemRequest<AppointmentItem>(
        appointmentsUrl(apiBaseUrl, `/${encodeURIComponent(id)}/cancel`),
        mutationInit("POST", {}),
      );
    },
    rebook(id: string, input: RebookAppointmentInput) {
      return itemRequest<AppointmentItem>(
        appointmentsUrl(apiBaseUrl, `/${encodeURIComponent(id)}/rebook`),
        mutationInit("POST", pick(input, ["startsAt", "resourceId", "idempotencyKey"])),
      );
    },
    reminders(id: string, options?: AppointmentRequestOptions) {
      return requestData(
        appointmentsUrl(apiBaseUrl, `/${encodeURIComponent(id)}/reminders`),
        getInit(options),
        (value): value is ReminderItem[] =>
          Array.isArray(value) && value.every((item) => isIdentified(item)),
      );
    },
    async availability(input: AvailabilityQuery, options?: AppointmentRequestOptions) {
      const from = Date.parse(input.from);
      const to = Date.parse(input.to);
      if (
        !isOffsetInstant(input.from) ||
        !isOffsetInstant(input.to) ||
        !Number.isFinite(from) ||
        !Number.isFinite(to) ||
        from >= to ||
        to - from > 7 * 24 * 60 * 60 * 1000
      ) {
        throw new AppointmentApiError(
          "El rango de disponibilidad debe ser de hasta 168 horas",
          0,
          "AVAILABILITY_RANGE_INVALID",
        );
      }
      return requestData(
        appointmentsUrl(
          apiBaseUrl,
          `/availability${encodeQuery({
            serviceId: input.serviceId,
            resourceId: input.resourceId,
            from: input.from,
            to: input.to,
            limit: input.limit,
          })}`,
        ),
        getInit(options),
        (value): value is AvailabilityPage =>
          isRecord(value) &&
          typeof value.timezone === "string" &&
          Array.isArray(value.slots) &&
          value.slots.every(
            (slot) =>
              isRecord(slot) &&
              typeof slot.startsAt === "string" &&
              typeof slot.endsAt === "string" &&
              typeof slot.resourceId === "string" &&
              Number.isInteger(slot.capacity),
          ) &&
          (value.nextFrom === undefined || typeof value.nextFrom === "string"),
      );
    },
    services: collection<
      ServiceItem,
      AppointmentServiceInput,
      AppointmentServicePatch,
      AppointmentServiceListFilters
    >(
      "/services",
      [
        "name",
        "description",
        "durationMinutes",
        "bufferBeforeMinutes",
        "bufferAfterMinutes",
        "price",
        "currency",
        "organizationUnitId",
        "settings",
      ],
      [
        "name",
        "description",
        "durationMinutes",
        "bufferBeforeMinutes",
        "bufferAfterMinutes",
        "price",
        "currency",
        "organizationUnitId",
        "active",
        "settings",
      ],
      ["active", "organizationUnitId", "search", "limit", "offset"],
    ),
    resources: collection<
      ResourceItem,
      AppointmentResourceInput,
      AppointmentResourcePatch,
      AppointmentResourceListFilters
    >(
      "/resources",
      ["name", "type", "description", "capacity", "organizationUnitId", "userId", "metadata"],
      [
        "name",
        "type",
        "description",
        "capacity",
        "organizationUnitId",
        "userId",
        "active",
        "metadata",
      ],
      ["active", "organizationUnitId", "search", "limit", "offset", "type", "userId"],
    ),
    rules: collection<
      RuleItem,
      AppointmentAvailabilityRuleInput,
      AppointmentAvailabilityRulePatch,
      AppointmentAvailabilityRuleListFilters
    >(
      "/availability-rules",
      [
        "resourceId",
        "serviceId",
        "dayOfWeek",
        "startTime",
        "endTime",
        "timezone",
        "effectiveFrom",
        "effectiveTo",
        "capacity",
        "active",
      ],
      [
        "serviceId",
        "dayOfWeek",
        "startTime",
        "endTime",
        "timezone",
        "effectiveFrom",
        "effectiveTo",
        "capacity",
        "active",
      ],
      ["resourceId", "serviceId", "dayOfWeek", "active", "limit", "offset"],
    ),
    exceptions: collection<
      ExceptionItem,
      AppointmentAvailabilityExceptionInput,
      AppointmentAvailabilityExceptionPatch,
      AppointmentAvailabilityExceptionListFilters
    >(
      "/exceptions",
      ["resourceId", "type", "startsAt", "endsAt", "reason", "active"],
      ["type", "startsAt", "endsAt", "reason", "active"],
      ["resourceId", "type", "from", "to", "active", "limit", "offset"],
    ),
  };
}
