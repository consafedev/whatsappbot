-- CreateTable
CREATE TABLE "domain_event_outbox" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "domain_event_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "domain_event_outbox_tenant_id_idx" ON "domain_event_outbox"("tenant_id");

-- CreateIndex
CREATE INDEX "domain_event_outbox_pending_idx" ON "domain_event_outbox"("published_at", "occurred_at");

-- CreateIndex
CREATE INDEX "domain_event_outbox_aggregate_idx" ON "domain_event_outbox"("aggregate_type", "aggregate_id");

-- AddForeignKey
ALTER TABLE "domain_event_outbox" ADD CONSTRAINT "domain_event_outbox_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
