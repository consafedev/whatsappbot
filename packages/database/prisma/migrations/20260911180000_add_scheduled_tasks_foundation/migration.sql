-- CreateEnum
CREATE TYPE "scheduled_task_status" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "scheduled_tasks" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "task_type" TEXT NOT NULL,
    "status" "scheduled_task_status" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "cron_expression" TEXT,
    "scheduled_for" TIMESTAMPTZ(3) NOT NULL,
    "last_run_at" TIMESTAMPTZ(3),
    "next_run_at" TIMESTAMPTZ(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "max_retries" INTEGER NOT NULL DEFAULT 3,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_tasks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "scheduled_task_tenant_id_key" UNIQUE ("tenant_id", "id"),
    CONSTRAINT "scheduled_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "scheduled_task_tenant_status_scheduled_idx" ON "scheduled_tasks"("tenant_id", "status", "scheduled_for");
