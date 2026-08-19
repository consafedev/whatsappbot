-- CreateTable: InboundMessageEvent
CREATE TABLE "inbound_message_event" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "channel_account_id" UUID NOT NULL,
    "provider_message_id" TEXT,
    "event_type" TEXT NOT NULL DEFAULT 'MESSAGE_RECEIVED',
    "sender_phone" TEXT,
    "recipient_phone" TEXT,
    "message_type" TEXT,
    "payload" JSONB NOT NULL,
    "normalized_data" JSONB,
    "processed_status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "inbound_message_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inbound_message_event_tenant_channel_idx"
  ON "inbound_message_event"("tenant_id", "channel_account_id");
CREATE INDEX "inbound_message_event_tenant_status_idx"
  ON "inbound_message_event"("tenant_id", "processed_status");
CREATE UNIQUE INDEX "inbound_message_event_provider_message_key"
  ON "inbound_message_event"("tenant_id", "channel_account_id", "provider_message_id");

ALTER TABLE "inbound_message_event"
  ADD CONSTRAINT "inbound_message_event_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inbound_message_event"
  ADD CONSTRAINT "inbound_message_event_channel_account_id_fkey"
  FOREIGN KEY ("channel_account_id") REFERENCES "channel_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
