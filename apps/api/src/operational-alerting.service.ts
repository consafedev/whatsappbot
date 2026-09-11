import { Inject, Injectable } from "@nestjs/common";
import type { AnalyticsDatabase, TenantContext } from "@whatsapp-platform/database";
import {
  SYSTEM_OBSERVABILITY_DATABASE,
  SystemObservabilityService,
} from "./system-observability.service";

export type AnomalyAlertCode =
  | "HIGH_FAILURE_RATE"
  | "OUTBOX_BACKLOG"
  | "HIGH_LATENCY_DB"
  | "HIGH_LATENCY_REDIS"
  | "CHANNEL_DISCONNECTED";

export type AnomalyAlertSeverity = "info" | "warning" | "critical";

export interface OperationalAnomalyAlert {
  readonly id: string;
  readonly code: AnomalyAlertCode;
  readonly severity: AnomalyAlertSeverity;
  readonly title: string;
  readonly message: string;
  readonly metricValue: number | string;
  readonly thresholdValue: number | string;
  readonly triggeredAt: string;
}

export interface AlertsSummary {
  readonly total: number;
  readonly critical: number;
  readonly warning: number;
  readonly info: number;
}

export interface AlertsOverviewResult {
  readonly activeAlerts: readonly OperationalAnomalyAlert[];
  readonly summary: AlertsSummary;
  readonly evaluatedAt: string;
}

export interface AlertEvaluationInput {
  readonly tenantId: string;
  readonly databaseLatencyMs: number;
  readonly databaseOk: boolean;
  readonly redisLatencyMs: number;
  readonly redisOk: boolean;
  readonly pendingOutboxCount: number;
  readonly failedOutboxCount: number;
  readonly averageTransitSeconds: number;
  readonly sentMessagesCount: number;
  readonly disconnectedChannelsCount: number;
  readonly evaluatedAt?: string | undefined;
}

export function evaluateOperationalAlerts(
  input: AlertEvaluationInput,
): readonly OperationalAnomalyAlert[] {
  const timestamp = input.evaluatedAt ?? new Date().toISOString();
  const alerts: OperationalAnomalyAlert[] = [];

  // Rule 1: HIGH_FAILURE_RATE
  // If sentMessagesCount >= 10 and failure rate > 15%
  if (input.sentMessagesCount >= 10) {
    const failureRate = Math.round((input.failedOutboxCount / input.sentMessagesCount) * 1000) / 10;
    if (failureRate > 15) {
      const isCritical = failureRate > 30;
      alerts.push({
        id: `alert-${input.tenantId}-high-failure-rate`,
        code: "HIGH_FAILURE_RATE",
        severity: isCritical ? "critical" : "warning",
        title: isCritical ? "Tasa crítica de fallos en envíos" : "Alta tasa de fallos en envíos",
        message: `Tasa de fallos del ${failureRate}% (${input.failedOutboxCount} fallidos de ${input.sentMessagesCount} enviados). Sugerencia: Verificar mensajes salientes y estado de proveedores.`,
        metricValue: `${failureRate}%`,
        thresholdValue: isCritical ? "> 30%" : "> 15%",
        triggeredAt: timestamp,
      });
    }
  }

  // Rule 2: OUTBOX_BACKLOG
  // If pendingOutboxCount > 50 or averageTransitSeconds > 60s
  if (input.pendingOutboxCount > 50 || input.averageTransitSeconds > 60) {
    alerts.push({
      id: `alert-${input.tenantId}-outbox-backlog`,
      code: "OUTBOX_BACKLOG",
      severity: "warning",
      title: "Saturación en cola de salida (Outbox)",
      message: `Cola de salida acumulada con ${input.pendingOutboxCount} mensajes pendientes y ${input.averageTransitSeconds}s de tránsito promedio. Sugerencia: Verificar worker de WhatsApp y rendimiento de despacho.`,
      metricValue: `${input.pendingOutboxCount} pend, ${input.averageTransitSeconds}s`,
      thresholdValue: "> 50 pend o > 60s",
      triggeredAt: timestamp,
    });
  }

  // Rule 3: HIGH_LATENCY_DB
  // If not databaseOk (critical) or databaseLatencyMs > 300ms (warning)
  if (!input.databaseOk) {
    alerts.push({
      id: `alert-${input.tenantId}-high-latency-db`,
      code: "HIGH_LATENCY_DB",
      severity: "critical",
      title: "Fallo de conexión en base de datos",
      message:
        "No se pudo conectar a la base de datos PostgreSQL. Sugerencia: Revisar estado del servicio de base de datos.",
      metricValue: "Desconectada",
      thresholdValue: "Conexión activa",
      triggeredAt: timestamp,
    });
  } else if (input.databaseLatencyMs > 300) {
    alerts.push({
      id: `alert-${input.tenantId}-high-latency-db`,
      code: "HIGH_LATENCY_DB",
      severity: "warning",
      title: "Alta latencia en base de datos",
      message: `Latencia de consulta a PostgreSQL de ${input.databaseLatencyMs}ms supera el umbral de 300ms. Sugerencia: Revisar carga y consultas activas.`,
      metricValue: `${input.databaseLatencyMs}ms`,
      thresholdValue: "> 300ms",
      triggeredAt: timestamp,
    });
  }

  // Rule 4: HIGH_LATENCY_REDIS
  // If not redisOk (critical) or redisLatencyMs > 300ms (warning)
  if (!input.redisOk) {
    alerts.push({
      id: `alert-${input.tenantId}-high-latency-redis`,
      code: "HIGH_LATENCY_REDIS",
      severity: "critical",
      title: "Fallo de conexión en Redis",
      message:
        "No se pudo conectar al servidor de Redis. Sugerencia: Revisar contenedor o instancia de Redis.",
      metricValue: "Desconectado",
      thresholdValue: "Conexión activa",
      triggeredAt: timestamp,
    });
  } else if (input.redisLatencyMs > 300) {
    alerts.push({
      id: `alert-${input.tenantId}-high-latency-redis`,
      code: "HIGH_LATENCY_REDIS",
      severity: "warning",
      title: "Alta latencia en Redis",
      message: `Latencia de ping a Redis de ${input.redisLatencyMs}ms supera el umbral de 300ms. Sugerencia: Revisar consumo de memoria y red en Redis.`,
      metricValue: `${input.redisLatencyMs}ms`,
      thresholdValue: "> 300ms",
      triggeredAt: timestamp,
    });
  }

  // Rule 5: CHANNEL_DISCONNECTED
  // If disconnectedChannelsCount > 0
  if (input.disconnectedChannelsCount > 0) {
    alerts.push({
      id: `alert-${input.tenantId}-channel-disconnected`,
      code: "CHANNEL_DISCONNECTED",
      severity: "warning",
      title: "Canales de WhatsApp desconectados",
      message: `Se detectaron ${input.disconnectedChannelsCount} canal(es) de WhatsApp en estado desconectado. Sugerencia: Revisar salud de canal y reconectar sesión.`,
      metricValue: input.disconnectedChannelsCount,
      thresholdValue: "> 0",
      triggeredAt: timestamp,
    });
  }

  return alerts;
}

