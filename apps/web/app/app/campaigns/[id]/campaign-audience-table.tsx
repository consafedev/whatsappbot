"use client";

import {
  type CampaignAudienceMemberItem,
  formatAudienceMemberStatus,
} from "../campaigns-view-model";

type CampaignAudienceTableProps = Readonly<{
  audience: readonly CampaignAudienceMemberItem[];
  total: number;
  loading: boolean;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  offset: number;
  limit: number;
  onPageChange: (newOffset: number) => void;
}>;

const FILTER_OPTIONS = [
  { value: "ALL", label: "Todos" },
  { value: "PENDING", label: "En cola" },
  { value: "SENT", label: "Enviados" },
  { value: "DELIVERED", label: "Entregados" },
  { value: "READ", label: "Leídos" },
  { value: "FAILED", label: "Fallidos" },
] as const;

const SKELETON_ROWS = [
  "skel-row-1",
  "skel-row-2",
  "skel-row-3",
  "skel-row-4",
  "skel-row-5",
] as const;

function formatDateTime(iso?: string | null): string {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    return d.toLocaleString("es-MX", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function CampaignAudienceTable({
  audience,
  total,
  loading,
  statusFilter,
  onStatusFilterChange,
  offset,
  limit,
  onPageChange,
}: CampaignAudienceTableProps) {
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const fromIndex = total === 0 ? 0 : offset + 1;
  const toIndex = Math.min(offset + limit, total);

  return (
    <div
      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden"
      data-testid="campaign-audience-table"
    >
      {/* Table Header & Filters */}
      <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <span>Desglose de Audiencia</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-semibold">
              {total.toLocaleString()} destinatarios
            </span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Registro individualizado de envíos y acuses de recibo en tiempo real
          </p>
        </div>

        {/* Status Filter Chips */}
        <div className="flex flex-wrap items-center gap-1.5" data-testid="audience-status-filters">
          {FILTER_OPTIONS.map((opt) => {
            const isActive = statusFilter === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onStatusFilterChange(opt.value)}
                className={
                  "px-3 py-1 rounded-lg text-xs font-medium transition-colors " +
                  (isActive
                    ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 shadow-xs"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700")
                }
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Table Content */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 dark:bg-slate-950/50 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th scope="col" className="px-5 py-3">
                Destinatario
              </th>
              <th scope="col" className="px-5 py-3">
                Teléfono
              </th>
              <th scope="col" className="px-5 py-3">
                Estado
              </th>
              <th scope="col" className="px-5 py-3">
                Línea de Tiempo
              </th>
              <th scope="col" className="px-5 py-3">
                Detalles / Error
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {loading ? (
              SKELETON_ROWS.map((key) => (
                <tr key={key} className="animate-pulse">
                  <td className="px-5 py-4">
                    <div className="h-4 w-32 bg-slate-200 dark:bg-slate-800 rounded mb-1.5" />
                    <div className="h-3 w-20 bg-slate-100 dark:bg-slate-800/60 rounded" />
                  </td>
                  <td className="px-5 py-4">
                    <div className="h-4 w-24 bg-slate-200 dark:bg-slate-800 rounded" />
                  </td>
                  <td className="px-5 py-4">
                    <div className="h-6 w-20 bg-slate-200 dark:bg-slate-800 rounded-full" />
                  </td>
                  <td className="px-5 py-4">
                    <div className="h-4 w-28 bg-slate-200 dark:bg-slate-800 rounded" />
                  </td>
                  <td className="px-5 py-4">
                    <div className="h-4 w-20 bg-slate-100 dark:bg-slate-800/60 rounded" />
                  </td>
                </tr>
              ))
            ) : audience.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center">
                  <div className="flex flex-col items-center justify-center">
                    <span className="text-3xl mb-2">📭</span>
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                      No se encontraron destinatarios
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
                      {statusFilter === "ALL"
                        ? "La campaña aún no tiene miembros en su audiencia o no ha sido poblada."
                        : "No hay destinatarios con el estado seleccionado."}
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              audience.map((member) => {
                const statusBadge = formatAudienceMemberStatus(member.status);
                return (
                  <tr
                    key={member.id}
                    className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors"
                  >
                    {/* Recipient */}
                    <td className="px-5 py-3.5">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {member.contactName || "Contacto sin nombre"}
                      </div>
                      {member.email && (
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {member.email}
                        </div>
                      )}
                    </td>

                    {/* Phone Number */}
                    <td className="px-5 py-3.5 font-mono text-xs text-slate-700 dark:text-slate-300">
                      {member.phoneNumber}
                    </td>

                    {/* Status Badge */}
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusBadge.className}`}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: statusBadge.dotColor }}
                        />
                        {statusBadge.label}
                      </span>
                    </td>

                    {/* Timeline */}
                    <td className="px-5 py-3.5 text-xs text-slate-600 dark:text-slate-300">
                      <div className="space-y-0.5">
                        {member.sentAt && (
                          <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                            <span className="text-[10px] uppercase font-semibold text-slate-400">
                              Env:
                            </span>
                            <span>{formatDateTime(member.sentAt)}</span>
                          </div>
                        )}
                        {member.deliveredAt && (
                          <div className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400">
                            <span className="text-[10px] uppercase font-semibold text-indigo-400">
                              Ent:
                            </span>
                            <span>{formatDateTime(member.deliveredAt)}</span>
                          </div>
                        )}
                        {member.readAt && (
                          <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                            <span className="text-[10px] uppercase font-semibold text-emerald-400">
                              Ldo:
                            </span>
                            <span>{formatDateTime(member.readAt)}</span>
                          </div>
                        )}
                        {!member.sentAt && !member.deliveredAt && !member.readAt && (
                          <span className="text-slate-400 dark:text-slate-500">
                            Pendiente de envío
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Error / Observations */}
                    <td className="px-5 py-3.5">
                      {member.errorMessage ? (
                        <div
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-xs max-w-xs truncate"
                          title={member.errorMessage}
                        >
                          <span>✕</span>
                          <span className="truncate">{member.errorMessage}</span>
                        </div>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500 text-xs">-</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="text-slate-500 dark:text-slate-400">
          Mostrando{" "}
          <span className="font-semibold text-slate-700 dark:text-slate-300">{fromIndex}</span> a{" "}
          <span className="font-semibold text-slate-700 dark:text-slate-300">{toIndex}</span> de{" "}
          <span className="font-semibold text-slate-700 dark:text-slate-300">
            {total.toLocaleString()}
          </span>{" "}
          destinatarios
        </div>

        <div className="flex items-center gap-2">
          <span className="text-slate-500 dark:text-slate-400 mr-1">
            Página {currentPage} de {totalPages}
          </span>
          <button
            type="button"
            disabled={offset === 0 || loading}
            onClick={() => onPageChange(Math.max(0, offset - limit))}
            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800 font-medium transition-colors"
          >
            Anterior
          </button>
          <button
            type="button"
            disabled={offset + limit >= total || audience.length < limit || loading}
            onClick={() => onPageChange(offset + limit)}
            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800 font-medium transition-colors"
          >
            Siguiente
          </button>
        </div>
      </div>
    </div>
  );
}
