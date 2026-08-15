import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import {
  normalizeTenantUserEmail,
  PlatformPasswordHasher,
  validatePlatformPassword,
} from "@whatsapp-platform/auth";
import type {
  RolePermissionItem,
  TenantContext,
  UserItem,
  UserManagementManager,
  UserPage,
  UserRoleAssignmentInput,
  UserStatus,
  UserStatusUpdateResult,
} from "@whatsapp-platform/database";
import {
  DuplicateRoleAssignmentError,
  LastOwnerRequiredError,
  OwnerRoleReadOnlyError,
  type RoleManagementPage,
  RolePermissionScopeConflictError,
  UserEmailConflictError,
  UserEmailInvalidError,
  UserLimitReachedError,
  UserNotFoundError,
  UserRoleNotFoundError,
  UserScopeUnitNotFoundError,
} from "@whatsapp-platform/database";
import { isPermissionKey, type PermissionKey } from "@whatsapp-platform/rbac";
import {
  CurrentTenantContext,
  CurrentTenantIdentity,
  type TenantAuthenticationRequest,
  type TenantSessionIdentity,
} from "./tenant-context";
import { TenantAuthorized } from "./tenant-rbac";

export const USER_MANAGEMENT_MANAGER = Symbol("USER_MANAGEMENT_MANAGER");

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USER_STATUSES = new Set<string>(["active", "disabled"]);
const MAX_ASSIGNMENTS = 50;
const EMAIL_MAX_LENGTH = 254;
const DISPLAY_NAME_MAX_LENGTH = 120;
const SEARCH_MAX_LENGTH = 120;
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 25;

const passwordHasher = new PlatformPasswordHasher();

function requestId(request: TenantAuthenticationRequest): string {
  const value = request.headers["x-request-id"];
  const header = Array.isArray(value) ? value[0] : value;
  return header !== undefined && /^[A-Za-z0-9._:-]{1,128}$/.test(header) ? header : randomUUID();
}

function plainObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("Invalid user management request");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const keys = new Set(allowed);
  if (Object.keys(value).some((key) => !keys.has(key))) {
    throw new BadRequestException("Invalid user management request");
  }
}

function uuidV7(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_V7_PATTERN.test(value)) {
    throw new BadRequestException(`Invalid ${label}`);
  }
  return value.toLowerCase();
}

function displayName(value: unknown): string {
  if (typeof value !== "string") {
    throw new BadRequestException("Invalid display name");
  }
  const result = value.trim();
  if (result.length === 0 || result.length > DISPLAY_NAME_MAX_LENGTH) {
    throw new BadRequestException("Invalid display name");
  }
  return result;
}

function email(value: unknown): string {
  if (typeof value !== "string" || value.length > EMAIL_MAX_LENGTH) {
    throw new BadRequestException("Invalid email");
  }
  const normalized = normalizeTenantUserEmail(value);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new BadRequestException("Invalid email");
  }
  return normalized;
}

function password(value: unknown): string {
  if (typeof value !== "string") {
    throw new BadRequestException("Invalid password");
  }
  try {
    validatePlatformPassword(value);
  } catch {
    throw new BadRequestException("Invalid password");
  }
  return value;
}

function pageNumber(value: unknown): number {
  if (value === undefined) return DEFAULT_PAGE;
  const result = typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(result) || result < 1) {
    throw new BadRequestException("Invalid page");
  }
  return result;
}

function pageSize(value: unknown): number {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  const result = typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(result) || result < 1 || result > 100) {
    throw new BadRequestException("Invalid page size");
  }
  return result;
}

function search(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new BadRequestException("Invalid search");
  }
  const result = value.trim();
  if (result.length > SEARCH_MAX_LENGTH) {
    throw new BadRequestException("Invalid search");
  }
  return result === "" ? undefined : result;
}

function userStatus(value: unknown): UserStatus | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !USER_STATUSES.has(value)) {
    throw new BadRequestException("Invalid user status filter");
  }
  return value as UserStatus;
}

function assignment(value: unknown): UserRoleAssignmentInput {
  const object = plainObject(value);
  exactKeys(object, ["roleId", "organizationUnitId"]);
  const roleId = uuidV7(object.roleId, "role id");
  const organizationUnitId =
    object.organizationUnitId === null
      ? null
      : uuidV7(object.organizationUnitId, "organization unit id");
  return { organizationUnitId, roleId };
}