@Injectable()
export class OperationalAlertingService {
  constructor(
    @Inject(SYSTEM_OBSERVABILITY_DATABASE) private readonly database: AnalyticsDatabase,
    @Inject(SystemObservabilityService)
    private readonly observabilityService: SystemObservabilityService,
  ) {}

  async getOperationalAlerts(context: TenantContext): Promise<AlertsOverviewResult> {
    const evaluatedAt = new Date().toISOString();

    const [health, sentMessagesCount, disconnectedChannelsCount] = await Promise.all([
      this.observabilityService.getSystemHealth(context),
      this.database.outboundMessage.count({
        where: {
          tenantId: context.tenantId,
          status: { in: ["SENT", "DELIVERED", "READ"] },
        },
      }),
      "channelAccount" in this.database && typeof this.database.channelAccount?.count === "function"
        ? this.database.channelAccount.count({
            where: {
              tenantId: context.tenantId,
              status: "disconnected",
            },
          })
        : Promise.resolve(0),
    ]);

    const activeAlerts = evaluateOperationalAlerts({
      tenantId: context.tenantId,
      databaseLatencyMs: health.databaseLatencyMs,
      databaseOk: health.databaseLatencyMs >= 0,
      redisLatencyMs: health.redisLatencyMs,
      redisOk: health.redisLatencyMs >= 0,
      pendingOutboxCount: health.outboxMetrics.pendingCount,
      failedOutboxCount: health.outboxMetrics.failedCount,
      averageTransitSeconds: health.outboxMetrics.averageTransitSeconds,
      sentMessagesCount,
      disconnectedChannelsCount,
      evaluatedAt,
    });

    const summary: AlertsSummary = {
      total: activeAlerts.length,
      critical: activeAlerts.filter((a) => a.severity === "critical").length,
      warning: activeAlerts.filter((a) => a.severity === "warning").length,
      info: activeAlerts.filter((a) => a.severity === "info").length,
    };

    return {
      activeAlerts,
      summary,
      evaluatedAt,
    };
  }
}
