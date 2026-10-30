CREATE TABLE "quote_policy" (
    "tenant_id" UUID NOT NULL,
    "autonomy_level" SMALLINT NOT NULL DEFAULT 0,
    "max_auto_send_amount" DECIMAL(24,4),
    "max_auto_send_currency" CHAR(3),
    "max_discount_percent" DECIMAL(9,4),
    "min_margin_percent" DECIMAL(9,4),
    "require_stock" BOOLEAN NOT NULL DEFAULT false,
    "new_customer_requires_approval" BOOLEAN NOT NULL DEFAULT true,
    "exceptional_product_requires_approval" BOOLEAN NOT NULL DEFAULT true,
    "allow_self_approval" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "content_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_policy_pkey" PRIMARY KEY ("tenant_id"),
    CONSTRAINT "quote_policy_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "quote_policy_autonomy_level_check" CHECK ("autonomy_level" BETWEEN 0 AND 3),
    CONSTRAINT "quote_policy_revision_check" CHECK ("revision" > 0),
    CONSTRAINT "quote_policy_auto_amount_currency_pair_check" CHECK (
        ("max_auto_send_amount" IS NULL AND "max_auto_send_currency" IS NULL)
        OR
        ("max_auto_send_amount" IS NOT NULL AND "max_auto_send_currency" IS NOT NULL AND "max_auto_send_amount" >= 0 AND "max_auto_send_currency" ~ '^[A-Z]{3}$')
    ),
    CONSTRAINT "quote_policy_auto_amount_required_for_autonomy_check" CHECK (
        "autonomy_level" < 2 OR ("max_auto_send_amount" IS NOT NULL AND "max_auto_send_currency" IS NOT NULL)
    ),
    CONSTRAINT "quote_policy_max_discount_percent_check" CHECK (
        "max_discount_percent" IS NULL OR "max_discount_percent" BETWEEN 0 AND 100
    ),
    CONSTRAINT "quote_policy_min_margin_percent_check" CHECK (
        "min_margin_percent" IS NULL OR "min_margin_percent" BETWEEN 0 AND 100
    ),
    CONSTRAINT "quote_policy_hash_check" CHECK ("content_hash" ~ '^[0-9a-f]{64}$')
);
