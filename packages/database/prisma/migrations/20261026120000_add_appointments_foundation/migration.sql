CREATE TYPE "AppointmentStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW', 'RESCHEDULED');
CREATE TYPE "AppointmentConfirmationStatus" AS ENUM ('PENDING', 'CONFIRMED');

CREATE TABLE "appointments" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "tenant_id" UUID NOT NULL,
  "organization_unit_id" UUID,
  "contact_id" UUID NOT NULL,
  "service_id" UUID NOT NULL,
  "resource_id" UUID,
  "created_by_user_id" UUID,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "status" "AppointmentStatus" NOT NULL DEFAULT 'CONFIRMED',
  "confirmation_status" "AppointmentConfirmationStatus" NOT NULL DEFAULT 'CONFIRMED',
  "starts_at" TIMESTAMPTZ(3) NOT NULL,
  "ends_at" TIMESTAMPTZ(3) NOT NULL,
  "occupied_starts_at" TIMESTAMPTZ(3) NOT NULL,
  "occupied_ends_at" TIMESTAMPTZ(3) NOT NULL,
  "duration_minutes" INTEGER NOT NULL,
  "buffer_before_minutes" INTEGER NOT NULL,
  "buffer_after_minutes" INTEGER NOT NULL,
  "timezone_snapshot" VARCHAR(100) NOT NULL,
  "source" VARCHAR(30) NOT NULL,
  "notes" VARCHAR(2000),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "appointments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "appointments_positive_interval_check" CHECK ("starts_at" < "ends_at" AND "occupied_starts_at" <= "starts_at" AND "ends_at" <= "occupied_ends_at"),
  CONSTRAINT "appointments_snapshot_nonnegative_check" CHECK ("duration_minutes" > 0 AND "buffer_before_minutes" >= 0 AND "buffer_after_minutes" >= 0)
);

CREATE UNIQUE INDEX "appointments_tenant_id_id_key" ON "appointments"("tenant_id", "id");
CREATE UNIQUE INDEX "appointments_tenant_idempotency_key" ON "appointments"("tenant_id", "idempotency_key");
CREATE INDEX "appointments_resource_occupied_idx" ON "appointments"("tenant_id", "resource_id", "status", "occupied_starts_at", "occupied_ends_at");
CREATE INDEX "appointments_tenant_starts_idx" ON "appointments"("tenant_id", "starts_at", "id");
CREATE INDEX "appointments_contact_starts_idx" ON "appointments"("tenant_id", "contact_id", "starts_at");

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_unit_fkey" FOREIGN KEY ("tenant_id", "organization_unit_id") REFERENCES "organization_unit"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_contact_fkey" FOREIGN KEY ("tenant_id", "contact_id") REFERENCES "contact"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_fkey" FOREIGN KEY ("tenant_id", "service_id") REFERENCES "appointment_services"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_resource_fkey" FOREIGN KEY ("tenant_id", "resource_id") REFERENCES "appointment_resources"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_creator_fkey" FOREIGN KEY ("tenant_id", "created_by_user_id") REFERENCES "tenant_user"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
