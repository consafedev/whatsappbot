-- CreateEnum
CREATE TYPE "AppointmentResourceType" AS ENUM ('PRACTITIONER', 'FACILITY', 'ROOM', 'EQUIPMENT', 'OTHER');

-- CreateTable
CREATE TABLE "appointment_resources" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "organization_unit_id" UUID,
    "user_id" UUID,
    "type" "AppointmentResourceType" NOT NULL DEFAULT 'PRACTITIONER',
    "name" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointment_resources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointment_resources_tenant_id_active_idx" ON "appointment_resources"("tenant_id", "active");

-- CreateIndex
CREATE INDEX "appointment_resources_tenant_id_type_idx" ON "appointment_resources"("tenant_id", "type");

-- CreateIndex
CREATE INDEX "appointment_resources_tenant_id_organization_unit_id_idx" ON "appointment_resources"("tenant_id", "organization_unit_id");

-- CreateIndex
CREATE INDEX "appointment_resources_tenant_id_user_id_idx" ON "appointment_resources"("tenant_id", "user_id");

-- AddForeignKey
ALTER TABLE "appointment_resources" ADD CONSTRAINT "appointment_resources_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_resources" ADD CONSTRAINT "appointment_resources_tenant_id_organization_unit_id_fkey" FOREIGN KEY ("tenant_id", "organization_unit_id") REFERENCES "organization_unit"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_resources" ADD CONSTRAINT "appointment_resources_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "tenant_user"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
