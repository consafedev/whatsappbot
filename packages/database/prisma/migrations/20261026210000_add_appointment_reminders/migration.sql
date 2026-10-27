CREATE TYPE "appointment_reminder_status" AS ENUM (
  'PENDING',
  'QUEUED',
  'CANCELLED',
  'SUPPRESSED'
);

ALTER TABLE "appointments"
  ADD COLUMN "reminder_policy" JSONB;

CREATE TABLE "appointment_reminders" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "tenant_id" UUID NOT NULL,
  "appointment_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "offset_minutes" INTEGER NOT NULL,
  "due_at" TIMESTAMPTZ(3) NOT NULL,
  "status" "appointment_reminder_status" NOT NULL DEFAULT 'PENDING',
  "reason" VARCHAR(64),
  "task_id" UUID,
  "outbound_message_id" UUID,
  "dispatch_authorized_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "appointment_reminders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "appointment_reminders_tenant_offset_check"
    CHECK ("offset_minutes" BETWEEN 1 AND 10080),
  CONSTRAINT "appointment_reminders_state_check"
    CHECK (
      ("status" = 'PENDING' AND "task_id" IS NOT NULL AND "outbound_message_id" IS NULL AND "reason" IS NULL)
      OR ("status" = 'QUEUED' AND "task_id" IS NOT NULL AND "outbound_message_id" IS NOT NULL AND "reason" IS NULL)
      OR ("status" = 'CANCELLED' AND "reason" IS NULL)
      OR ("status" = 'SUPPRESSED' AND "reason" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "appointment_reminder_tenant_id_key"
  ON "appointment_reminders"("tenant_id", "id");
CREATE UNIQUE INDEX "appointment_reminder_tenant_appt_offset_key"
  ON "appointment_reminders"("tenant_id", "appointment_id", "offset_minutes");
CREATE UNIQUE INDEX "appointment_reminder_tenant_task_key"
  ON "appointment_reminders"("tenant_id", "task_id");
CREATE UNIQUE INDEX "appointment_reminder_tenant_outbound_key"
  ON "appointment_reminders"("tenant_id", "outbound_message_id");
CREATE INDEX "appointment_reminder_tenant_status_due_idx"
  ON "appointment_reminders"("tenant_id", "status", "due_at");

ALTER TABLE "appointment_reminders"
  ADD CONSTRAINT "appointment_reminders_tenant_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "appointment_reminders_appointment_fkey"
    FOREIGN KEY ("tenant_id", "appointment_id") REFERENCES "appointments"("tenant_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "appointment_reminders_conversation_fkey"
    FOREIGN KEY ("tenant_id", "conversation_id") REFERENCES "conversation"("tenant_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "appointment_reminders_task_fkey"
    FOREIGN KEY ("tenant_id", "task_id") REFERENCES "scheduled_tasks"("tenant_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "appointment_reminders_outbound_fkey"
    FOREIGN KEY ("tenant_id", "outbound_message_id") REFERENCES "outbound_message"("tenant_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
