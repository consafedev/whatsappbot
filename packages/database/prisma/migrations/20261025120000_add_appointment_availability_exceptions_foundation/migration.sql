CREATE TYPE "AppointmentAvailabilityExceptionType" AS ENUM ('BLOCKED', 'EXTRA_AVAILABILITY');

CREATE TABLE "appointment_availability_exceptions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    "type" "AppointmentAvailabilityExceptionType" NOT NULL DEFAULT 'BLOCKED',
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" VARCHAR(255),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointment_availability_exceptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "appointment_availability_exceptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "appointment_availability_exceptions_tenant_id_resource_id_fkey" FOREIGN KEY ("tenant_id", "resource_id") REFERENCES "appointment_resources"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "appt_avail_exc_tenant_resource_time_idx" ON "appointment_availability_exceptions"("tenant_id", "resource_id", "starts_at", "ends_at");
CREATE INDEX "appt_avail_exc_tenant_active_start_idx" ON "appointment_availability_exceptions"("tenant_id", "active", "starts_at");
