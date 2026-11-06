"use client";

import { useEffect, useState } from "react";
import styles from "./quotes.module.css";
import type { QuotePolicy } from "./quotes-view-model";

export type EditableQuotePolicy = Omit<QuotePolicy, "contentHash">;

export function QuotePolicyPanel({
  policy,
  canManage,
  busy,
  onSave,
}: Readonly<{
  policy: QuotePolicy | null;
  canManage: boolean;
  busy: boolean;
  onSave: (policy: EditableQuotePolicy) => void;
}>) {
  const [value, setValue] = useState<EditableQuotePolicy | null>(null);
  useEffect(() => {
    if (policy) {
      const { contentHash: _contentHash, ...editable } = policy;
      setValue(editable);
    }
  }, [policy]);
  if (!value)
    return (
      <section className={styles.panel}>
        <h3>Política de aprobación</h3>
        <p className={styles.loadingState}>Cargando política…</p>
      </section>
    );

  const update = <K extends keyof EditableQuotePolicy>(key: K, next: EditableQuotePolicy[K]) =>
    setValue((previous) => (previous ? { ...previous, [key]: next } : previous));
  return (
    <section aria-labelledby="quote-policy-heading" className={styles.panel}>
      <header className={styles.panelHeader}>
        <div>
          <h3 id="quote-policy-heading">Política de cotizaciones</h3>
          <p>
            Configuración vigente, revisión {value.revision}. La API decide cada solicitud usando
            estos límites y los datos disponibles.
          </p>
        </div>
      </header>
      <div className={styles.policyGrid}>
        <label>
          Nivel de autonomía
          <select
            disabled={!canManage}
            value={value.autonomyLevel}
            onChange={(event) =>
              update("autonomyLevel", Number(event.target.value) as 0 | 1 | 2 | 3)
            }
          >
            <option value={0}>0 · Manual</option>
            <option value={1}>1 · Asistida</option>
            <option value={2}>2 · Automática con límites</option>
            <option value={3}>3 · Automática con límites</option>
          </select>
        </label>
        <label>
          Tope automático
          <input
            disabled={!canManage || value.autonomyLevel < 2}
            inputMode="decimal"
            value={value.maxAutoSendAmount ?? ""}
            onChange={(event) => update("maxAutoSendAmount", event.target.value || null)}
          />
        </label>
        <label>
          Moneda del tope
          <input
            disabled={!canManage || value.autonomyLevel < 2}
            maxLength={3}
            value={value.maxAutoSendCurrency ?? ""}
            onChange={(event) =>
              update("maxAutoSendCurrency", event.target.value.toUpperCase() || null)
            }
          />
        </label>
        <label>
          Descuento máximo (%)
          <input
            disabled={!canManage}
            inputMode="decimal"
            value={value.maxDiscountPercent ?? ""}
            onChange={(event) => update("maxDiscountPercent", event.target.value || null)}
          />
        </label>
        <label>
          Margen mínimo (%)
          <input
            disabled={!canManage}
            inputMode="decimal"
            value={value.minMarginPercent ?? ""}
            onChange={(event) => update("minMarginPercent", event.target.value || null)}
          />
        </label>
      </div>
      <div className={styles.checkGrid}>
        <label>
          <input
            checked={value.requireStock}
            disabled={!canManage}
            onChange={(event) => update("requireStock", event.target.checked)}
            type="checkbox"
          />{" "}
          Exigir verificación de existencias
        </label>
        <label>
          <input
            checked={value.newCustomerRequiresApproval}
            disabled={!canManage}
            onChange={(event) => update("newCustomerRequiresApproval", event.target.checked)}
            type="checkbox"
          />{" "}
          Requerir aprobación para clientes nuevos
        </label>
        <label>
          <input
            checked={value.exceptionalProductRequiresApproval}
            disabled={!canManage}
            onChange={(event) => update("exceptionalProductRequiresApproval", event.target.checked)}
            type="checkbox"
          />{" "}
          Requerir aprobación para productos excepcionales
        </label>
        <label>
          <input
            checked={value.allowSelfApproval}
            disabled={!canManage}
            onChange={(event) => update("allowSelfApproval", event.target.checked)}
            type="checkbox"
          />{" "}
          Permitir autoaprobación
        </label>
      </div>
      {(value.requireStock || value.minMarginPercent !== null) && (
        <p className={styles.warning}>
          Este módulo no tiene datos autoritativos de inventario ni costo. La API mantendrá esos
          requisitos en revisión humana.
        </p>
      )}
      {canManage && (
        <div className={styles.actionRow}>
          <button
            className={styles.primaryButton}
            disabled={busy}
            onClick={() => onSave(value)}
            type="button"
          >
            {busy ? "Guardando…" : "Guardar política"}
          </button>
        </div>
      )}
    </section>
  );
}