function roleAssignments(value: unknown): readonly UserRoleAssignmentInput[] {
  if (!Array.isArray(value) || value.length > MAX_ASSIGNMENTS) {
    throw new BadRequestException("Invalid role assignments");
  }
  return value.map(assignment);
}

function permissionKeys(value: unknown): readonly PermissionKey[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException("Invalid permission keys");
  }
  const keys: PermissionKey[] = [];
  for (const key of value) {
    if (typeof key !== "string" || !isPermissionKey(key)) {
      throw new BadRequestException("Invalid permission key");
    }
    keys.push(key);
  }
  return keys;
}

function parseCreate(body: unknown): {
  displayName: string;
  email: string;
  password: string;
  roleAssignments: readonly UserRoleAssignmentInput[];
} {
  const value = plainObject(body);
  exactKeys(value, ["displayName", "email", "password", "roleAssignments"]);
  return {
    displayName: displayName(value.displayName),
    email: email(value.email),
    password: password(value.password),
    roleAssignments: roleAssignments(value.roleAssignments),
  };
}

function parseStatus(body: unknown): { status: UserStatus } {
  const value = plainObject(body);
  exactKeys(value, ["status"]);
  if (typeof value.status !== "string" || !USER_STATUSES.has(value.status)) {
    throw new BadRequestException("Invalid user status");
  }
  return { status: value.status as UserStatus };
}

function parseAssignments(body: unknown): readonly UserRoleAssignmentInput[] {
  const value = plainObject(body);
  exactKeys(value, ["assignments"]);
  return roleAssignments(value.assignments);
}

function parsePermissions(body: unknown): readonly PermissionKey[] {
  const value = plainObject(body);
  exactKeys(value, ["permissionKeys"]);
  return permissionKeys(value.permissionKeys);
}

function conflict(code: string, message: string): ConflictException {
  return new ConflictException({ code, error: "Conflict", message, statusCode: 409 });
}

function mapError(error: unknown): never {
  if (error instanceof UserNotFoundError) {
    throw new NotFoundException("User not found");
  }
  if (error instanceof UserRoleNotFoundError) {
    throw new NotFoundException("Role not found");
  }
  if (error instanceof UserScopeUnitNotFoundError) {
    throw new NotFoundException("Organization unit not found");
  }
  if (error instanceof UserEmailConflictError) {
    throw conflict("USER_EMAIL_CONFLICT", "A user with this email already exists in the workspace");
  }
  if (error instanceof UserLimitReachedError) {
    throw conflict("USER_LIMIT_REACHED", "The user limit for the workspace has been reached");
  }
  if (error instanceof LastOwnerRequiredError) {
    throw conflict("LAST_OWNER_REQUIRED", "The workspace must keep at least one active owner");
  }
  if (error instanceof OwnerRoleReadOnlyError) {
    throw conflict("OWNER_ROLE_READ_ONLY", "The system owner role permissions are read-only");
  }
  if (error instanceof RolePermissionScopeConflictError) {
    throw conflict(
      "ROLE_PERMISSION_SCOPE_CONFLICT",
      "A permission with existing scope constraints cannot be edited here",
    );
  }
  if (error instanceof DuplicateRoleAssignmentError) {
    throw new BadRequestException({
      code: "DUPLICATE_ROLE_ASSIGNMENT",
      error: "Bad Request",
      message: "Role assignments must be unique",
      statusCode: 400,
    });
  }
  if (error instanceof UserEmailInvalidError) {
    throw new BadRequestException("Invalid email");
  }
  throw error;
}

@Injectable()
export class TenantUserManagementService {
  constructor(@Inject(USER_MANAGEMENT_MANAGER) private readonly manager: UserManagementManager) {}

  list(context: TenantContext, query: Record<string, string | undefined>): Promise<UserPage> {
    const searchValue = query.search !== undefined ? search(query.search) : undefined;
    const statusValue = query.status !== undefined ? userStatus(query.status) : undefined;
    const options: { page: number; pageSize: number; search?: string; status?: UserStatus } = {
      page: pageNumber(query.page),
      pageSize: pageSize(query.pageSize),
    };
    if (searchValue !== undefined) options.search = searchValue;
    if (statusValue !== undefined) options.status = statusValue;
    return this.manager.list(context, options);
  }

