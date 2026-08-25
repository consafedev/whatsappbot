import { randomUUID } from "node:crypto";
import {
  applyDecorators,
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  type CreateRuleInput,
  type RuleAction,
  type RuleCatalogManager,
  RuleChannelAccountNotFoundError,
  type RuleCondition,
  type RuleItem,
  type RuleListOptions,
  RuleNotFoundError,
  RuleOrganizationUnitNotFoundError,
  RuleValidationError,
  type TenantContext,
  TenantModuleEntitlementRequiredError,
  TenantNotOperationalError,
  type UpdateRuleInput,
  validateActions,
  validateConditions,
} from "@whatsapp-platform/database";
import { TenantUserSessionGuard } from "./tenant-auth";
import {
  CurrentTenantContext,
  CurrentTenantIdentity,
  type TenantAuthenticationRequest,
  TenantContextGuard,
  type TenantSessionIdentity,
} from "./tenant-context";
import { RequireEntitlements, TenantEntitlementGuard } from "./tenant-entitlements";
import { RequirePermissions, TenantPermissionGuard } from "./tenant-rbac";

export const RULE_CATALOG_MANAGER = Symbol("RULE_CATALOG_MANAGER");

function rulesAuthorized(
  ...permissions: ["rules.read"] | ["rules.manage"]
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    RequirePermissions(...permissions),
    UseGuards(
      TenantUserSessionGuard,
      TenantContextGuard,
      TenantPermissionGuard,
      TenantEntitlementGuard,
    ),
  );
}

function requestId(request: TenantAuthenticationRequest): string {
  const value = request.headers["x-request-id"];
  const header = Array.isArray(value) ? value[0] : value;
  return header !== undefined && /^[A-Za-z0-9._:-]{1,128}$/.test(header) ? header : randomUUID();
}

function plainObject(value: unknown, message = "Invalid rule request"): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException(message);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const keys = new Set(allowed);
  if (Object.keys(value).some((key) => !keys.has(key))) {
    throw new BadRequestException("Invalid rule request: unexpected fields");
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

function optionalString(value: unknown, label: string, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  return stringValue(value, label, maxLength);
}

function optionalUuid(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())
  ) {
    throw new BadRequestException(`Invalid ${label} UUID`);
  }
  return value.trim().toLowerCase();
}

function ruleIdParam(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new BadRequestException("Invalid rule id");
  }
  return value.toLowerCase();
}

