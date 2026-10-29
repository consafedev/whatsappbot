CREATE TABLE "quotes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "organization_unit_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "number_sequence" BIGINT NOT NULL,
    "number" VARCHAR(12) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'draft',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "autonomy_level" INTEGER NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL,
    "currency_precision" INTEGER NOT NULL,
    "valid_until" TIMESTAMPTZ(3),
    "terms" VARCHAR(8000),
    "notes" VARCHAR(4000),
    "shipping_total" NUMERIC(19,4) NOT NULL DEFAULT 0,
    "subtotal" NUMERIC(24,4),
    "discount_total" NUMERIC(24,4),
    "tax_total" NUMERIC(24,4),
    "total" NUMERIC(24,4),
    "calculated_revision" INTEGER,
    "calculation_input_hash" CHAR(64),
    "customer_name_snapshot" VARCHAR(150) NOT NULL,
    "customer_phone_snapshot" VARCHAR(64) NOT NULL,
    "organization_unit_name_snapshot" VARCHAR(150) NOT NULL,
    "salesperson_name_snapshot" VARCHAR(150) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "quotes_number_sequence_check" CHECK ("number_sequence" BETWEEN 1 AND 9999999999),
    CONSTRAINT "quotes_number_format_check" CHECK ("number" = 'Q-' || lpad("number_sequence"::text, GREATEST(6, length("number_sequence"::text)), '0')),
    CONSTRAINT "quotes_status_check" CHECK ("status" = 'draft'),
    CONSTRAINT "quotes_revision_check" CHECK ("revision" >= 1),
    CONSTRAINT "quotes_autonomy_level_check" CHECK ("autonomy_level" = 0),
    CONSTRAINT "quotes_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "quotes_currency_precision_check" CHECK ("currency_precision" BETWEEN 0 AND 4),
    CONSTRAINT "quotes_shipping_total_check" CHECK ("shipping_total" BETWEEN 0 AND 999999999.9999),
    CONSTRAINT "quotes_calculation_marker_check" CHECK (
        ("calculated_revision" IS NULL AND "calculation_input_hash" IS NULL AND "subtotal" IS NULL AND "discount_total" IS NULL AND "tax_total" IS NULL AND "total" IS NULL)
        OR ("calculated_revision" IS NOT NULL AND "calculation_input_hash" IS NOT NULL AND "calculated_revision" = "revision" AND "calculation_input_hash" ~ '^[0-9a-f]{64}$' AND "subtotal" IS NOT NULL AND "discount_total" IS NOT NULL AND "tax_total" IS NOT NULL AND "total" IS NOT NULL)
    )
);

CREATE TABLE "quote_items" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "product_id" UUID,
    "source" VARCHAR(16) NOT NULL,
    "sku" VARCHAR(64),
    "description" VARCHAR(2000) NOT NULL,
    "unit" VARCHAR(32) NOT NULL,
    "quantity" NUMERIC(9,3) NOT NULL,
    "unit_price" NUMERIC(19,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "tax_code" VARCHAR(64),
    "tax_rate" NUMERIC(9,4),
    "discount_kind" VARCHAR(16) NOT NULL DEFAULT 'fixed',
    "discount_value" NUMERIC(19,4) NOT NULL DEFAULT 0,
    "gross_total" NUMERIC(24,4),
    "discount_total" NUMERIC(24,4),
    "net_total" NUMERIC(24,4),
    "tax_total" NUMERIC(24,4),
    "line_total" NUMERIC(24,4),
    "is_exceptional" BOOLEAN NOT NULL DEFAULT FALSE,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "quote_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "quote_items_source_check" CHECK (("source" = 'catalog' AND "product_id" IS NOT NULL) OR ("source" = 'manual' AND "product_id" IS NULL)),
    CONSTRAINT "quote_items_position_check" CHECK ("position" BETWEEN 0 AND 199),
    CONSTRAINT "quote_items_quantity_check" CHECK ("quantity" > 0 AND "quantity" <= 999999.999),
    CONSTRAINT "quote_items_unit_price_check" CHECK ("unit_price" BETWEEN 0 AND 999999999.9999),
    CONSTRAINT "quote_items_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "quote_items_tax_rate_check" CHECK ("tax_rate" IS NULL OR "tax_rate" BETWEEN 0 AND 100),
    CONSTRAINT "quote_items_discount_kind_check" CHECK ("discount_kind" IN ('fixed', 'percent')),
    CONSTRAINT "quote_items_discount_value_check" CHECK ("discount_value" >= 0 AND ("discount_kind" <> 'percent' OR "discount_value" <= 100)),
    CONSTRAINT "quote_items_calculation_check" CHECK (
        ("gross_total" IS NULL AND "discount_total" IS NULL AND "net_total" IS NULL AND "tax_total" IS NULL AND "line_total" IS NULL)
        OR ("gross_total" IS NOT NULL AND "discount_total" IS NOT NULL AND "net_total" IS NOT NULL AND "tax_total" IS NOT NULL AND "line_total" IS NOT NULL)
    ),
    CONSTRAINT "quote_items_metadata_check" CHECK ("metadata" IS NULL OR (jsonb_typeof("metadata") = 'object' AND octet_length("metadata"::text) <= 16384))
);

