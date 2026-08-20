import { randomUUID } from "node:crypto";
import {
  applyDecorators,
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type {
  ContactCreateInput,
  ContactItem,
  ContactListOptions,
  ContactManager,
  ContactPage,
  ContactStatus,
  ContactUpdateInput,
  TenantContext,
} from "@whatsapp-platform/database";
import {
  CONTACT_STATUSES,
  ContactNotFoundError,
  ContactPhoneConflictError,
  ContactValidationError,
  normalizePhoneNumber,
  PhoneNumberInvalidError,
  TenantNotOperationalError,
} from "@whatsapp-platform/database";
import {
  CurrentTenantContext,
  CurrentTenantIdentity,
  type TenantAuthenticationRequest,
  type TenantSessionIdentity,
} from "./tenant-context";
import { TenantAuthorized } from "./tenant-rbac";

export const CONTACT_MANAGER = Symbol("CONTACT_MANAGER");

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type ParsedContactCreateInput = {
  name?: string;
  phoneNumber: string;
  email?: string | null;
  avatarUrl?: string | null;
  status?: ContactStatus;
  tags?: readonly string[];
  customAttributes?: JsonValue | null;
};
type ParsedContactUpdateInput = Omit<ParsedContactCreateInput, "phoneNumber">;

function contactsAuthorized(
  ...permissions: ["contacts.read"] | ["contacts.write"]
): MethodDecorator & ClassDecorator {
  return applyDecorators(TenantAuthorized(...permissions));
}

function requestId(request: TenantAuthenticationRequest): string {
  const value = request.headers["x-request-id"];
  const header = Array.isArray(value) ? value[0] : value;
  return header !== undefined && /^[A-Za-z0-9._:-]{1,128}$/.test(header) ? header : randomUUID();
}

function plainObject(value: unknown, message = "Invalid contact request"): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException(message);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const keys = new Set(allowed);
  if (Object.keys(value).some((key) => !keys.has(key))) {
    throw new BadRequestException("Invalid contact request");
  }
}

function stringValue(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new BadRequestException(`Invalid ${label}`);
  const result = value.trim();
  if (result.length === 0 || result.length > maxLength) {
    throw new BadRequestException(`Invalid ${label}`);
  }
  return result;
}

function optionalString(
  value: unknown,
  label: string,
  maxLength: number,
): string | null | undefined {
  if (value === undefined || value === null) return value;
  return stringValue(value, label, maxLength);
}

function tags(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== "string")) {
    throw new BadRequestException("Invalid contact tags");
  }
  return value as string[];
}

function customAttributes(value: unknown): JsonValue | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("Contact customAttributes must be an object");
  }
  return value as { [key: string]: JsonValue };
}

function status(value: unknown): ContactStatus {
  if (typeof value !== "string" || !CONTACT_STATUSES.includes(value as ContactStatus)) {
    throw new BadRequestException("Invalid contact status");
  }
  return value as ContactStatus;
}

function contactId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new BadRequestException("Invalid contact id");
  }
  return value.toLowerCase();
}

function parsePhone(value: unknown): string {
  if (typeof value !== "string") throw new BadRequestException("Invalid contact phone number");
  try {
    return normalizePhoneNumber(value);
  } catch (error) {
    if (error instanceof PhoneNumberInvalidError) {
      throw new BadRequestException("Invalid contact phone number");
    }
    throw error;
  }
}

function parseCreate(body: unknown): ContactCreateInput {
  const value = plainObject(body);
  exactKeys(value, [
    "name",
    "phoneNumber",
    "email",
    "avatarUrl",
    "tags",
    "customAttributes",
    "status",
  ]);
  const input: ParsedContactCreateInput = {
    phoneNumber: parsePhone(value.phoneNumber),
  };
  if (value.name !== undefined) input.name = stringValue(value.name, "contact name", 160);
  if (value.email !== undefined) {
    const email = optionalString(value.email, "contact email", 254);
    if (email !== undefined) input.email = email;
  }
  if (value.avatarUrl !== undefined) {
    const avatarUrl = optionalString(value.avatarUrl, "contact avatar URL", 2048);
    if (avatarUrl !== undefined) input.avatarUrl = avatarUrl;
  }
  if (value.tags !== undefined) {
    const parsedTags = tags(value.tags);
    if (parsedTags !== undefined) input.tags = parsedTags;
  }
  if (value.customAttributes !== undefined) {
    const parsedAttributes = customAttributes(value.customAttributes);
    if (parsedAttributes !== undefined) input.customAttributes = parsedAttributes;
  }
  if (value.status !== undefined) input.status = status(value.status);
  return input;
}

function parseUpdate(body: unknown): ContactUpdateInput {
  const value = plainObject(body);
  exactKeys(value, ["name", "email", "avatarUrl", "tags", "customAttributes", "status"]);
  if (Object.keys(value).length === 0) throw new BadRequestException("Invalid contact update");
  const input: ParsedContactUpdateInput = {};
  if (value.name !== undefined) input.name = stringValue(value.name, "contact name", 160);
  if (value.email !== undefined) {
    const email = optionalString(value.email, "contact email", 254);
    if (email !== undefined) input.email = email;
  }
  if (value.avatarUrl !== undefined) {
    const avatarUrl = optionalString(value.avatarUrl, "contact avatar URL", 2048);
    if (avatarUrl !== undefined) input.avatarUrl = avatarUrl;
  }
  if (value.tags !== undefined) {
    const parsedTags = tags(value.tags);
    if (parsedTags !== undefined) input.tags = parsedTags;
  }
  if (value.customAttributes !== undefined) {
    const parsedAttributes = customAttributes(value.customAttributes);
    if (parsedAttributes !== undefined) input.customAttributes = parsedAttributes;
  }
  if (value.status !== undefined) input.status = status(value.status);
  return input;
}

