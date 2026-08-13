-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "organization_unit_id" UUID,
    "before_summary" JSONB,
    "after_summary" JSONB,
    "request_id" TEXT NOT NULL,
    "ip_metadata" JSONB,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_log_platform_organization_unit_check" CHECK ("tenant_id" IS NOT NULL OR "organization_unit_id" IS NULL)
);

-- CreateIndex
CREATE INDEX "audit_log_tenant_occurred_at_idx" ON "audit_log"("tenant_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_entity_occurred_at_idx" ON "audit_log"("entity_type", "entity_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_request_id_idx" ON "audit_log"("request_id");

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_organization_unit_id_fkey" FOREIGN KEY ("tenant_id", "organization_unit_id") REFERENCES "organization_unit"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
