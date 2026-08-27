-- CreateTable
CREATE TABLE "ai_provider_config" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID,
    "name" TEXT NOT NULL,
    "provider_type" TEXT NOT NULL,
    "base_url" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_provider_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_key_pool" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "provider_config_id" UUID NOT NULL,
    "encrypted_key" TEXT NOT NULL,
    "key_mask" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "rate_limited_until" TIMESTAMPTZ(3),
    "priority" INTEGER NOT NULL DEFAULT 1,
    "total_calls" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_key_pool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_log" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "channel_account_id" UUID,
    "conversation_id" UUID,
    "provider_type" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_estimated_usd" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_provider_config_tenant_enabled_idx" ON "ai_provider_config"("tenant_id", "is_enabled");
CREATE INDEX "ai_key_pool_config_status_idx" ON "ai_key_pool"("provider_config_id", "status");
CREATE INDEX "ai_usage_log_tenant_created_idx" ON "ai_usage_log"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "ai_provider_config" ADD CONSTRAINT "ai_provider_config_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_key_pool" ADD CONSTRAINT "ai_key_pool_provider_config_id_fkey" FOREIGN KEY ("provider_config_id") REFERENCES "ai_provider_config"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