function positiveInt(value: unknown, label: string, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new BadRequestException(`Invalid ${label}`);
  }
  return parsed;
}

function parseListOptions(query: Record<string, string | undefined>): ContactListOptions {
  const options: {
    page: number;
    limit: number;
    search?: string;
    tag?: string;
    status?: ContactStatus;
  } = {
    limit: positiveInt(query.limit, "contact limit", 25, 100),
    page: positiveInt(query.page, "contact page", 1, 10_000),
  };
  if (query.search !== undefined) options.search = stringValue(query.search, "contact search", 100);
  if (query.tag !== undefined) options.tag = stringValue(query.tag, "contact tag", 50);
  if (query.status !== undefined) options.status = status(query.status);
  return options;
}

function mapError(error: unknown): never {
  if (error instanceof ContactNotFoundError) throw new NotFoundException("Contact not found");
  if (error instanceof ContactPhoneConflictError) {
    throw new ConflictException({
      code: "CONTACT_PHONE_CONFLICT",
      error: "Conflict",
      message: "A contact already uses this phone number",
      statusCode: 409,
    });
  }
  if (error instanceof ContactValidationError || error instanceof PhoneNumberInvalidError) {
    throw new BadRequestException(error.message);
  }
  if (error instanceof TenantNotOperationalError) {
    throw new ForbiddenException({
      code: "TENANT_NOT_OPERATIONAL",
      error: "Forbidden",
      message: "Tenant is not operational",
      statusCode: 403,
    });
  }
  throw error;
}

@Injectable()
export class ContactsService {
  constructor(@Inject(CONTACT_MANAGER) private readonly manager: ContactManager) {}

  async create(
    context: TenantContext,
    identity: TenantSessionIdentity,
    request: TenantAuthenticationRequest,
    body: unknown,
  ): Promise<ContactItem> {
    try {
      return await this.manager.create(context, parseCreate(body), {
        actorUserId: identity.userId,
        requestId: requestId(request),
      });
    } catch (error) {
      return mapError(error);
    }
  }

  async list(
    context: TenantContext,
    query: Record<string, string | undefined>,
  ): Promise<ContactPage> {
    try {
      return await this.manager.list(context, parseListOptions(query));
    } catch (error) {
      return mapError(error);
    }
  }

  async get(context: TenantContext, id: string): Promise<ContactItem> {
    try {
      const contact = await this.manager.findById(context, contactId(id));
      if (contact === null) throw new ContactNotFoundError();
      return contact;
    } catch (error) {
      return mapError(error);
    }
  }

  async update(
    context: TenantContext,
    identity: TenantSessionIdentity,
    request: TenantAuthenticationRequest,
    id: string,
    body: unknown,
  ): Promise<ContactItem> {
    try {
      return await this.manager.update(context, contactId(id), parseUpdate(body), {
        actorUserId: identity.userId,
        requestId: requestId(request),
      });
    } catch (error) {
      return mapError(error);
    }
  }

  async archive(
    context: TenantContext,
    identity: TenantSessionIdentity,
    request: TenantAuthenticationRequest,
    id: string,
  ): Promise<ContactItem> {
    try {
      return await this.manager.archive(context, contactId(id), {
        actorUserId: identity.userId,
        requestId: requestId(request),
      });
    } catch (error) {
      return mapError(error);
    }
  }
}

@Controller("api/v1/contacts")
export class ContactsController {
  constructor(private readonly service: ContactsService) {}

  @Post()
  @HttpCode(201)
  @contactsAuthorized("contacts.write")
  create(
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Body() body: unknown,
  ): Promise<ContactItem> {
    return this.service.create(context, identity, request, body);
  }

  @Get()
  @contactsAuthorized("contacts.read")
  list(
    @CurrentTenantContext() context: TenantContext,
    @Query() query: Record<string, string | undefined>,
  ): Promise<ContactPage> {
    return this.service.list(context, query);
  }

  @Get(":contactId")
  @contactsAuthorized("contacts.read")
  get(
    @CurrentTenantContext() context: TenantContext,
    @Param("contactId") contactIdValue: string,
  ): Promise<ContactItem> {
    return this.service.get(context, contactIdValue);
  }

  @Patch(":contactId")
  @contactsAuthorized("contacts.write")
  update(
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Param("contactId") contactIdValue: string,
    @Body() body: unknown,
  ): Promise<ContactItem> {
    return this.service.update(context, identity, request, contactIdValue, body);
  }

  @Delete(":contactId")
  @contactsAuthorized("contacts.write")
  archive(
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Param("contactId") contactIdValue: string,
  ): Promise<ContactItem> {
    return this.service.archive(context, identity, request, contactIdValue);
  }
}
