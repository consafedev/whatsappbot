ALTER TABLE "quotes"
    ADD COLUMN "approval_policy_revision" INTEGER,
    ADD COLUMN "approval_policy_hash" CHAR(64),
    ADD COLUMN "current_approval_id" UUID,
    DROP CONSTRAINT "quotes_status_check",
    ADD CONSTRAINT "quotes_status_check" CHECK (
        "status" IN ('draft', 'pending_approval', 'approved', 'rejected', 'cancelled', 'sent', 'accepted', 'expired')
    ),
    DROP CONSTRAINT "quotes_autonomy_level_check",
    ADD CONSTRAINT "quotes_autonomy_level_check" CHECK ("autonomy_level" BETWEEN 0 AND 3),
    ADD CONSTRAINT "quotes_approval_policy_binding_check" CHECK (
        ("approval_policy_revision" IS NULL AND "approval_policy_hash" IS NULL)
        OR
        ("approval_policy_revision" IS NOT NULL AND "approval_policy_revision" >= 0 AND "approval_policy_hash" IS NOT NULL AND "approval_policy_hash" ~ '^[0-9a-f]{64}$')
    );

CREATE TABLE "quote_approvals" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "source_revision" INTEGER NOT NULL,
    "resulting_revision" INTEGER NOT NULL,
    "policy_revision" INTEGER NOT NULL,
    "policy_hash" CHAR(64) NOT NULL,
    "allow_self_approval_snapshot" BOOLEAN NOT NULL,
    "request_actor_user_id" UUID NOT NULL,
    "decision_actor_user_id" UUID,
    "decision_actor_type" VARCHAR(32),
    "status" VARCHAR(16) NOT NULL,
    "request_reason_codes" JSONB NOT NULL,
    "decision_reason_code" VARCHAR(64),
    "decision_note" VARCHAR(1000),
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(3),

    CONSTRAINT "quote_approvals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "quote_approvals_tenant_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "quote_approvals_quote_fkey" FOREIGN KEY ("tenant_id", "quote_id") REFERENCES "quotes"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "quote_approvals_request_actor_fkey" FOREIGN KEY ("tenant_id", "request_actor_user_id") REFERENCES "tenant_user"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "quote_approvals_decision_actor_fkey" FOREIGN KEY ("tenant_id", "decision_actor_user_id") REFERENCES "tenant_user"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "quote_approvals_source_revision_check" CHECK ("source_revision" > 0),
    CONSTRAINT "quote_approvals_resulting_revision_check" CHECK ("resulting_revision" >= "source_revision"),
    CONSTRAINT "quote_approvals_policy_revision_check" CHECK ("policy_revision" >= 0),
    CONSTRAINT "quote_approvals_policy_hash_check" CHECK ("policy_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "quote_approvals_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected')),
    CONSTRAINT "quote_approvals_request_reasons_check" CHECK (jsonb_typeof("request_reason_codes") = 'array'),
    CONSTRAINT "quote_approvals_decision_actor_check" CHECK (
        ("status" = 'pending' AND "decision_actor_type" IS NULL AND "decision_actor_user_id" IS NULL AND "decision_reason_code" IS NULL AND "decision_note" IS NULL AND "decided_at" IS NULL)
        OR
        ("status" IN ('approved', 'rejected') AND "decision_actor_type" IS NOT NULL AND "decision_actor_type" = 'tenant_user' AND "decision_actor_user_id" IS NOT NULL AND "decision_reason_code" IS NOT NULL AND "decided_at" IS NOT NULL)
        OR
        ("status" = 'approved' AND "decision_actor_type" IS NOT NULL AND "decision_actor_type" = 'system_policy' AND "decision_actor_user_id" IS NULL AND "decision_reason_code" IS NOT NULL AND "decided_at" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "quote_approvals_tenant_id_id_key" ON "quote_approvals"("tenant_id", "id");
CREATE UNIQUE INDEX "quote_approvals_tenant_quote_id_key" ON "quote_approvals"("tenant_id", "quote_id", "id");
CREATE INDEX "quote_approvals_tenant_quote_requested_idx" ON "quote_approvals"("tenant_id", "quote_id", "requested_at", "id");
ALTER TABLE "quotes"
    ADD CONSTRAINT "quotes_current_approval_fkey" FOREIGN KEY ("tenant_id", "id", "current_approval_id") REFERENCES "quote_approvals"("tenant_id", "quote_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
