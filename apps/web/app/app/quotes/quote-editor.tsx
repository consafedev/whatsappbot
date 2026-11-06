"use client";

import { type FormEvent, useMemo, useState } from "react";
import type { CatalogProduct } from "../catalog/catalog-view-model";
import type { QuoteEditorLine } from "./quote-editor-model";
import {
  editorLinesFromQuote,
  formatValidUntilForInput,
  resolveValidUntilInput,
} from "./quote-editor-model";
import styles from "./quotes.module.css";
import type { Quote } from "./quotes-view-model";
import { formatQuoteMoney } from "./quotes-view-model";

type EditableLine = QuoteEditorLine & { uiKey: string; originalPosition?: number };
type ContactOption = Readonly<{ id: string; name: string; phoneNumber: string }>;
type UnitOption = Readonly<{ id: string; name: string; code?: string | null }>;

function initialLine(currency: string): EditableLine {
  return {
    uiKey: crypto.randomUUID(),
    source: "manual",
    description: "",
    unit: "unidad",
    quantity: "1.000",
    unitPrice: "",
    currency,
    taxCode: null,
    taxRate: null,
    discount: { kind: "fixed", value: "0.0000" },
  };
}

export function QuoteEditor({
  quote,
  contacts,
  units,
  products,
  canUseCatalog,
  contactsLoading,
  unitsLoading,
  productsLoading,
  productsHasMore,
  contactsHasMore,
  unitsHasMore,
  busy,
  onSearchContacts,
  onMoreContacts,
  onSearchUnits,
  onMoreUnits,
  onSearchProducts,
  onMoreProducts,
  onConvertToManual,
  onSave,
  onCancel,
}: Readonly<{
  quote: Quote | null;
  contacts: readonly ContactOption[];
  units: readonly UnitOption[];
  products: readonly CatalogProduct[];
  canUseCatalog: boolean;
  contactsLoading: boolean;
  unitsLoading: boolean;
  productsLoading: boolean;
  productsHasMore: boolean;
  contactsHasMore: boolean;
  unitsHasMore: boolean;
  busy: boolean;
  onSearchContacts: (search: string) => void;
  onMoreContacts: () => void;
  onSearchUnits: (search: string) => void;
  onMoreUnits: () => void;
  onSearchProducts: (search: string) => void;
  onMoreProducts: () => void;
  onConvertToManual: (position: number, snapshot: Readonly<Record<string, unknown>>) => void;
  onSave: (input: {
    organizationUnitId: string;
    contactId: string;
    currency: string;
    validUntil: string | null;
    terms: string | null;
    notes: string | null;
    shippingTotal: string;
    lines: readonly QuoteEditorLine[];
  }) => void | Promise<void>;
  onCancel: () => void;
}>) {
  const sourceLines = useMemo(() => (quote ? editorLinesFromQuote(quote) : []), [quote]);
  const [contactId, setContactId] = useState(quote?.contactId ?? "");
  const [unitId, setUnitId] = useState(quote?.organizationUnitId ?? "");
  const [currency, setCurrency] = useState(quote?.currency ?? "");
  const [validUntil, setValidUntil] = useState(formatValidUntilForInput(quote?.validUntil ?? null));
  const [validUntilEdited, setValidUntilEdited] = useState(false);
  const [terms, setTerms] = useState(quote?.terms ?? "");
  const [notes, setNotes] = useState(quote?.notes ?? "");
  const [shippingTotal, setShippingTotal] = useState(quote?.shippingTotal ?? "0.0000");
  const [lines, setLines] = useState<EditableLine[]>(() =>
    quote
      ? sourceLines.map((sourceLine, index) => {
          const originalPosition = quote.lines[index]?.position;
          return {
            ...sourceLine,
            uiKey: crypto.randomUUID(),
            ...(originalPosition === undefined ? {} : { originalPosition }),
          };
        })
      : [initialLine("")],
  );
  const [error, setError] = useState<string | null>(null);
  const [hasUnsavedEdits, setHasUnsavedEdits] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [unitSearch, setUnitSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const visibleContacts = contacts;
  const visibleUnits = units;

  const patchLine = (key: string, patch: Partial<EditableLine>) => {
    setHasUnsavedEdits(true);
    setLines((current) =>
      current.map((line) => (line.uiKey === key ? ({ ...line, ...patch } as EditableLine) : line)),
    );
  };
  const updateCurrency = (value: string) => {
    setCurrency(value);
    setLines((current) =>
      current.map((line) =>
        line.source === "manual" ? ({ ...line, currency: value } as EditableLine) : line,
      ),
    );
  };
  const addManual = () => {
    setHasUnsavedEdits(true);
    setLines((current) => [...current, initialLine(currency)]);
  };
  const addCatalog = () => {
    setHasUnsavedEdits(true);
    setLines((current) => [
      ...current,
      {
        uiKey: crypto.randomUUID(),
        source: "catalog",
        productId: "",
        quantity: "1.000",
        discount: { kind: "fixed", value: "0.0000" },
      },
    ]);
  };
  const toManual = (line: EditableLine) => {
    if (line.source !== "catalog") return;
    if (quote && line.originalPosition !== undefined) {
      const savedLine = quote.lines.find((item) => item.position === line.originalPosition);
      if (!savedLine || hasUnsavedEdits) return;
      onConvertToManual(savedLine.position, {
        sku: savedLine.sku,
        description: savedLine.description,
        unit: savedLine.unit,
        unitPrice: savedLine.unitPrice,
        currency: savedLine.currency,
        taxCode: savedLine.taxCode,
        taxRate: savedLine.taxRate,
        metadata: savedLine.metadata,
      });
      return;
    }
    const product = products.find((item) => item.id === line.productId);
    if (!product) return;
    patchLine(line.uiKey, {
      source: "manual",
      sku: product.sku,
      description: product.name,
      unit: product.unit,
      quantity: line.quantity,
      unitPrice: product.price,
      currency: product.currency,
      taxCode: product.taxCode,
      taxRate: product.taxRate,
      ...(line.discount ? { discount: line.discount } : {}),
    });
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!contactId || !unitId) {
      setError("Selecciona un contacto y una unidad organizativa.");
      return;
    }
    if (!/^[A-Za-z]{3}$/.test(currency)) {
      setError("Escribe un código de moneda de tres letras.");
      return;
    }
    try {
      await onSave({
        organizationUnitId: unitId,
        contactId,
        currency: currency.toUpperCase(),
        validUntil: resolveValidUntilInput(validUntil, quote?.validUntil ?? null, validUntilEdited),
        terms: terms || null,
        notes: notes || null,
        shippingTotal,
        lines: lines.map(({ uiKey: _uiKey, ...line }) => line),
      });
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "No se pudo preparar la cotización.",
      );
    }
  }

  return (
    <form className={styles.editor} onSubmit={submit}>
      <header className={styles.editorHeader}>
        <div>
          <p className={styles.eyebrow}>{quote ? "Editar borrador" : "Nueva cotización"}</p>
          <h2>{quote?.number ?? "Cotización"}</h2>
          <p>Los importes totales los calcula el servidor.</p>
        </div>
        <button
          aria-label="Cerrar editor"
          className={styles.iconButton}
          onClick={onCancel}
          type="button"
        >
          ×
        </button>
      </header>
      {error && (
        <p className={styles.errorBanner} role="alert">
          {error}
        </p>
      )}
      <div className={styles.formGrid}>
        <label>
          Buscar contacto
          <input
            autoComplete="off"
            maxLength={100}
            value={contactSearch}
            onChange={(event) => {
              setContactSearch(event.target.value);
              onSearchContacts(event.target.value);
            }}
            placeholder="Nombre o teléfono"
          />
        </label>
        <label>
          Contacto
          <select
            required
            value={contactId}
            onChange={(event) => {
              setHasUnsavedEdits(true);
              setContactId(event.target.value);
            }}
          >
            <option value="">Selecciona un contacto</option>
            {visibleContacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name} · {contact.phoneNumber}
              </option>
            ))}
          </select>
          {contactsLoading && <small aria-live="polite">Buscando contactos…</small>}
          {!contactsLoading && visibleContacts.length === 0 && (
            <small>No hay contactos que coincidan.</small>
          )}
          {contactsHasMore && (
            <button
              className={styles.textButton}
              disabled={contactsLoading}
              onClick={onMoreContacts}
              type="button"
            >
              Cargar más contactos
            </button>
          )}
        </label>
        <label>
          Buscar unidad
          <input
            autoComplete="off"
            maxLength={100}
            value={unitSearch}
            onChange={(event) => {
              setUnitSearch(event.target.value);
              onSearchUnits(event.target.value);
            }}
            placeholder="Nombre o código"
          />
        </label>
        <label>
          Unidad organizativa
          <select
            required
            value={unitId}
            onChange={(event) => {
              setHasUnsavedEdits(true);
              setUnitId(event.target.value);
            }}
          >
            <option value="">Selecciona una unidad</option>
            {visibleUnits.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
                {unit.code ? ` · ${unit.code}` : ""}
              </option>
            ))}
          </select>
          {unitsLoading && <small aria-live="polite">Buscando unidades…</small>}
          {!unitsLoading && visibleUnits.length === 0 && (
            <small>No hay unidades que coincidan.</small>
          )}
          {unitsHasMore && (
            <button
              className={styles.textButton}
              disabled={unitsLoading}
              onClick={onMoreUnits}
              type="button"
            >
              Cargar más unidades
            </button>
          )}
        </label>
        <label>
          Moneda
          <input
            autoCapitalize="characters"
            maxLength={3}
            minLength={3}
            pattern="[A-Za-z]{3}"
            required
            value={currency}
            onChange={(event) => {
              setHasUnsavedEdits(true);
              updateCurrency(event.target.value.toUpperCase());
            }}
          />
        </label>
        <label>
          Válida hasta
          <input
            type="datetime-local"
            value={validUntil}
            onChange={(event) => {
              setHasUnsavedEdits(true);
              setValidUntilEdited(true);
              setValidUntil(event.target.value);
            }}
          />
        </label>
        <label>
          Envío sin impuesto
          <input
            inputMode="decimal"
            pattern="\d{1,9}(\.\d{1,4})?"
            required
            value={shippingTotal}
            onChange={(event) => {
              setHasUnsavedEdits(true);
              setShippingTotal(event.target.value);
            }}
          />
        </label>
        <label className={styles.spanTwo}>
          Términos
          <textarea
            maxLength={8000}
            rows={2}
            value={terms}
            onChange={(event) => {
              setHasUnsavedEdits(true);
              setTerms(event.target.value);
            }}
          />
        </label>
        <label className={styles.spanTwo}>
          Notas internas
          <textarea
            maxLength={4000}
            rows={2}
            value={notes}
            onChange={(event) => {
              setHasUnsavedEdits(true);
              setNotes(event.target.value);
            }}
          />
        </label>
      </div>
      <section className={styles.lineSection} aria-labelledby="quote-lines-heading">
        <header>
          <h3 id="quote-lines-heading">Conceptos</h3>
          <div className={styles.actionRow}>
            <button className={styles.secondaryButton} onClick={addManual} type="button">
              ＋ Concepto manual
            </button>
            {canUseCatalog && (
              <button className={styles.secondaryButton} onClick={addCatalog} type="button">
                ＋ Producto
              </button>
            )}
          </div>
        </header>
        {quote && (
          <p className={styles.note}>
            Convertir un producto es un comando independiente que conserva la cantidad y el
            descuento guardados; guarda o cierra tus cambios pendientes antes de convertir.
          </p>
        )}
        {lines.map((line, index) => {
          const savedQuoteLine = quote?.lines.find(
            (saved) => saved.position === line.originalPosition,
          );
          const retainedCatalogSnapshot =
            line.source === "catalog" && savedQuoteLine?.source === "catalog";
          const snapshotProtected = retainedCatalogSnapshot && !line.explicitRefresh;
          return (
            <article className={styles.lineCard} key={line.uiKey}>
              <header>
                <strong>
                  Concepto {index + 1} · {line.source === "catalog" ? "Catálogo" : "Manual"}
                </strong>
                <div>
                  {line.source === "catalog" && (
                    <button
                      className={styles.textButton}
                      disabled={Boolean(quote && hasUnsavedEdits) || busy}
                      onClick={() => toManual(line)}
                      type="button"
                    >
                      Convertir a manual
                    </button>
                  )}
                  {lines.length > 1 && (
                    <button
                      aria-label={`Eliminar concepto ${index + 1}`}
                      className={styles.textButton}
                      onClick={() => {
                        setHasUnsavedEdits(true);
                        setLines((current) => current.filter((item) => item.uiKey !== line.uiKey));
                      }}
                      type="button"
                    >
                      Quitar
                    </button>
                  )}
                </div>
              </header>
              {line.source === "catalog" ? (
                <div className={styles.formGrid}>
                  <label>
                    Buscar producto
                    <input
                      autoComplete="off"
                      maxLength={100}
                      value={productSearch}
                      onChange={(event) => {
                        setProductSearch(event.target.value);
                        onSearchProducts(event.target.value);
                      }}
                      placeholder="SKU o nombre"
                    />
                  </label>
                  <label>
                    Producto
                    <select
                      required
                      value={line.productId}
                      onChange={(event) =>
                        patchLine(line.uiKey, {
                          productId: event.target.value,
                          ...(retainedCatalogSnapshot ? { explicitRefresh: true } : {}),
                        })
                      }
                    >
                      <option value="">Selecciona un producto</option>
                      {quote?.lines.find((saved) => saved.position === line.originalPosition)
                        ?.source === "catalog" &&
                        !products.some((product) => product.id === line.productId) && (
                          <option value={line.productId}>
                            {quote.lines.find((saved) => saved.position === line.originalPosition)
                              ?.sku ?? "Producto"}{" "}
                            · snapshot guardado
                          </option>
                        )}
                      {products
                        .filter(
                          (product) =>
                            product.active &&
                            product.currency === currency.toUpperCase() &&
                            (!product.organizationUnitId || product.organizationUnitId === unitId),
                        )
                        .map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.sku} · {product.name} · {product.price} {product.currency}
                            {product.taxRate === null ? " · impuesto sin configurar" : ""}
                          </option>
                        ))}
                    </select>
                    {productsLoading && <small aria-live="polite">Buscando productos…</small>}
                    {!productsLoading && canUseCatalog && products.length === 0 && (
                      <small>No hay productos activos que coincidan con los filtros.</small>
                    )}
                    {productsHasMore && (
                      <button
                        className={styles.textButton}
                        disabled={productsLoading}
                        onClick={onMoreProducts}
                        type="button"
                      >
                        Cargar más productos
                      </button>
                    )}
                    {snapshotProtected &&
                      products.some(
                        (product) => product.id === line.productId && product.active,
                      ) && (
                        <button
                          className={styles.textButton}
                          disabled={busy}
                          onClick={() => patchLine(line.uiKey, { explicitRefresh: true })}
                          type="button"
                        >
                          Actualizar precios y datos del catálogo
                        </button>
                      )}
                  </label>
                  <label>
                    Cantidad
                    <input
                      aria-describedby={
                        snapshotProtected ? `snapshot-protection-${index}` : undefined
                      }
                      disabled={snapshotProtected}
                      inputMode="decimal"
                      pattern="\d{1,6}(\.\d{1,3})?"
                      required
                      value={line.quantity}
                      onChange={(event) => patchLine(line.uiKey, { quantity: event.target.value })}
                    />
                    {snapshotProtected && (
                      <small id={`snapshot-protection-${index}`}>
                        Convierte primero a manual para conservar los datos guardados, o actualiza
                        explícitamente precios y datos del catálogo.
                      </small>
                    )}
                  </label>
                </div>
              ) : (
                <div className={styles.formGrid}>
                  <label>
                    SKU
                    <input
                      maxLength={64}
                      value={line.sku ?? ""}
                      onChange={(event) =>
                        patchLine(line.uiKey, { sku: event.target.value || null })
                      }
                    />
                  </label>
                  <label>
                    Descripción
                    <input
                      maxLength={2000}
                      required
                      value={line.description}
                      onChange={(event) =>
                        patchLine(line.uiKey, { description: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Unidad
                    <input
                      maxLength={32}
                      required
                      value={line.unit}
                      onChange={(event) => patchLine(line.uiKey, { unit: event.target.value })}
                    />
                  </label>
                  <label>
                    Cantidad
                    <input
                      inputMode="decimal"
                      pattern="\d{1,6}(\.\d{1,3})?"
                      required
                      value={line.quantity}
                      onChange={(event) => patchLine(line.uiKey, { quantity: event.target.value })}
                    />
                  </label>
                  <label>
                    Precio unitario
                    <input
                      inputMode="decimal"
                      pattern="\d{1,9}(\.\d{1,4})?"
                      required
                      value={line.unitPrice}
                      onChange={(event) => patchLine(line.uiKey, { unitPrice: event.target.value })}
                    />
                  </label>
                  <label>
                    Código fiscal
                    <input
                      maxLength={64}
                      value={line.taxCode ?? ""}
                      onChange={(event) =>
                        patchLine(line.uiKey, { taxCode: event.target.value || null })
                      }
                    />
                  </label>
                  <label>
                    Tasa de impuesto (%)
                    <input
                      inputMode="decimal"
                      pattern="\d{1,3}(\.\d{1,4})?"
                      value={line.taxRate ?? ""}
                      onChange={(event) =>
                        patchLine(line.uiKey, { taxRate: event.target.value || null })
                      }
                    />
                    <small>Vacío bloquea cálculo; 0 es explícito.</small>
                  </label>
                </div>
              )}
              <div className={styles.formGrid}>
                <label>
                  Tipo de descuento
                  <select
                    disabled={snapshotProtected}
                    value={line.discount?.kind ?? "fixed"}
                    onChange={(event) =>
                      patchLine(line.uiKey, {
                        discount: {
                          kind: event.target.value as "fixed" | "percent",
                          value: line.discount?.value ?? "0.0000",
                        },
                      })
                    }
                  >
                    <option value="fixed">Importe fijo por línea</option>
                    <option value="percent">Porcentaje</option>
                  </select>
                </label>
                <label>
                  Descuento
                  <input
                    disabled={snapshotProtected}
                    inputMode="decimal"
                    pattern="\d{1,15}(\.\d{1,4})?"
                    value={line.discount?.value ?? "0.0000"}
                    onChange={(event) =>
                      patchLine(line.uiKey, {
                        discount: {
                          kind: line.discount?.kind ?? "fixed",
                          value: event.target.value,
                        },
                      })
                    }
                  />
                </label>
              </div>
            </article>
          );
        })}
      </section>
      {quote && (
        <p className={styles.note}>
          Cliente: {quote.customerNameSnapshot} · {quote.customerPhoneSnapshot}. Unidad:{" "}
          {quote.organizationUnitNameSnapshot}. Los datos históricos permanecen como snapshot en el
          servidor.
        </p>
      )}
      {quote ? (
        <section aria-label="Último cálculo guardado" className={styles.calculationSummary}>
          <h3>Último cálculo guardado · revisión {quote.calculatedRevision ?? "sin calcular"}</h3>
          <dl>
            <div>
              <dt>Subtotal</dt>
              <dd>
                {quote.subtotal === null
                  ? "Pendiente"
                  : formatQuoteMoney(quote.subtotal, quote.currency, quote.currencyPrecision)}
              </dd>
            </div>
            <div>
              <dt>Descuento</dt>
              <dd>
                {quote.discountTotal === null
                  ? "Pendiente"
                  : formatQuoteMoney(quote.discountTotal, quote.currency, quote.currencyPrecision)}
              </dd>
            </div>
            <div>
              <dt>Impuesto</dt>
              <dd>
                {quote.taxTotal === null
                  ? "Pendiente"
                  : formatQuoteMoney(quote.taxTotal, quote.currency, quote.currencyPrecision)}
              </dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd>
                {quote.total === null
                  ? "Pendiente"
                  : formatQuoteMoney(quote.total, quote.currency, quote.currencyPrecision)}
              </dd>
            </div>
          </dl>
          <p>
            Este resumen pertenece a la versión guardada. Al guardar cambios, el servidor calcula de
            nuevo los importes.
          </p>
        </section>
      ) : (
        <p className={styles.note}>
          El servidor calculará subtotal, descuento, impuestos y total después de guardar. Los
          impuestos vacíos bloquean el cálculo; no se aplican tasas implícitas.
        </p>
      )}
      <footer className={styles.formActions}>
        <button className={styles.secondaryButton} onClick={onCancel} type="button">
          Cerrar
        </button>
        <button className={styles.primaryButton} disabled={busy} type="submit">
          {busy ? "Guardando…" : "Guardar borrador"}
        </button>
      </footer>
    </form>
  );
}
