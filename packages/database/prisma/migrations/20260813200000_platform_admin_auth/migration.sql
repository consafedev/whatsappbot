-- CreateEnum
CREATE TYPE "platform_admin_status" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "platform_admin_mfa_state" AS ENUM ('disabled', 'enabled');

-- CreateTable
CREATE TABLE "platform_admin" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" "platform_admin_status" NOT NULL DEFAULT 'active',
    "locale" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "last_login_at" TIMESTAMPTZ(3),
    "mfa_state" "platform_admin_mfa_state" NOT NULL DEFAULT 'disabled',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_admin_session" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "platform_admin_id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "device_label" TEXT,
    "ip_hash" BYTEA,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "platform_admin_session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_admin_email_key" ON "platform_admin"("email");

-- CreateIndex
CREATE INDEX "platform_admin_status_idx" ON "platform_admin"("status");

-- CreateIndex
CREATE UNIQUE INDEX "platform_admin_session_token_hash_key" ON "platform_admin_session"("token_hash");

-- CreateIndex
CREATE INDEX "platform_admin_session_admin_id_idx" ON "platform_admin_session"("platform_admin_id");

-- CreateIndex
CREATE INDEX "platform_admin_session_expires_at_idx" ON "platform_admin_session"("expires_at");

-- AddForeignKey
ALTER TABLE "platform_admin_session" ADD CONSTRAINT "platform_admin_session_platform_admin_id_fkey" FOREIGN KEY ("platform_admin_id") REFERENCES "platform_admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
