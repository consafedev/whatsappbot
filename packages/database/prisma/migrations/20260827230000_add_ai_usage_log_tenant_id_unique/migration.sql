-- CreateIndex
CREATE UNIQUE INDEX "ai_usage_log_tenant_id_key" ON "ai_usage_log"("tenant_id", "id");
