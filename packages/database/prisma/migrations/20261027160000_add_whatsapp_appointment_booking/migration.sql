CREATE TYPE "appointment_booking_turn_route" AS ENUM ('UNDECIDED', 'LEGACY', 'BOOKING');
CREATE TYPE "appointment_booking_flow_intent" AS ENUM ('CREATE', 'CANCEL', 'REBOOK');
CREATE TYPE "appointment_booking_flow_phase" AS ENUM (
  'SELECT_SERVICE',
  'SELECT_RESOURCE',
  'SELECT_SLOT',
  'SELECT_APPOINTMENT',
  'CONFIRM_BOOKING',
  'CONFIRM_CANCELLATION',
  'CONFIRM_REBOOKING',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED'
);

CREATE TABLE "appointment_booking_flows" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "tenant_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "contact_id" UUID NOT NULL,
  "channel_account_id" UUID NOT NULL,
  "originating_rule_id" UUID NOT NULL,
  "live_rule_id" UUID,
  "policy_hash" CHAR(64) NOT NULL,
  "policy_snapshot" JSONB NOT NULL,
  "intent" "appointment_booking_flow_intent" NOT NULL,
  "phase" "appointment_booking_flow_phase" NOT NULL,
  "selected_service_id" UUID,
  "selected_resource_id" UUID,
  "selected_appointment_id" UUID,
  "proposed_starts_at" TIMESTAMPTZ(3),
  "proposal_version" INTEGER NOT NULL DEFAULT 1,
  "confirmation_token_hash" CHAR(64),
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "closed_at" TIMESTAMPTZ(3),
  "terminal_reason" VARCHAR(64),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "appointment_booking_flows_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "appointment_booking_flows_proposal_version_check" CHECK ("proposal_version" > 0)
);

CREATE UNIQUE INDEX "appointment_booking_flows_tenant_id_id_key"
  ON "appointment_booking_flows"("tenant_id", "id");
CREATE UNIQUE INDEX "appointment_booking_flows_one_live_conversation_key"
  ON "appointment_booking_flows"("tenant_id", "conversation_id")
  WHERE "closed_at" IS NULL;
CREATE INDEX "appointment_booking_flows_conversation_live_idx"
  ON "appointment_booking_flows"("tenant_id", "conversation_id", "closed_at");
CREATE INDEX "appointment_booking_flows_live_rule_idx"
  ON "appointment_booking_flows"("tenant_id", "live_rule_id");

ALTER TABLE "appointments" ADD COLUMN "booking_flow_id" UUID;
CREATE UNIQUE INDEX "appointments_tenant_booking_flow_key"
  ON "appointments"("tenant_id", "booking_flow_id");

