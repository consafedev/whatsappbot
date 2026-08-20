-- CreateIndex
CREATE UNIQUE INDEX "conversation_tenant_id_id_key" ON "conversation"("tenant_id", "id");
CREATE UNIQUE INDEX "inbound_message_event_tenant_id_key" ON "inbound_message_event"("tenant_id", "id");

-- CreateTable
CREATE TABLE "message" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "channel_account_id" UUID NOT NULL,
    "contact_id" UUID,
    "direction" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "provider_message_id" TEXT,
    "provider_timestamp" TIMESTAMPTZ(3) NOT NULL,
    "message_type" TEXT NOT NULL,
    "text_body" TEXT,
    "structured_payload" JSONB,
    "reply_to_message_id" UUID,
    "delivery_status" TEXT NOT NULL DEFAULT 'received',
    "idempotency_key" TEXT,
    "inbound_event_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "message_tenant_id_key" ON "message"("tenant_id", "id");
CREATE UNIQUE INDEX "message_provider_identity_key"
  ON "message"("tenant_id", "channel_account_id", "provider_message_id");
CREATE UNIQUE INDEX "message_tenant_inbound_event_key"
  ON "message"("tenant_id", "inbound_event_id");
CREATE INDEX "message_tenant_conversation_created_idx"
  ON "message"("tenant_id", "conversation_id", "created_at");
CREATE INDEX "message_tenant_provider_message_idx"
  ON "message"("tenant_id", "provider_message_id");
CREATE INDEX "message_tenant_inbound_event_idx"
  ON "message"("tenant_id", "inbound_event_id");

-- AddForeignKey
ALTER TABLE "message"
  ADD CONSTRAINT "message_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "message"
  ADD CONSTRAINT "message_tenant_id_conversation_id_fkey"
  FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "conversation"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "message"
  ADD CONSTRAINT "message_tenant_id_channel_account_id_fkey"
  FOREIGN KEY ("tenant_id", "channel_account_id") REFERENCES "channel_account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "message"
  ADD CONSTRAINT "message_tenant_id_contact_id_fkey"
  FOREIGN KEY ("tenant_id", "contact_id") REFERENCES "contact"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "message"
  ADD CONSTRAINT "message_tenant_id_inbound_event_id_fkey"
  FOREIGN KEY ("tenant_id", "inbound_event_id") REFERENCES "inbound_message_event"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "message"
  ADD CONSTRAINT "message_tenant_id_reply_to_message_id_fkey"
  FOREIGN KEY ("tenant_id", "reply_to_message_id") REFERENCES "message"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
