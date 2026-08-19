-- CreateTable
CREATE TABLE "outbound_message" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "channel_account_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "recipient_phone" TEXT NOT NULL,
    "message_type" TEXT NOT NULL DEFAULT 'text',
    "content" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "max_retries" INTEGER NOT NULL DEFAULT 3,
    "provider_message_id" TEXT,
    "last_error" TEXT,
    "scheduled_at" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbound_message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outbound_message_tenant_channel_idx" ON "outbound_message"("tenant_id", "channel_account_id");

-- CreateIndex
CREATE INDEX "outbound_message_tenant_status_idx" ON "outbound_message"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "outbound_message_status_scheduled_idx" ON "outbound_message"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "outbound_message_tenant_recipient_idx" ON "outbound_message"("tenant_id", "recipient_phone");

-- CreateIndex
CREATE INDEX "outbound_message_tenant_actor_idx" ON "outbound_message"("tenant_id", "actor_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_message_tenant_idempotency_key" ON "outbound_message"("tenant_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "outbound_message" ADD CONSTRAINT "outbound_message_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_message" ADD CONSTRAINT "outbound_message_channel_account_id_fkey" FOREIGN KEY ("channel_account_id") REFERENCES "channel_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_message" ADD CONSTRAINT "outbound_message_tenant_id_actor_user_id_fkey" FOREIGN KEY ("tenant_id", "actor_user_id") REFERENCES "tenant_user"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
