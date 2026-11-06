import styles from "./quotes.module.css";
import type { Quote } from "./quotes-view-model";
import { formatQuoteMoney, quoteStatusLabel } from "./quotes-view-model";

export function QuoteList({
  items,
  onOpen,
}: Readonly<{ items: readonly Quote[]; onOpen: (quote: Quote) => void }>) {
  if (!items.length) {
    return (
      <section className={styles.emptyState}>
        <span aria-hidden="true">▤</span>
        <h2>No hay cotizaciones</h2>
        <p>Las cotizaciones de este espacio aparecerán aquí cuando se creen.</p>
      </section>
    );
  }
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Cotización</th>
            <th scope="col">Cliente</th>
            <th scope="col">Unidad</th>
            <th scope="col">Total</th>
            <th scope="col">Estado</th>
            <th scope="col">Vigencia</th>
            <th scope="col">
              <span className={styles.srOnly}>Acciones</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((quote) => (
            <tr key={quote.id}>
              <td data-label="Cotización">
                <strong>{quote.number}</strong>
                <small>Revisión {quote.revision}</small>
              </td>
              <td data-label="Cliente">
                <strong>{quote.customerNameSnapshot}</strong>
                <small>{quote.customerPhoneSnapshot}</small>
              </td>
              <td data-label="Unidad">{quote.organizationUnitNameSnapshot}</td>
              <td data-label="Total">
                {quote.total === null
                  ? "Sin cálculo"
                  : formatQuoteMoney(quote.total, quote.currency, quote.currencyPrecision)}
              </td>
              <td data-label="Estado">
                <span className={styles.status}>{quoteStatusLabel(quote.status)}</span>
              </td>
              <td data-label="Vigencia">
                {quote.validUntil
                  ? new Date(quote.validUntil).toLocaleDateString("es-MX")
                  : "Sin fecha límite"}
              </td>
              <td data-label="Acciones">
                <button
                  className={styles.secondaryButton}
                  onClick={() => onOpen(quote)}
                  type="button"
                >
                  Abrir
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