CREATE TABLE "appointment_booking_turns" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "tenant_id" UUID NOT NULL,
  "inbound_message_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "contact_id" UUID NOT NULL,
  "channel_account_id" UUID NOT NULL,
  "created_new_conversation" BOOLEAN NOT NULL DEFAULT FALSE,
  "route" "appointment_booking_turn_route" NOT NULL DEFAULT 'UNDECIDED',
  "originating_rule_id" UUID,
  "live_rule_id" UUID,
  "policy_hash" CHAR(64),
  "policy_snapshot" JSONB,
  "flow_id" UUID,
  "outbound_message_id" UUID,
  "appointment_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "appointment_booking_turns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "appointment_booking_turns_route_data_check" CHECK (
    ("route" = 'UNDECIDED' AND "originating_rule_id" IS NULL AND "live_rule_id" IS NULL AND "policy_hash" IS NULL AND "policy_snapshot" IS NULL AND "flow_id" IS NULL AND "outbound_message_id" IS NULL AND "appointment_id" IS NULL)
    OR ("route" = 'LEGACY' AND "flow_id" IS NULL AND "outbound_message_id" IS NULL AND "appointment_id" IS NULL)
    OR ("route" = 'BOOKING' AND "originating_rule_id" IS NOT NULL AND "policy_hash" IS NOT NULL AND "policy_snapshot" IS NOT NULL AND "flow_id" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "appointment_booking_turns_tenant_id_id_key"
  ON "appointment_booking_turns"("tenant_id", "id");
CREATE UNIQUE INDEX "appointment_booking_turns_tenant_message_key"
  ON "appointment_booking_turns"("tenant_id", "inbound_message_id");
CREATE UNIQUE INDEX "appointment_booking_turns_tenant_outbound_key"
  ON "appointment_booking_turns"("tenant_id", "outbound_message_id");
CREATE INDEX "appointment_booking_turns_conversation_created_idx"
  ON "appointment_booking_turns"("tenant_id", "conversation_id", "created_at");
CREATE INDEX "appointment_booking_turns_flow_idx"
  ON "appointment_booking_turns"("tenant_id", "flow_id");
CREATE INDEX "appointment_booking_turns_live_rule_idx"
  ON "appointment_booking_turns"("tenant_id", "live_rule_id");

ALTER TABLE "appointment_booking_flows" ADD CONSTRAINT "appointment_booking_flows_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointment_booking_flows" ADD CONSTRAINT "appointment_booking_flows_conversation_fkey"
  FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "conversation"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointment_booking_flows" ADD CONSTRAINT "appointment_booking_flows_contact_fkey"
  FOREIGN KEY ("tenant_id", "contact_id") REFERENCES "contact"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointment_booking_flows" ADD CONSTRAINT "appointment_booking_flows_channel_fkey"
  FOREIGN KEY ("tenant_id", "channel_account_id") REFERENCES "channel_account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointment_booking_flows" ADD CONSTRAINT "appointment_booking_flows_live_rule_fkey"
  FOREIGN KEY ("tenant_id", "live_rule_id") REFERENCES "rule"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointment_booking_flows" ADD CONSTRAINT "appointment_booking_flows_service_fkey"
  FOREIGN KEY ("tenant_id", "selected_service_id") REFERENCES "appointment_services"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointment_booking_flows" ADD CONSTRAINT "appointment_booking_flows_resource_fkey"
  FOREIGN KEY ("tenant_id", "selected_resource_id") REFERENCES "appointment_resources"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointment_booking_flows" ADD CONSTRAINT "appointment_booking_flows_selected_appointment_fkey"
  FOREIGN KEY ("tenant_id", "selected_appointment_id") REFERENCES "appointments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_booking_flow_fkey"
  FOREIGN KEY ("tenant_id", "booking_flow_id") REFERENCES "appointment_booking_flows"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "appointment_booking_turns" ADD CONSTRAINT "appointment_booking_turns_tenant_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointment_booking_turns" ADD CONSTRAINT "appointment_booking_turns_message_fkey"
  FOREIGN KEY ("tenant_id", "inbound_message_id") REFERENCES "message"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "appointment_booking_turns" ADD CONSTRAINT "appointment_booking_turns_conversation_fkey"
  FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "conversation"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointment_booking_turns" ADD CONSTRAINT "appointment_booking_turns_contact_fkey"
  FOREIGN KEY ("tenant_id", "contact_id") REFERENCES "contact"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointment_booking_turns" ADD CONSTRAINT "appointment_booking_turns_channel_fkey"
  FOREIGN KEY ("tenant_id", "channel_account_id") REFERENCES "channel_account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointment_booking_turns" ADD CONSTRAINT "appointment_booking_turns_live_rule_fkey"
  FOREIGN KEY ("tenant_id", "live_rule_id") REFERENCES "rule"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointment_booking_turns" ADD CONSTRAINT "appointment_booking_turns_flow_fkey"
  FOREIGN KEY ("tenant_id", "flow_id") REFERENCES "appointment_booking_flows"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointment_booking_turns" ADD CONSTRAINT "appointment_booking_turns_outbound_fkey"
  FOREIGN KEY ("tenant_id", "outbound_message_id") REFERENCES "outbound_message"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointment_booking_turns" ADD CONSTRAINT "appointment_booking_turns_appointment_fkey"
  FOREIGN KEY ("tenant_id", "appointment_id") REFERENCES "appointments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