CREATE TABLE "quote_command_receipts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    "quote_id" UUID,
    "actor_user_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "command_type" VARCHAR(32) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "recorded_outcome" JSONB NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "quote_command_receipts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "quote_command_receipts_hash_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "quote_command_receipts_resource_check" CHECK (("quote_id" IS NULL AND "resource_id" = "tenant_id") OR ("quote_id" IS NOT NULL AND "resource_id" = "quote_id")),
    CONSTRAINT "quote_command_receipts_outcome_check" CHECK (jsonb_typeof("recorded_outcome") = 'object' AND octet_length("recorded_outcome"::text) <= 16384)
);

CREATE TABLE "quote_commercial_contributors" (
    "tenant_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "first_contributed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "quote_commercial_contributors_pkey" PRIMARY KEY ("tenant_id", "quote_id", "user_id")
);

CREATE UNIQUE INDEX "quotes_tenant_id_id_key" ON "quotes"("tenant_id", "id");
CREATE UNIQUE INDEX "quotes_tenant_number_sequence_key" ON "quotes"("tenant_id", "number_sequence");
CREATE UNIQUE INDEX "quotes_tenant_number_key" ON "quotes"("tenant_id", "number");
CREATE INDEX "quotes_tenant_status_created_idx" ON "quotes"("tenant_id", "status", "created_at", "id");
CREATE INDEX "quotes_tenant_contact_created_idx" ON "quotes"("tenant_id", "contact_id", "created_at");

CREATE UNIQUE INDEX "quote_items_tenant_id_id_key" ON "quote_items"("tenant_id", "id");
CREATE UNIQUE INDEX "quote_items_tenant_quote_position_key" ON "quote_items"("tenant_id", "quote_id", "position");
CREATE INDEX "quote_items_tenant_quote_position_idx" ON "quote_items"("tenant_id", "quote_id", "position");
CREATE INDEX "quote_items_tenant_product_idx" ON "quote_items"("tenant_id", "product_id");

CREATE UNIQUE INDEX "quote_command_receipts_tenant_id_id_key" ON "quote_command_receipts"("tenant_id", "id");
CREATE UNIQUE INDEX "quote_command_receipts_tenant_key_key" ON "quote_command_receipts"("tenant_id", "idempotency_key");
CREATE INDEX "quote_command_receipts_tenant_resource_recorded_idx" ON "quote_command_receipts"("tenant_id", "resource_id", "recorded_at");
CREATE INDEX "quote_commercial_contributors_tenant_user_idx" ON "quote_commercial_contributors"("tenant_id", "user_id", "first_contributed_at");

ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_organization_unit_fkey" FOREIGN KEY ("tenant_id", "organization_unit_id") REFERENCES "organization_unit"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_contact_fkey" FOREIGN KEY ("tenant_id", "contact_id") REFERENCES "contact"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_creator_fkey" FOREIGN KEY ("tenant_id", "created_by_user_id") REFERENCES "tenant_user"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quote_fkey" FOREIGN KEY ("tenant_id", "quote_id") REFERENCES "quotes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_product_fkey" FOREIGN KEY ("tenant_id", "product_id") REFERENCES "products"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "quote_command_receipts" ADD CONSTRAINT "quote_command_receipts_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_command_receipts" ADD CONSTRAINT "quote_command_receipts_quote_fkey" FOREIGN KEY ("tenant_id", "quote_id") REFERENCES "quotes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_command_receipts" ADD CONSTRAINT "quote_command_receipts_actor_fkey" FOREIGN KEY ("tenant_id", "actor_user_id") REFERENCES "tenant_user"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "quote_commercial_contributors" ADD CONSTRAINT "quote_commercial_contributors_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_commercial_contributors" ADD CONSTRAINT "quote_commercial_contributors_quote_fkey" FOREIGN KEY ("tenant_id", "quote_id") REFERENCES "quotes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_commercial_contributors" ADD CONSTRAINT "quote_commercial_contributors_user_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "tenant_user"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
