-- AlterTable
ALTER TABLE "organization_unit" ALTER COLUMN "id" SET DEFAULT uuidv7(),
ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "platform_deployment" ALTER COLUMN "id" SET DEFAULT uuidv7(),
ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "platform_feature_flag" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "tenant" ALTER COLUMN "id" SET DEFAULT uuidv7(),
ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "tenant_entitlement" ALTER COLUMN "id" SET DEFAULT uuidv7(),
ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