  async create(
    context: TenantContext,
    identity: TenantSessionIdentity,
    requestIdValue: string,
    body: unknown,
  ): Promise<UserItem> {
    const input = parseCreate(body);
    try {
      const passwordHash = await passwordHasher.hash(input.password);
      return await this.manager.create(
        context,
        {
          displayName: input.displayName,
          email: input.email,
          passwordHash,
          roleAssignments: input.roleAssignments,
        },
        { actorUserId: identity.userId, requestId: requestIdValue },
      );
    } catch (error) {
      return mapError(error);
    }
  }

  async updateStatus(
    context: TenantContext,
    identity: TenantSessionIdentity,
    requestIdValue: string,
    userId: string,
    body: unknown,
  ): Promise<UserStatusUpdateResult> {
    const userIdValue = uuidV7(userId, "user id");
    try {
      return await this.manager.updateStatus(context, userIdValue, parseStatus(body), {
        actorUserId: identity.userId,
        requestId: requestIdValue,
      });
    } catch (error) {
      return mapError(error);
    }
  }

  async replaceRoleAssignments(
    context: TenantContext,
    identity: TenantSessionIdentity,
    requestIdValue: string,
    userId: string,
    body: unknown,
  ): Promise<UserItem> {
    const userIdValue = uuidV7(userId, "user id");
    try {
      return await this.manager.replaceRoleAssignments(
        context,
        userIdValue,
        parseAssignments(body),
        { actorUserId: identity.userId, requestId: requestIdValue },
      );
    } catch (error) {
      return mapError(error);
    }
  }

  options(context: TenantContext) {
    return this.manager.options(context);
  }

  listRoles(context: TenantContext) {
    return this.manager.listRoles(context);
  }

  async updateRolePermissions(
    context: TenantContext,
    identity: TenantSessionIdentity,
    requestIdValue: string,
    roleId: string,
    body: unknown,
  ): Promise<RolePermissionItem> {
    const roleIdValue = uuidV7(roleId, "role id");
    try {
      return await this.manager.updateRolePermissions(
        context,
        roleIdValue,
        parsePermissions(body),
        { actorUserId: identity.userId, requestId: requestIdValue },
      );
    } catch (error) {
      return mapError(error);
    }
  }
}

@Controller("app")
export class TenantUserManagementController {
  constructor(private readonly service: TenantUserManagementService) {}

  @Get("users")
  @TenantAuthorized("tenant.users.manage")
  list(
    @Query() query: Record<string, string | undefined>,
    @CurrentTenantContext() context: TenantContext,
  ): Promise<UserPage> {
    return this.service.list(context, query);
  }

  @Get("users/options")
  @TenantAuthorized("tenant.users.manage")
  options(@CurrentTenantContext() context: TenantContext) {
    return this.service.options(context);
  }

  @Post("users")
  @HttpCode(201)
  @TenantAuthorized("tenant.users.manage")
  create(
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Body() body: unknown,
  ): Promise<UserItem> {
    return this.service.create(context, identity, requestId(request), body);
  }

  @Patch("users/:userId/status")
  @TenantAuthorized("tenant.users.manage")
  updateStatus(
    @Param("userId") userId: string,
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Body() body: unknown,
  ): Promise<UserStatusUpdateResult> {
    return this.service.updateStatus(context, identity, requestId(request), userId, body);
  }

  @Put("users/:userId/role-assignments")
  @TenantAuthorized("tenant.users.manage")
  replaceRoleAssignments(
    @Param("userId") userId: string,
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Body() body: unknown,
  ): Promise<UserItem> {
    return this.service.replaceRoleAssignments(context, identity, requestId(request), userId, body);
  }

  @Get("roles")
  @TenantAuthorized("tenant.roles.manage")
  listRoles(@CurrentTenantContext() context: TenantContext): Promise<RoleManagementPage> {
    return this.service.listRoles(context);
  }

  @Put("roles/:roleId/permissions")
  @TenantAuthorized("tenant.roles.manage")
  updateRolePermissions(
    @Param("roleId") roleId: string,
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Body() body: unknown,
  ): Promise<RolePermissionItem> {
    return this.service.updateRolePermissions(context, identity, requestId(request), roleId, body);
  }
}
