-- CreateEnum
CREATE TYPE "scheduled_task_run_status" AS ENUM ('SUCCESS', 'FAILED', 'TIMEOUT');

-- CreateTable
CREATE TABLE "scheduled_task_runs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "status" "scheduled_task_run_status" NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "retry_attempt" INTEGER NOT NULL,
    "error_message" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_task_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "scheduled_task_run_attempt_key" UNIQUE ("tenant_id", "task_id", "started_at"),
    CONSTRAINT "scheduled_task_runs_duration_ms_check" CHECK ("duration_ms" >= 0),
    CONSTRAINT "scheduled_task_runs_retry_attempt_check" CHECK ("retry_attempt" >= 0),
    CONSTRAINT "scheduled_task_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "scheduled_task_runs_tenant_task_fkey" FOREIGN KEY ("tenant_id", "task_id") REFERENCES "scheduled_tasks"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "scheduled_task_run_tenant_task_started_idx" ON "scheduled_task_runs"("tenant_id", "task_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "scheduled_task_run_tenant_started_idx" ON "scheduled_task_runs"("tenant_id", "started_at" DESC);
