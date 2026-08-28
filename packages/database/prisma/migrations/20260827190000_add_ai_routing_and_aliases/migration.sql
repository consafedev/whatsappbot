-- CreateTable
CREATE TABLE "ai_virtual_alias" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID,
    "alias_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_virtual_alias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_model_route" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "virtual_alias_id" UUID NOT NULL,
    "provider_config_id" UUID NOT NULL,
    "target_model_id" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "timeout_ms" INTEGER NOT NULL DEFAULT 10000,
    "max_retries" INTEGER NOT NULL DEFAULT 2,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_model_route_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes
CREATE UNIQUE INDEX "ai_virtual_alias_tenant_alias_key" ON "ai_virtual_alias"("tenant_id", "alias_key");
CREATE UNIQUE INDEX "ai_virtual_alias_global_alias_key" ON "ai_virtual_alias"("alias_key") WHERE "tenant_id" IS NULL;
CREATE INDEX "ai_virtual_alias_tenant_idx" ON "ai_virtual_alias"("tenant_id");

CREATE INDEX "ai_model_route_alias_priority_idx" ON "ai_model_route"("virtual_alias_id", "priority");

-- AddForeignKey
ALTER TABLE "ai_virtual_alias" ADD CONSTRAINT "ai_virtual_alias_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_model_route" ADD CONSTRAINT "ai_model_route_virtual_alias_id_fkey" FOREIGN KEY ("virtual_alias_id") REFERENCES "ai_virtual_alias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_model_route" ADD CONSTRAINT "ai_model_route_provider_config_id_fkey" FOREIGN KEY ("provider_config_id") REFERENCES "ai_provider_config"("id") ON DELETE CASCADE ON UPDATE CASCADE;