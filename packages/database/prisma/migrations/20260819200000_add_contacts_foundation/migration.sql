-- CreateTable
CREATE TABLE "contact" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Sin Nombre',
    "phone_number" TEXT NOT NULL,
    "email" TEXT,
    "avatar_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "custom_attributes" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contact_tenant_phone_number_key" ON "contact"("tenant_id", "phone_number");
CREATE INDEX "contact_tenant_id_idx" ON "contact"("tenant_id");
CREATE INDEX "contact_tenant_status_idx" ON "contact"("tenant_id", "status");
CREATE INDEX "contact_tenant_name_idx" ON "contact"("tenant_id", "name");

-- AddForeignKey
ALTER TABLE "contact"
  ADD CONSTRAINT "contact_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
