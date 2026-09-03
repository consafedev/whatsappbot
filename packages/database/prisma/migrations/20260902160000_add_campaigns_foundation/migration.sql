-- CreateTable
CREATE TABLE "message_template" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'MARKETING',
    "content" TEXT NOT NULL,
    "variables" JSONB DEFAULT '[]'::jsonb,
    "media_url" TEXT,
    "media_type" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_template_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "message_template_tenant_id_key" UNIQUE ("tenant_id", "id"),
    CONSTRAINT "message_template_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "message_template_tenant_category_idx" ON "message_template"("tenant_id", "category");

-- CreateTable
CREATE TABLE "campaign" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "channel_account_id" UUID NOT NULL,
    "template_id" UUID,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "message_content" TEXT NOT NULL,
    "rate_limit_per_minute" INTEGER NOT NULL DEFAULT 30,
    "audience_filter" JSONB DEFAULT '{}'::jsonb,
    "total_recipients" INTEGER NOT NULL DEFAULT 0,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "delivered_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "scheduled_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "campaign_tenant_id_key" UNIQUE ("tenant_id", "id"),
    CONSTRAINT "campaign_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "message_template"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "campaign_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "campaign_channel_account_fkey" FOREIGN KEY ("tenant_id", "channel_account_id") REFERENCES "channel_account"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "campaign_tenant_status_idx" ON "campaign"("tenant_id", "status");
CREATE INDEX "campaign_tenant_scheduled_at_idx" ON "campaign"("tenant_id", "scheduled_at");

-- CreateTable
CREATE TABLE "campaign_audience_member" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "variables" JSONB DEFAULT '{}'::jsonb,
    "error_message" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_audience_member_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "campaign_audience_member_tenant_id_key" UNIQUE ("tenant_id", "id"),
    CONSTRAINT "campaign_audience_unique_recipient" UNIQUE ("campaign_id", "contact_id"),
    CONSTRAINT "campaign_audience_member_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "campaign_audience_member_contact_fkey" FOREIGN KEY ("tenant_id", "contact_id") REFERENCES "contact"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "campaign_audience_member_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "campaign_audience_member_tenant_status_idx" ON "campaign_audience_member"("tenant_id", "status");
CREATE INDEX "campaign_audience_member_campaign_status_idx" ON "campaign_audience_member"("campaign_id", "status");
