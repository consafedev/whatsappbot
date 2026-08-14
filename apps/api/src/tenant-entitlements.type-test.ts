import { RequireEntitlements } from "./tenant-entitlements";

RequireEntitlements("module.quotes", "module.messaging.basic");

// @ts-expect-error module keys are a closed catalog
RequireEntitlements("module.fake");

// @ts-expect-error limits are not boolean module entitlements
RequireEntitlements("limit.users");
