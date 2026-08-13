CREATE TYPE "user_status" AS ENUM ('active', 'disabled');
CREATE TYPE "user_mfa_state" AS ENUM ('disabled', 'enabled');

CREATE TABLE "tenant_user" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" "user_status" NOT NULL DEFAULT 'active',
    "locale" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "last_login_at" TIMESTAMPTZ(3),
    "mfa_state" "user_mfa_state" NOT NULL DEFAULT 'disabled',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tenant_user_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_session" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "device_label" TEXT,
    "ip_hash" BYTEA,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    CONSTRAINT "user_session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_password_reset_token" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    CONSTRAINT "user_password_reset_token_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_user_tenant_email_key" ON "tenant_user"("tenant_id", "email");
CREATE UNIQUE INDEX "tenant_user_tenant_id_id_key" ON "tenant_user"("tenant_id", "id");
CREATE INDEX "tenant_user_tenant_status_idx" ON "tenant_user"("tenant_id", "status");
CREATE UNIQUE INDEX "user_session_token_hash_key" ON "user_session"("token_hash");
CREATE INDEX "user_session_tenant_user_idx" ON "user_session"("tenant_id", "user_id");
CREATE INDEX "user_session_expires_at_idx" ON "user_session"("expires_at");
CREATE UNIQUE INDEX "user_password_reset_token_hash_key" ON "user_password_reset_token"("token_hash");
CREATE INDEX "user_password_reset_tenant_user_idx" ON "user_password_reset_token"("tenant_id", "user_id");
CREATE INDEX "user_password_reset_expires_at_idx" ON "user_password_reset_token"("expires_at");

ALTER TABLE "tenant_user" ADD CONSTRAINT "tenant_user_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_session" ADD CONSTRAINT "user_session_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_session" ADD CONSTRAINT "user_session_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "tenant_user"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_password_reset_token" ADD CONSTRAINT "user_password_reset_token_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_password_reset_token" ADD CONSTRAINT "user_password_reset_token_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "tenant_user"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
