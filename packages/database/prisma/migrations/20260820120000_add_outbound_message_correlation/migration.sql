-- E06-S04: persist the canonical outbound Message before provider dispatch.
ALTER TABLE "message" ALTER COLUMN "provider_timestamp" DROP NOT NULL;

ALTER TABLE "message" ADD COLUMN "outbound_message_id" UUID;

CREATE UNIQUE INDEX "outbound_message_tenant_id_key"
  ON "outbound_message"("tenant_id", "id");

CREATE UNIQUE INDEX "message_tenant_idempotency_key"
  ON "message"("tenant_id", "idempotency_key");

CREATE UNIQUE INDEX "message_tenant_outbound_message_key"
  ON "message"("tenant_id", "outbound_message_id");

CREATE INDEX "message_tenant_outbound_message_idx"
  ON "message"("tenant_id", "outbound_message_id");

ALTER TABLE "message"
  ADD CONSTRAINT "message_tenant_outbound_message_fkey"
  FOREIGN KEY ("tenant_id", "outbound_message_id")
  REFERENCES "outbound_message"("tenant_id", "id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
