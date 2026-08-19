-- CreateTable: ChannelAccount
CREATE TABLE "channel_account" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "organization_unit_id" UUID,
    "channel_type" TEXT NOT NULL DEFAULT 'whatsapp',
    "provider_type" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "external_account_id" TEXT,
    "phone_number" TEXT,
    "phone_number_unique_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "automation_default_mode" TEXT,
    "credentials_ciphertext" TEXT,
    "credentials_key_version" INTEGER,
    "provider_config" JSONB,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "last_connected_at" TIMESTAMPTZ(3),
    "last_disconnected_at" TIMESTAMPTZ(3),
    "last_error_code" TEXT,
    "last_error_at" TIMESTAMPTZ(3),
    "health_status" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "channel_account_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "channel_account_tenant_phone_active_key"
  ON "channel_account"("tenant_id", "phone_number_unique_key");
CREATE INDEX "channel_account_tenant_id_idx" ON "channel_account"("tenant_id");
CREATE INDEX "channel_account_tenant_status_idx" ON "channel_account"("tenant_id", "status");

ALTER TABLE "channel_account"
  ADD CONSTRAINT "channel_account_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "channel_account"
  ADD CONSTRAINT "channel_account_tenant_id_organization_unit_id_fkey"
  FOREIGN KEY ("tenant_id", "organization_unit_id") REFERENCES "organization_unit"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
