-- CreateIndex
CREATE UNIQUE INDEX "channel_account_tenant_id_id_key" ON "channel_account"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_tenant_id_id_key" ON "contact"("tenant_id", "id");

-- CreateTable
CREATE TABLE "conversation" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "channel_account_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "automation_mode" TEXT NOT NULL DEFAULT 'AUTO',
    "assigned_user_id" UUID,
    "assigned_unit_id" UUID,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "subject" TEXT,
    "provider_thread_id" TEXT,
    "last_message_at" TIMESTAMPTZ(3),
    "last_inbound_at" TIMESTAMPTZ(3),
    "last_outbound_at" TIMESTAMPTZ(3),
    "last_human_message_at" TIMESTAMPTZ(3),
    "last_automation_message_at" TIMESTAMPTZ(3),
    "human_takeover_until" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversation_tenant_status_last_message_idx" ON "conversation"("tenant_id", "status", "last_message_at");
CREATE INDEX "conversation_tenant_contact_idx" ON "conversation"("tenant_id", "contact_id");
CREATE INDEX "conversation_tenant_channel_idx" ON "conversation"("tenant_id", "channel_account_id");
CREATE INDEX "conversation_tenant_assigned_user_idx" ON "conversation"("tenant_id", "assigned_user_id");
CREATE INDEX "conversation_tenant_assigned_unit_idx" ON "conversation"("tenant_id", "assigned_unit_id");
CREATE INDEX "conversation_tenant_resolution_idx" ON "conversation"("tenant_id", "channel_account_id", "contact_id", "status");

-- AddForeignKey
ALTER TABLE "conversation"
  ADD CONSTRAINT "conversation_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversation"
  ADD CONSTRAINT "conversation_tenant_id_channel_account_id_fkey"
  FOREIGN KEY ("tenant_id", "channel_account_id") REFERENCES "channel_account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversation"
  ADD CONSTRAINT "conversation_tenant_id_contact_id_fkey"
  FOREIGN KEY ("tenant_id", "contact_id") REFERENCES "contact"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversation"
  ADD CONSTRAINT "conversation_tenant_id_assigned_user_id_fkey"
  FOREIGN KEY ("tenant_id", "assigned_user_id") REFERENCES "tenant_user"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversation"
  ADD CONSTRAINT "conversation_tenant_id_assigned_unit_id_fkey"
  FOREIGN KEY ("tenant_id", "assigned_unit_id") REFERENCES "organization_unit"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
