-- CreateTable
CREATE TABLE "appointment_availability_rules" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "start_time" VARCHAR(5) NOT NULL,
    "end_time" VARCHAR(5) NOT NULL,
    "timezone" VARCHAR(100),
    "effective_from" DATE,
    "effective_to" DATE,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointment_availability_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointment_availability_rules_tenant_id_resource_id_day_of_idx" ON "appointment_availability_rules"("tenant_id", "resource_id", "day_of_week");

-- CreateIndex
CREATE INDEX "appointment_availability_rules_tenant_id_active_idx" ON "appointment_availability_rules"("tenant_id", "active");

-- AppointmentResource's primary key is id alone. The composite unique key lets
-- PostgreSQL enforce that a rule's tenant matches its resource's tenant.
CREATE UNIQUE INDEX "appointment_resources_tenant_id_id_key" ON "appointment_resources"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "appointment_availability_rules" ADD CONSTRAINT "appointment_availability_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_availability_rules" ADD CONSTRAINT "appointment_availability_rules_tenant_id_resource_id_fkey" FOREIGN KEY ("tenant_id", "resource_id") REFERENCES "appointment_resources"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