function integerValue(value: unknown, label: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new BadRequestException(`Invalid ${label}: must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

type Mutable<T> = {
  -readonly [P in keyof T]: T[P];
};

function parseCreate(body: unknown): CreateRuleInput {
  const value = plainObject(body);
  exactKeys(value, [
    "name",
    "description",
    "triggerType",
    "priority",
    "status",
    "executionMode",
    "conditions",
    "actions",
    "cooldownSeconds",
    "channelAccountId",
    "organizationUnitId",
  ]);

  const name = stringValue(value.name, "rule name", 160);
  const triggerType = stringValue(value.triggerType, "triggerType", 60);

  let conditions: readonly RuleCondition[];
  try {
    conditions = validateConditions(value.conditions ?? []);
  } catch (error) {
    throw new BadRequestException(
      error instanceof Error ? error.message : "Invalid rule conditions",
    );
  }

  let actions: readonly RuleAction[];
  try {
    actions = validateActions(value.actions);
  } catch (error) {
    throw new BadRequestException(error instanceof Error ? error.message : "Invalid rule actions");
  }

  const input: Mutable<CreateRuleInput> = {
    actions,
    conditions,
    name,
    triggerType,
  };

  if (value.description !== undefined) {
    input.description = optionalString(value.description, "rule description", 500);
  }
  if (value.priority !== undefined) {
    input.priority = integerValue(value.priority, "rule priority", 1, 10_000);
  }
  if (value.status !== undefined) {
    input.status = stringValue(value.status, "rule status", 20);
  }
  if (value.executionMode !== undefined) {
    input.executionMode = stringValue(value.executionMode, "executionMode", 30);
  }
  if (value.cooldownSeconds !== undefined) {
    input.cooldownSeconds = integerValue(value.cooldownSeconds, "cooldownSeconds", 0, 86_400);
  }
  if (value.channelAccountId !== undefined) {
    input.channelAccountId = optionalUuid(value.channelAccountId, "channelAccountId");
  }
  if (value.organizationUnitId !== undefined) {
    input.organizationUnitId = optionalUuid(value.organizationUnitId, "organizationUnitId");
  }

  return input;
}

function parseUpdate(body: unknown): UpdateRuleInput {
  const value = plainObject(body);
  exactKeys(value, [
    "name",
    "description",
    "triggerType",
    "priority",
    "status",
    "executionMode",
    "conditions",
    "actions",
    "cooldownSeconds",
    "channelAccountId",
    "organizationUnitId",
  ]);

  if (Object.keys(value).length === 0) {
    throw new BadRequestException("Invalid rule update: payload is empty");
  }

  const input: Mutable<UpdateRuleInput> = {};

  if (value.name !== undefined) {
    input.name = stringValue(value.name, "rule name", 160);
  }
  if (value.description !== undefined) {
    input.description = optionalString(value.description, "rule description", 500);
  }
  if (value.triggerType !== undefined) {
    input.triggerType = stringValue(value.triggerType, "triggerType", 60);
  }
  if (value.priority !== undefined) {
    input.priority = integerValue(value.priority, "rule priority", 1, 10_000);
  }
  if (value.status !== undefined) {
    input.status = stringValue(value.status, "rule status", 20);
  }
  if (value.executionMode !== undefined) {
    input.executionMode = stringValue(value.executionMode, "executionMode", 30);
  }
  if (value.cooldownSeconds !== undefined) {
    input.cooldownSeconds = integerValue(value.cooldownSeconds, "cooldownSeconds", 0, 86_400);
  }
  if (value.conditions !== undefined) {
    try {
      input.conditions = validateConditions(value.conditions);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "Invalid rule conditions",
      );
    }
  }
  if (value.actions !== undefined) {
    try {
      input.actions = validateActions(value.actions);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "Invalid rule actions",
      );
    }
  }
  if (value.channelAccountId !== undefined) {
    input.channelAccountId = optionalUuid(value.channelAccountId, "channelAccountId");
  }
  if (value.organizationUnitId !== undefined) {
    input.organizationUnitId = optionalUuid(value.organizationUnitId, "organizationUnitId");
  }

  return input;
}

function parseListOptions(query: Record<string, string | undefined>): RuleListOptions {
  const options: Mutable<RuleListOptions> = {};
  if (query.triggerType !== undefined) {
    options.triggerType = stringValue(query.triggerType, "query triggerType", 60);
  }
  if (query.status !== undefined) {
    options.status = stringValue(query.status, "query status", 20);
  }
  if (query.channelAccountId !== undefined) {
    const channelAccountId = optionalUuid(query.channelAccountId, "query channelAccountId");
    if (channelAccountId !== null) {
      options.channelAccountId = channelAccountId;
    }
  }
  if (query.organizationUnitId !== undefined) {
    const organizationUnitId = optionalUuid(query.organizationUnitId, "query organizationUnitId");
    if (organizationUnitId !== null) {
      options.organizationUnitId = organizationUnitId;
    }
  }
  return options;
}

function mapError(error: unknown): never {
  if (error instanceof RuleNotFoundError) {
    throw new NotFoundException("Rule not found");
  }
  if (
    error instanceof RuleValidationError ||
    error instanceof RuleChannelAccountNotFoundError ||
    error instanceof RuleOrganizationUnitNotFoundError
  ) {
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
  if (error instanceof TenantModuleEntitlementRequiredError) {
    throw new ForbiddenException({
      code: "ENTITLEMENT_REQUIRED",
      error: "Forbidden",
      message: `Tenant module entitlement required: ${error.moduleKey}`,
      statusCode: 403,
    });
  }
  throw error;
}

@Injectable()
export class RulesService {
  constructor(@Inject(RULE_CATALOG_MANAGER) private readonly manager: RuleCatalogManager) {}

  async create(
    context: TenantContext,
    identity: TenantSessionIdentity,
    request: TenantAuthenticationRequest,
    body: unknown,
  ): Promise<RuleItem> {
    try {
      return await this.manager.createRule(context, identity.userId, parseCreate(body), {
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
  ): Promise<readonly RuleItem[]> {
    try {
      return await this.manager.listRules(context, parseListOptions(query));
    } catch (error) {
      return mapError(error);
    }
  }

  async get(context: TenantContext, id: string): Promise<RuleItem> {
    try {
      const rule = await this.manager.getRuleById(context, ruleIdParam(id));
      if (rule === null) throw new RuleNotFoundError();
      return rule;
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
  ): Promise<RuleItem> {
    try {
      return await this.manager.updateRule(
        context,
        ruleIdParam(id),
        identity.userId,
        parseUpdate(body),
        {
          actorUserId: identity.userId,
          requestId: requestId(request),
        },
      );
    } catch (error) {
      return mapError(error);
    }
  }

  async delete(
    context: TenantContext,
    identity: TenantSessionIdentity,
    request: TenantAuthenticationRequest,
    id: string,
  ): Promise<{ success: true; id: string }> {
    try {
      const ruleId = ruleIdParam(id);
      await this.manager.deleteRule(context, ruleId, identity.userId, {
        actorUserId: identity.userId,
        requestId: requestId(request),
      });
      return { id: ruleId, success: true };
    } catch (error) {
      return mapError(error);
    }
  }
}

@Controller("api/v1/rules")
@RequireEntitlements("module.automation.basic")
export class RulesController {
  constructor(private readonly service: RulesService) {}

  @Post()
  @HttpCode(201)
  @rulesAuthorized("rules.manage")
  create(
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Body() body: unknown,
  ): Promise<RuleItem> {
    return this.service.create(context, identity, request, body);
  }

  @Get()
  @rulesAuthorized("rules.read")
  list(
    @CurrentTenantContext() context: TenantContext,
    @Query() query: Record<string, string | undefined>,
  ): Promise<readonly RuleItem[]> {
    return this.service.list(context, query);
  }

  @Get(":ruleId")
  @rulesAuthorized("rules.read")
  get(
    @CurrentTenantContext() context: TenantContext,
    @Param("ruleId") ruleId: string,
  ): Promise<RuleItem> {
    return this.service.get(context, ruleId);
  }

  @Put(":ruleId")
  @rulesAuthorized("rules.manage")
  update(
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Param("ruleId") ruleId: string,
    @Body() body: unknown,
  ): Promise<RuleItem> {
    return this.service.update(context, identity, request, ruleId, body);
  }

  @Delete(":ruleId")
  @rulesAuthorized("rules.manage")
  delete(
    @CurrentTenantContext() context: TenantContext,
    @CurrentTenantIdentity() identity: TenantSessionIdentity,
    @Req() request: TenantAuthenticationRequest,
    @Param("ruleId") ruleId: string,
  ): Promise<{ success: true; id: string }> {
    return this.service.delete(context, identity, request, ruleId);
  }
}
