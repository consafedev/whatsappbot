ALTER TABLE "appointments" ADD COLUMN "rescheduled_from_id" UUID;

CREATE UNIQUE INDEX "appointments_tenant_rescheduled_from_key"
  ON "appointments"("tenant_id", "rescheduled_from_id");

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_rescheduled_from_fkey"
  FOREIGN KEY ("tenant_id", "rescheduled_from_id")
  REFERENCES "appointments"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
