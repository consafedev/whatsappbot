import { randomUUID } from "node:crypto";
import { normalizePlatformAdminEmail, PlatformPasswordHasher } from "@whatsapp-platform/auth";
import {
  createPlatformAuthRepository,
  disconnectPlatformDatabaseClient,
  getPlatformDatabaseClient,
  type PlatformAdminProfile,
} from "@whatsapp-platform/database/platform";

type BootstrapEnvironment = Readonly<{
  PLATFORM_ADMIN_BOOTSTRAP_DISPLAY_NAME?: string;
  PLATFORM_ADMIN_BOOTSTRAP_EMAIL?: string;
  PLATFORM_ADMIN_BOOTSTRAP_LOCALE?: string;
  PLATFORM_ADMIN_BOOTSTRAP_PASSWORD?: string;
  PLATFORM_ADMIN_BOOTSTRAP_TIMEZONE?: string;
}>;

function required(environment: BootstrapEnvironment, key: keyof BootstrapEnvironment): string {
  const value = environment[key]?.trim();
  if (value === undefined || value.length === 0) throw new Error(`Missing required ${key}`);
  return value;
}

export async function bootstrapPlatformAdmin(
  environment: BootstrapEnvironment,
): Promise<PlatformAdminProfile> {
  const email = normalizePlatformAdminEmail(
    required(environment, "PLATFORM_ADMIN_BOOTSTRAP_EMAIL"),
  );
  const displayName = required(environment, "PLATFORM_ADMIN_BOOTSTRAP_DISPLAY_NAME");
  const password = environment.PLATFORM_ADMIN_BOOTSTRAP_PASSWORD;
  if (password === undefined) {
    throw new Error("Missing required PLATFORM_ADMIN_BOOTSTRAP_PASSWORD");
  }

  const passwordHash = await new PlatformPasswordHasher().hash(password);
  return createPlatformAuthRepository(getPlatformDatabaseClient()).bootstrapAdmin({
    displayName,
    email,
    locale: environment.PLATFORM_ADMIN_BOOTSTRAP_LOCALE?.trim() || "es-MX",
    passwordHash,
    requestId: randomUUID(),
    timezone: environment.PLATFORM_ADMIN_BOOTSTRAP_TIMEZONE?.trim() || "America/Mexico_City",
  });
}

if (require.main === module) {
  bootstrapPlatformAdmin(process.env)
    .then((admin) => {
      console.log(JSON.stringify({ adminId: admin.id, email: admin.email, status: "created" }));
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown bootstrap error";
      console.error(JSON.stringify({ error: message, status: "failed" }));
      process.exitCode = 1;
    })
    .finally(disconnectPlatformDatabaseClient);
}
