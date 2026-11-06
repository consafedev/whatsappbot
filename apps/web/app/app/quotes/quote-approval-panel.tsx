import { useState } from "react";
import styles from "./quotes.module.css";
import type { QuoteApprovalView } from "./quotes-api";
import type { Quote, QuoteCapabilities } from "./quotes-view-model";
import { quoteActions, quoteStatusLabel } from "./quotes-view-model";

const REQUEST_REASON_LABELS: Readonly<Record<string, string>> = {
  manual_policy: "La política vigente requiere revisión manual.",
  automatic_amount_currency_required:
    "La política requiere configurar un límite de importe y una moneda.",
  amount_exceeds_policy_limit: "El total supera el límite configurado en la política.",
  currency_does_not_match_policy: "La moneda no coincide con la moneda configurada en la política.",
  discount_ceiling_not_configured: "La política requiere configurar un límite de descuento.",
  discount_exceeds_policy_limit: "Un descuento supera el límite configurado en la política.",
  stock_requirement_unverifiable:
    "No se puede verificar el requisito de existencias con los datos disponibles.",
  minimum_margin_unverifiable: "No se puede verificar el margen mínimo con los datos disponibles.",
  new_customer_requires_approval: "La política requiere aprobación para clientes nuevos.",
  exceptional_product_requires_approval:
    "La política requiere aprobación para productos excepcionales.",
};

function requestReasonLabel(reason: string): string {
  return REQUEST_REASON_LABELS[reason] ?? "Hay un motivo adicional de revisión asociado.";
}

export function QuoteApprovalPanel({
  quote,
  capabilities,
  evidence,
  busy,
  onRequest,
  onApprove,
  onReject,
  onCancel,
}: Readonly<{
  quote: Quote;
  capabilities: QuoteCapabilities;
  evidence: QuoteApprovalView | null;
  busy: boolean;
  onRequest: () => void;
  onApprove: (note: string) => void;
  onReject: (note: string) => void;
  onCancel: () => void;
}>) {
  const [decisionNote, setDecisionNote] = useState("");
  const actions = quoteActions(quote, capabilities);
  return (
    <section aria-labelledby="quote-approval-heading" className={styles.panel}>
      <h3 id="quote-approval-heading">Aprobación y estado</h3>
      <p>
        Estado actual: <strong>{quoteStatusLabel(quote.status)}</strong> · Revisión {quote.revision}
      </p>
      {!actions.calculationCurrent && (
        <p className={styles.warning}>
          El cálculo no corresponde a esta revisión; guarda el borrador antes de solicitar
          aprobación.
        </p>
      )}
      {actions.expired && (
        <p className={styles.warning}>
          La fecha límite ya pasó. No se puede solicitar aprobación ni aprobar esta cotización.
        </p>
      )}
      {quote.status === "pending_approval" && (
        <p className={styles.note}>Esta cotización espera una decisión de aprobación.</p>
      )}
      {quote.status === "approved" && <p className={styles.note}>La cotización está aprobada.</p>}
      {evidence?.isCurrent &&
        evidence.quoteId === quote.id &&
        evidence.requestReasonCodes.length > 0 && (
          <ul className={styles.reasonList} aria-label="Motivos de revisión">
            {evidence.requestReasonCodes.map((reason) => (
              <li key={reason}>{requestReasonLabel(reason)}</li>
            ))}
          </ul>
        )}
      {capabilities.canApprove && quote.status === "pending_approval" && (
        <label className={styles.decisionNote}>
          Nota (opcional)
          <textarea
            maxLength={1000}
            rows={2}
            value={decisionNote}
            onChange={(event) => setDecisionNote(event.target.value)}
          />
        </label>
      )}
      <div className={styles.actionRow}>
        {actions.canRequestApproval && (
          <button
            className={styles.primaryButton}
            disabled={busy}
            onClick={onRequest}
            type="button"
          >
            Solicitar aprobación
          </button>
        )}
        {actions.canApprove && (
          <button
            className={styles.primaryButton}
            disabled={busy}
            onClick={() => onApprove(decisionNote)}
            type="button"
          >
            Aprobar
          </button>
        )}
        {actions.canReject && (
          <button
            className={styles.secondaryButton}
            disabled={busy}
            onClick={() => onReject(decisionNote)}
            type="button"
          >
            Rechazar
          </button>
        )}
        {actions.canCancel && (
          <button className={styles.dangerButton} disabled={busy} onClick={onCancel} type="button">
            Cancelar cotización
          </button>
        )}
      </div>
    </section>
  );
}
