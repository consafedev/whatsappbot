import * as net from "node:net";
import { Inject, Injectable, Optional } from "@nestjs/common";
import type { AnalyticsDatabase, TenantContext } from "@whatsapp-platform/database";

export const SYSTEM_OBSERVABILITY_DATABASE = Symbol("SYSTEM_OBSERVABILITY_DATABASE");
export const SYSTEM_OBSERVABILITY_REDIS_URL = Symbol("SYSTEM_OBSERVABILITY_REDIS_URL");

export interface OutboxHealthMetrics {
  readonly pendingCount: number;
  readonly failedCount: number;
  readonly averageTransitSeconds: number;
}

export interface WorkerStatusSummary {
  readonly whatsappWorker: "active" | "degraded" | "inactive";
  readonly jobsWorker: "active" | "degraded" | "inactive";
}

export interface SystemHealthData {
  readonly status: "healthy" | "degraded" | "unhealthy";
  readonly timestamp: string;
  readonly databaseLatencyMs: number;
  readonly redisLatencyMs: number;
  readonly outboxMetrics: OutboxHealthMetrics;
  readonly workerStatus: WorkerStatusSummary;
}

export async function pingRedis(
  redisUrlString: string,
  timeoutMs = 2000,
): Promise<{ ok: boolean; latencyMs: number }> {
  const start = performance.now();
  let url: URL;
  try {
    url = new URL(redisUrlString);
  } catch {
    return { ok: false, latencyMs: -1 };
  }

  const host = url.hostname || "127.0.0.1";
  const port = Number(url.port) || 6379;
  let password: string;
  try {
    // URL passwords are percent-encoded; decode before embedding in the inline AUTH command.
    password = decodeURIComponent(url.password);
  } catch {
    return { ok: false, latencyMs: -1 };
  }
  // RESP inline commands are CRLF-delimited: a password containing CR/LF would inject
  // arbitrary Redis commands, so the probe must refuse such credentials.
  if (password.includes("\r") || password.includes("\n")) {
    return { ok: false, latencyMs: -1 };
  }

  return new Promise<{ ok: boolean; latencyMs: number }>((resolve) => {
    let resolved = false;
    const socket = new net.Socket();

    const finish = (ok: boolean) => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      const latencyMs = ok ? Math.max(1, Math.round(performance.now() - start)) : -1;
      resolve({ ok, latencyMs });
    };

    socket.setTimeout(timeoutMs);
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));

    socket.connect(port, host, () => {
      if (password) {
        socket.write(`AUTH ${password}\r\n`);
      } else {
        socket.write("PING\r\n");
      }
    });

    socket.on("data", (data) => {
      const response = data.toString();
      if (response.includes("+OK")) {
        socket.write("PING\r\n");
      } else if (response.includes("+PONG")) {
        finish(true);
      } else if (response.startsWith("-ERR") || response.startsWith("-WRONGPASS")) {
        finish(false);
      }
    });
  });
}

export async function pingPostgres(
  database: AnalyticsDatabase,
  timeoutMs = 2000,
): Promise<{ ok: boolean; latencyMs: number }> {
  const start = performance.now();
  try {
    const pingPromise =
      "tenant" in database && typeof database.tenant.findFirst === "function"
        ? database.tenant.findFirst({ select: { id: true } })
        : Promise.resolve();

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Database ping timeout")), timeoutMs),
    );

    await Promise.race([pingPromise, timeoutPromise]);
    const latencyMs = Math.max(1, Math.round(performance.now() - start));
    return { ok: true, latencyMs };
  } catch {
    return { ok: false, latencyMs: -1 };
  }
}

export async function calculateOutboxMetrics(
  database: AnalyticsDatabase,
  tenantId: string,
): Promise<OutboxHealthMetrics> {
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [pendingCount, failedCount, sentSample] = await Promise.all([
    database.outboundMessage.count({
      where: {
        tenantId,
        status: "PENDING",
      },
    }),
    database.outboundMessage.count({
      where: {
        tenantId,
        status: "FAILED",
      },
    }),
    database.outboundMessage.findMany({
      where: {
        tenantId,
        status: "SENT",
        sentAt: { gte: last24h },
      },
      select: {
        createdAt: true,
        sentAt: true,
      },
      take: 1000,
    }),
  ]);

  let averageTransitSeconds = 0;
  if (sentSample.length > 0) {
    const validIntervals = sentSample
      .filter((m): m is typeof m & { sentAt: Date } => m.sentAt !== null)
      .map((m) => Math.max(0, (m.sentAt.getTime() - m.createdAt.getTime()) / 1000));

    if (validIntervals.length > 0) {
      const sum = validIntervals.reduce((acc, val) => acc + val, 0);
      averageTransitSeconds = Math.round((sum / validIntervals.length) * 10) / 10;
    }
  }

  return {
    pendingCount,
    failedCount,
    averageTransitSeconds,
  };
}

@Injectable()
export class SystemObservabilityService {
  constructor(
    @Inject(SYSTEM_OBSERVABILITY_DATABASE) private readonly database: AnalyticsDatabase,
    @Optional()
    @Inject(SYSTEM_OBSERVABILITY_REDIS_URL)
    private readonly customRedisUrl?: string,
  ) {}

  async getSystemHealth(context: TenantContext): Promise<SystemHealthData> {
    const redisUrl = this.customRedisUrl ?? process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

    const [dbResult, redisResult, outboxMetrics] = await Promise.all([
      pingPostgres(this.database),
      pingRedis(redisUrl),
      calculateOutboxMetrics(this.database, context.tenantId),
    ]);

    let status: "healthy" | "degraded" | "unhealthy" = "healthy";

    if (!dbResult.ok || !redisResult.ok) {
      status = "unhealthy";
    } else if (
      dbResult.latencyMs > 500 ||
      redisResult.latencyMs > 500 ||
      outboxMetrics.failedCount > 20
    ) {
      status = "degraded";
    }

    const workerStatus: WorkerStatusSummary = {
      whatsappWorker:
        status === "unhealthy" ? "inactive" : status === "degraded" ? "degraded" : "active",
      jobsWorker:
        status === "unhealthy" ? "inactive" : status === "degraded" ? "degraded" : "active",
    };

    return {
      status,
      timestamp: new Date().toISOString(),
      databaseLatencyMs: dbResult.latencyMs,
      redisLatencyMs: redisResult.latencyMs,
      outboxMetrics,
      workerStatus,
    };
  }
}
