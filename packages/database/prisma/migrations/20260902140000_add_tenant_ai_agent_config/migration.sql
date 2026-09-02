-- CreateTable
CREATE TABLE "tenant_ai_agent_config" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "automation_mode" TEXT NOT NULL DEFAULT 'HYBRID_RULES_AI',
    "system_directives" TEXT,
    "virtual_alias_key" TEXT NOT NULL DEFAULT 'platform-smart',
    "min_confidence_score" DECIMAL(3,2) NOT NULL DEFAULT 0.70,
    "human_handoff_keywords" JSONB DEFAULT '["humano", "asesor", "persona", "agente", "ayuda"]',
    "out_of_hours_reply" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_ai_agent_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_ai_agent_config_tenant_id_key" ON "tenant_ai_agent_config"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_ai_agent_config_tenant_id_id_key" ON "tenant_ai_agent_config"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "tenant_ai_agent_config_tenant_enabled_idx" ON "tenant_ai_agent_config"("tenant_id", "is_enabled");

-- AddForeignKey
ALTER TABLE "tenant_ai_agent_config" ADD CONSTRAINT "tenant_ai_agent_config_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
