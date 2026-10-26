ALTER TABLE "appointment_availability_rules" ADD COLUMN "service_id" UUID;

CREATE UNIQUE INDEX "appointment_services_tenant_id_id_key"
  ON "appointment_services"("tenant_id", "id");

CREATE INDEX "appointment_availability_rules_tenant_service_active_idx"
  ON "appointment_availability_rules"("tenant_id", "service_id", "active");

ALTER TABLE "appointment_availability_rules"
  ADD CONSTRAINT "appointment_availability_rules_tenant_service_fkey"
  FOREIGN KEY ("tenant_id", "service_id")
  REFERENCES "appointment_services"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
