-- CreateTable
CREATE TABLE "rule" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trigger_type" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "execution_mode" TEXT NOT NULL DEFAULT 'first_match_stop',
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "cooldown_seconds" INTEGER NOT NULL DEFAULT 0,
    "channel_account_id" UUID,
    "organization_unit_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rule_tenant_id_key" ON "rule"("tenant_id", "id");
CREATE INDEX "rule_tenant_status_trigger_priority_idx" ON "rule"("tenant_id", "status", "trigger_type", "priority");
CREATE INDEX "rule_tenant_channel_account_idx" ON "rule"("tenant_id", "channel_account_id");

-- AddForeignKey
ALTER TABLE "rule" ADD CONSTRAINT "rule_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rule" ADD CONSTRAINT "rule_tenant_id_channel_account_id_fkey" FOREIGN KEY ("tenant_id", "channel_account_id") REFERENCES "channel_account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rule" ADD CONSTRAINT "rule_tenant_id_organization_unit_id_fkey" FOREIGN KEY ("tenant_id", "organization_unit_id") REFERENCES "organization_unit"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
