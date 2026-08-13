-- CreateEnum
CREATE TYPE "platform_deployment_mode" AS ENUM ('shared', 'dedicated', 'customer_hosted');

-- CreateEnum
CREATE TYPE "deployment_environment" AS ENUM ('production', 'staging', 'development');

-- CreateEnum
CREATE TYPE "release_channel" AS ENUM ('stable', 'candidate', 'beta');

-- CreateEnum
CREATE TYPE "platform_deployment_status" AS ENUM ('healthy', 'degraded', 'offline', 'maintenance');

-- CreateEnum
CREATE TYPE "tenant_status" AS ENUM ('provisioning', 'active', 'suspended', 'offboarding', 'archived');

-- CreateEnum
CREATE TYPE "tenant_entitlement_source" AS ENUM ('plan', 'manual_override', 'trial', 'contract');

-- CreateEnum
CREATE TYPE "organization_unit_type" AS ENUM ('company', 'branch', 'department', 'team', 'other');

-- CreateTable
CREATE TABLE "platform_deployment" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "platform_deployment_mode" NOT NULL,
    "environment" "deployment_environment" NOT NULL,
    "current_version" TEXT NOT NULL,
    "target_version" TEXT,
    "release_channel" "release_channel" NOT NULL,
    "status" "platform_deployment_status" NOT NULL,
    "base_url" TEXT,
    "metadata" JSONB,
    "last_health_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_deployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant" (
    "id" UUID NOT NULL,
    "deployment_id" UUID,
    "legal_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "tenant_status" NOT NULL,
    "default_timezone" TEXT NOT NULL,
    "default_locale" TEXT NOT NULL,
    "default_currency" TEXT NOT NULL,
    "branding_config" JSONB NOT NULL DEFAULT '{}',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "suspended_at" TIMESTAMPTZ(3),

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_entitlement" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "entitlement_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "limit_value" DECIMAL(20,4),
    "config" JSONB NOT NULL DEFAULT '{}',
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "source" "tenant_entitlement_source" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_entitlement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tenant_entitlement_valid_period_check" CHECK ("ends_at" IS NULL OR "starts_at" IS NULL OR "ends_at" > "starts_at")
);

-- CreateTable
CREATE TABLE "platform_feature_flag" (
    "key" TEXT NOT NULL,
    "enabled_globally" BOOLEAN NOT NULL DEFAULT false,
    "rollout_config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_feature_flag_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "organization_unit" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "parent_id" UUID,
    "type" "organization_unit_type" NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "timezone" TEXT,
    "business_hours_id" UUID,
    "address" JSONB,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organization_unit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_slug_key" ON "tenant"("slug");

-- CreateIndex
CREATE INDEX "tenant_status_idx" ON "tenant"("status");

-- CreateIndex
CREATE INDEX "tenant_deployment_id_idx" ON "tenant"("deployment_id");

-- CreateIndex
CREATE INDEX "tenant_entitlement_tenant_id_idx" ON "tenant_entitlement"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_entitlement_tenant_key_key" ON "tenant_entitlement"("tenant_id", "entitlement_key");

-- CreateIndex
CREATE INDEX "organization_unit_tenant_id_idx" ON "organization_unit"("tenant_id");

-- CreateIndex
CREATE INDEX "organization_unit_parent_id_idx" ON "organization_unit"("parent_id");

-- CreateIndex
CREATE INDEX "organization_unit_tenant_active_idx" ON "organization_unit"("tenant_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "organization_unit_tenant_id_id_key" ON "organization_unit"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "tenant" ADD CONSTRAINT "tenant_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "platform_deployment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_entitlement" ADD CONSTRAINT "tenant_entitlement_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_unit" ADD CONSTRAINT "organization_unit_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_unit" ADD CONSTRAINT "organization_unit_tenant_id_parent_id_fkey" FOREIGN KEY ("tenant_id", "parent_id") REFERENCES "organization_unit"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
