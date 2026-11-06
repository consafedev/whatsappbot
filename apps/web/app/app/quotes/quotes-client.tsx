"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  beginCommandIntent,
  type CommandKeyEntry,
  stableCommandKey,
} from "../appointments/appointment-command-key";
import { createCatalogApi } from "../catalog/catalog-api";
import type { CatalogProduct } from "../catalog/catalog-view-model";
import { useTenantAppBootstrap } from "../tenant-app-shell";
import { QuoteApprovalPanel } from "./quote-approval-panel";
import { QuoteEditor } from "./quote-editor";
import {
  buildQuoteDraftInput,
  buildQuoteDraftPatch,
  buildQuoteManualConversion,
  catalogSnapshotPositionsNeedingConversion,
  type QuoteEditorLine,
  quoteEditorLinesEqual,
} from "./quote-editor-model";
import { QuoteList } from "./quote-list";
import { type EditableQuotePolicy, QuotePolicyPanel } from "./quote-policy-panel";
import styles from "./quotes.module.css";
import {
  createQuotesApi,
  type QuoteApprovalView,
  type QuoteCommandOutcome,
  type QuoteContactOption,
  type QuoteOrganizationUnitOption,
  type QuotePolicyInput,
} from "./quotes-api";
import {
  getQuoteCapabilities,
  getQuotesPageState,
  type Quote,
  type QuotePolicy,
  quoteStatusLabel,
  replayDescription,
} from "./quotes-view-model";

const OPTION_LIMIT = 20;
const QUOTE_LIMIT = 50;
const STATUS_OPTIONS = [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "sent",
  "accepted",
  "expired",
  "cancelled",
] as const;

export function QuotesClient({ apiBaseUrl }: Readonly<{ apiBaseUrl?: string }>) {
  const bootstrap = useTenantAppBootstrap();
  const base = apiBaseUrl || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
  const api = useMemo(() => createQuotesApi(base), [base]);
  const catalogApi = useMemo(() => createCatalogApi(base), [base]);
  const capabilities = useMemo(
    () =>
      getQuoteCapabilities({
        modules: bootstrap.effectiveModules,
        permissions: bootstrap.effectivePermissions,
      }),
    [bootstrap.effectiveModules, bootstrap.effectivePermissions],
  );
  const [quotes, setQuotes] = useState<readonly Quote[]>([]);
  const [nextQuoteCursor, setNextQuoteCursor] = useState<string | null>(null);
  const nextQuoteCursorRef = useRef<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Quote | null>(null);
  const [approvalEvidence, setApprovalEvidence] = useState<QuoteApprovalView | null>(null);
  const [editing, setEditing] = useState(false);
  const [policy, setPolicy] = useState<QuotePolicy | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [replayMessage, setReplayMessage] = useState<string | null>(null);
  const [contacts, setContacts] = useState<readonly QuoteContactOption[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactCursor, setContactCursor] = useState<string | null>(null);
  const [contactSearch, setContactSearch] = useState("");
  const [contactsHasMore, setContactsHasMore] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [units, setUnits] = useState<readonly QuoteOrganizationUnitOption[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(false);
  const [unitCursor, setUnitCursor] = useState<string | null>(null);
  const [unitSearch, setUnitSearch] = useState("");
  const [unitsHasMore, setUnitsHasMore] = useState(false);
  const [unitsError, setUnitsError] = useState<string | null>(null);
  const [products, setProducts] = useState<readonly CatalogProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsCursor, setProductsCursor] = useState<string | null>(null);
  const [productsSearch, setProductsSearch] = useState("");
  const [productsHasMore, setProductsHasMore] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);
  const commandKeys = useRef(new Map<string, CommandKeyEntry>());
  const contactsGeneration = useRef(0);
  const unitsGeneration = useRef(0);
  const productsGeneration = useRef(0);
  const quoteListGeneration = useRef(0);

  const makeKey = (intent: string, payload: unknown) =>
    stableCommandKey(commandKeys.current, intent, payload, () => crypto.randomUUID());

  const loadQuotes = useCallback(
    async (append = false) => {
      const generation = ++quoteListGeneration.current;
      if (!capabilities.canRead) {
        setQuotes([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      setListError(null);
      const cursor = append ? nextQuoteCursorRef.current : null;
      try {
        const page = await api.loadQuotes({
          limit: QUOTE_LIMIT,
          ...(statusFilter === "all" ? {} : { status: statusFilter }),
          ...(cursor ? { cursor } : {}),
        });
        if (quoteListGeneration.current !== generation) return;
        setQuotes((current) => (append ? [...current, ...page.items] : page.items));
        nextQuoteCursorRef.current = page.nextCursor;
        setNextQuoteCursor(page.nextCursor);
      } catch (error) {
        if (quoteListGeneration.current !== generation) return;
        setListError(
          error instanceof Error ? error.message : "No se pudo cargar la lista de cotizaciones.",
        );
        if (!append) setQuotes([]);
      } finally {
        if (quoteListGeneration.current === generation) setLoading(false);
      }
    },
    [api, capabilities.canRead, statusFilter],
  );

  useEffect(() => {
    nextQuoteCursorRef.current = null;
    setNextQuoteCursor(null);
    void loadQuotes();
  }, [loadQuotes]);

  useEffect(() => {
    if (!capabilities.canRead) {
      setPolicy(null);
      return;
    }
    void api
      .loadPolicy()
      .then((next) => {
        setPolicy(next);
        setPolicyError(null);
      })
      .catch((error: unknown) => {
        setPolicyError(
          error instanceof Error ? error.message : "No se pudo cargar la política vigente.",
        );
      });
  }, [api, capabilities.canRead]);

  useEffect(() => {
    if (!editing || !capabilities.canCreate || !capabilities.canUseCrm) return;
    const generation = ++contactsGeneration.current;
    const timer = setTimeout(() => {
      setContactsLoading(true);
      void api
        .loadContactOptions({
          ...(contactSearch.trim() ? { search: contactSearch.trim() } : {}),
          limit: OPTION_LIMIT,
        })
        .then((page) => {
          if (contactsGeneration.current !== generation) return;
          setContacts(page.items);
          setContactCursor(page.nextCursor);
          setContactsHasMore(page.nextCursor !== null);
          setContactsError(null);
        })
        .catch((error: unknown) => {
          if (contactsGeneration.current === generation)
            setContactsError(
              error instanceof Error ? error.message : "No se pudieron cargar contactos.",
            );
        })
        .finally(() => {
          if (contactsGeneration.current === generation) setContactsLoading(false);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      if (contactsGeneration.current === generation) ++contactsGeneration.current;
    };
  }, [api, capabilities.canCreate, capabilities.canUseCrm, contactSearch, editing]);

  useEffect(() => {
    if (!editing || !capabilities.canCreate) return;
    const generation = ++unitsGeneration.current;
    const timer = setTimeout(() => {
      setUnitsLoading(true);
      void api
        .loadOrganizationUnitOptions({
          ...(unitSearch.trim() ? { search: unitSearch.trim() } : {}),
          limit: OPTION_LIMIT,
        })
        .then((page) => {
          if (unitsGeneration.current !== generation) return;
          setUnits(page.items);
          setUnitCursor(page.nextCursor);
          setUnitsHasMore(page.nextCursor !== null);
          setUnitsError(null);
        })
        .catch((error: unknown) => {
          if (unitsGeneration.current === generation)
            setUnitsError(
              error instanceof Error
                ? error.message
                : "No se pudieron cargar unidades organizativas.",
            );
        })
        .finally(() => {
          if (unitsGeneration.current === generation) setUnitsLoading(false);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      if (unitsGeneration.current === generation) ++unitsGeneration.current;
    };
  }, [api, capabilities.canCreate, editing, unitSearch]);

  useEffect(() => {
    if (!editing || !capabilities.canReadCatalog) {
      setProducts([]);
      return;
    }
    const generation = ++productsGeneration.current;
    const timer = setTimeout(() => {
      setProductsLoading(true);
      void catalogApi
        .loadCatalog({
          active: true,
          limit: 100,
          ...(productsSearch.trim() ? { search: productsSearch.trim() } : {}),
        })
        .then((page) => {
          if (productsGeneration.current !== generation) return;
          setProducts(page.items);
          setProductsCursor(page.nextCursor);
          setProductsHasMore(page.nextCursor !== null);
          setProductsError(null);
        })
        .catch((error: unknown) => {
          if (productsGeneration.current === generation)
            setProductsError(
              error instanceof Error
                ? error.message
                : "No se pudieron cargar productos del catálogo.",
            );
        })
        .finally(() => {
          if (productsGeneration.current === generation) setProductsLoading(false);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      if (productsGeneration.current === generation) ++productsGeneration.current;
    };
  }, [catalogApi, capabilities.canReadCatalog, editing, productsSearch]);

  async function loadMoreContacts() {
    if (!contactCursor) return;
    const generation = contactsGeneration.current;
    setContactsLoading(true);
    try {
      const page = await api.loadContactOptions({
        ...(contactSearch.trim() ? { search: contactSearch.trim() } : {}),
        cursor: contactCursor,
        limit: OPTION_LIMIT,
      });
      if (contactsGeneration.current !== generation) return;
      setContacts((current) => [...current, ...page.items]);
      setContactCursor(page.nextCursor);
      setContactsHasMore(page.nextCursor !== null);
      setContactsError(null);
    } catch (error) {
      if (contactsGeneration.current === generation)
        setContactsError(
          error instanceof Error ? error.message : "No se pudieron cargar más contactos.",
        );
    } finally {
      if (contactsGeneration.current === generation) setContactsLoading(false);
    }
  }

  async function loadMoreUnits() {
    if (!unitCursor) return;
    const generation = unitsGeneration.current;
    setUnitsLoading(true);
    try {
      const page = await api.loadOrganizationUnitOptions({
        ...(unitSearch.trim() ? { search: unitSearch.trim() } : {}),
        cursor: unitCursor,
        limit: OPTION_LIMIT,
      });
      if (unitsGeneration.current !== generation) return;
      setUnits((current) => [...current, ...page.items]);
      setUnitCursor(page.nextCursor);
      setUnitsHasMore(page.nextCursor !== null);
      setUnitsError(null);
    } catch (error) {
      if (unitsGeneration.current === generation)
        setUnitsError(
          error instanceof Error ? error.message : "No se pudieron cargar más unidades.",
        );
    } finally {
      if (unitsGeneration.current === generation) setUnitsLoading(false);
    }
  }

  async function loadMoreProducts() {
    if (!productsCursor) return;
    const generation = productsGeneration.current;
    setProductsLoading(true);
    try {
      const page = await catalogApi.loadCatalog({
        active: true,
        limit: 100,
        ...(productsSearch.trim() ? { search: productsSearch.trim() } : {}),
        cursor: productsCursor,
      });
      if (productsGeneration.current !== generation) return;
      setProducts((current) => [...current, ...page.items]);
      setProductsCursor(page.nextCursor);
      setProductsHasMore(page.nextCursor !== null);
      setProductsError(null);
    } catch (error) {
      if (productsGeneration.current === generation)
        setProductsError(
          error instanceof Error ? error.message : "No se pudieron cargar más productos.",
        );
    } finally {
      if (productsGeneration.current === generation) setProductsLoading(false);
    }
  }

  function openEditor(quote: Quote | null) {
    setSelected(quote);
    setEditing(true);
    setActionError(null);
    setContacts([]);
    setUnits([]);
    setProducts([]);
    setProductsCursor(null);
    setProductsHasMore(false);
    setContactCursor(null);
    setUnitCursor(null);
    setContactSearch("");
    setUnitSearch("");
    setContactsError(null);
    setUnitsError(null);
    setProductsError(null);
    setProductsSearch("");
  }

  async function saveDraft(values: {
    organizationUnitId: string;
    contactId: string;
    currency: string;
    validUntil: string | null;
    terms: string | null;
    notes: string | null;
    shippingTotal: string;
    lines: readonly QuoteEditorLine[];
  }) {
    if (!capabilities.canCreate || !capabilities.canUseCrm)
      throw new Error(
        "Se requiere Cotizaciones y Contactos activos, además del permiso cotizaciones.create.",
      );
    if (selected) {
      const positions = catalogSnapshotPositionsNeedingConversion(selected, values.lines);
      if (positions.length > 0) {
        throw new Error(
          `Antes de guardar cambios en conceptos, convierte a manual los productos de catálogo conservados (conceptos ${positions.map((position) => position + 1).join(", ")}) o actualízalos explícitamente desde el catálogo. Esto evita reemplazar sus snapshots guardados.`,
        );
      }
    }
    setBusy(true);
    setActionError(null);
    const intent = `quote-save:${selected?.id ?? "new"}`;
    const payload = { ...values, lines: values.lines };
    try {
      let outcome: QuoteCommandOutcome<Quote>;
      if (selected) {
        const patch = buildQuoteDraftPatch({
          expectedRevision: selected.revision,
          idempotencyKey: makeKey(intent, payload),
          metadata: {
            organizationUnitId: values.organizationUnitId,
            contactId: values.contactId,
            currency: values.currency,
            validUntil: values.validUntil,
            terms: values.terms,
            notes: values.notes,
            shippingTotal: values.shippingTotal,
          },
          ...(quoteEditorLinesEqual(selected, values.lines) ? {} : { lines: values.lines }),
        });
        outcome = await api.saveQuoteDraft(selected.id, patch);
      } else {
        const input = buildQuoteDraftInput({ ...values, idempotencyKey: makeKey(intent, payload) });
        outcome = await api.saveQuoteDraft(null, input);
      }
      setSelected(outcome.current);
      setApprovalEvidence(null);
      setReplayMessage(replayDescription(outcome));
      beginCommandIntent(commandKeys.current, intent);
      setEditing(false);
      void loadQuotes();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "No se pudo guardar el borrador.");
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function runCommand(kind: "request" | "approve" | "reject" | "cancel", note = "") {
    if (!selected) return;
    setBusy(true);
    setActionError(null);
    const intent = `quote-${kind}:${selected.id}`;
    const payload = {
      quoteId: selected.id,
      expectedRevision: selected.revision,
      ...(kind === "approve" || kind === "reject"
        ? { reasonCode: "manual_review", note: note.trim() || undefined }
        : {}),
    };
    const key = makeKey(intent, payload);
    try {
      const outcome =
        kind === "request"
          ? await api.requestApproval(selected.id, {
              idempotencyKey: key,
              expectedRevision: selected.revision,
            })
          : kind === "approve"
            ? await api.approveQuote(selected.id, {
                idempotencyKey: key,
                expectedRevision: selected.revision,
                reasonCode: "manual_review",
                ...(note.trim() ? { note: note.trim() } : {}),
              })
            : kind === "reject"
              ? await api.rejectQuote(selected.id, {
                  idempotencyKey: key,
                  expectedRevision: selected.revision,
                  reasonCode: "manual_review",
                  ...(note.trim() ? { note: note.trim() } : {}),
                })
              : await api.cancelQuote(selected.id, {
                  idempotencyKey: key,
                  expectedRevision: selected.revision,
                });
      const latest = await api.loadQuote(selected.id);
      setSelected(latest);
      setApprovalEvidence(kind === "cancel" ? null : (outcome.current as QuoteApprovalView));
      setReplayMessage(
        replayDescription({
          replayed: outcome.replayed,
          recordedOutcome: outcome.recordedOutcome,
          current: latest,
        }),
      );
      beginCommandIntent(commandKeys.current, intent);
      void loadQuotes();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "No se pudo completar la acción.");
    } finally {
      setBusy(false);
    }
  }

  async function convertLineToManual(
    position: number,
    snapshot: Readonly<Record<string, unknown>>,
  ) {
    if (!selected || !capabilities.canCreate) return;
    setBusy(true);
    setActionError(null);
    const intent = `quote-convert:${selected.id}:${position}`;
    const payload = {
      quoteId: selected.id,
      expectedRevision: selected.revision,
      position,
      snapshot,
    };
    try {
      const conversion = buildQuoteManualConversion(position, snapshot);
      const outcome = await api.saveQuoteDraft(selected.id, {
        expectedRevision: selected.revision,
        idempotencyKey: makeKey(intent, payload),
        convertToManual: [conversion],
      });
      setSelected(outcome.current);
      setApprovalEvidence(null);
      setReplayMessage(replayDescription(outcome));
      beginCommandIntent(commandKeys.current, intent);
      void loadQuotes();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "No se pudo convertir el concepto a manual.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function savePolicy(value: EditableQuotePolicy) {
    if (!policy || !capabilities.canManagePolicy) return;
    setBusy(true);
    setPolicyError(null);
    const intent = "quote-policy";
    const { revision, ...settings } = value;
    const payload = { expectedRevision: revision, ...settings };
    const input: QuotePolicyInput = {
      ...settings,
      expectedRevision: revision,
      idempotencyKey: makeKey(intent, payload),
    };
    try {
      const result = await api.updatePolicy(input);
      setPolicy(result.current);
      setReplayMessage(
        result.replayed
          ? `Reintento reconocido: la política original quedó en revisión ${result.recordedOutcome.revision}. La configuración actual está en revisión ${result.current.revision}.`
          : null,
      );
      beginCommandIntent(commandKeys.current, intent);
    } catch (error) {
      setPolicyError(error instanceof Error ? error.message : "No se pudo guardar la política.");
    } finally {
      setBusy(false);
    }
  }

  if (!capabilities.moduleEnabled)
    return (
      <section className={styles.accessState}>
        <span className={styles.accessMark}>!</span>
        <h1>Cotizaciones no disponible</h1>
        <p>El módulo de cotizaciones no está activo.</p>
      </section>
    );
  if (!capabilities.canRead)
    return (
      <section className={styles.accessState}>
        <span className={styles.accessMark}>⌑</span>
        <h1>Permiso de lectura requerido</h1>
        <p>
          Necesitas <code>quotes.read</code> para consultar cotizaciones.
        </p>
      </section>
    );

  const pageState = getQuotesPageState({
    moduleEnabled: capabilities.moduleEnabled,
    canRead: capabilities.canRead,
    loading,
    error: listError,
    items: quotes,
  });
  const editorContacts = selected
    ? [
        {
          id: selected.contactId,
          name: selected.customerNameSnapshot,
          phoneNumber: selected.customerPhoneSnapshot,
        },
        ...contacts.filter((item) => item.id !== selected.contactId),
      ]
    : contacts;
  const editorUnits = selected
    ? [
        { id: selected.organizationUnitId, name: selected.organizationUnitNameSnapshot },
        ...units.filter((item) => item.id !== selected.organizationUnitId),
      ]
    : units;

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Ventas</p>
          <h1>Cotizaciones</h1>
          <p>
            El estado actual y el resultado registrado de cada comando se muestran por separado.
          </p>
        </div>
        {capabilities.canCreate && capabilities.canUseCrm && (
          <button className={styles.primaryButton} onClick={() => openEditor(null)} type="button">
            ＋ Nueva cotización
          </button>
        )}
      </header>
      {capabilities.canCreate && !capabilities.canUseCrm && (
        <p className={styles.warning}>
          Para crear o editar una cotización se requiere el módulo de Contactos además de
          Cotizaciones.
        </p>
      )}
      {editing && (
        <section aria-label="Editor de cotización" className={styles.editorPanel}>
          {actionError && (
            <p className={styles.errorBanner} role="alert">
              {actionError}
            </p>
          )}
          {(contactsError || unitsError || productsError) && (
            <p className={styles.errorBanner} role="alert">
              {[contactsError, unitsError, productsError].filter(Boolean).join(" · ")}
            </p>
          )}
          <QuoteEditor
            key={`${selected?.id ?? "new"}:${selected?.revision ?? 0}`}
            quote={selected}
            contacts={editorContacts}
            units={editorUnits}
            products={products}
            canUseCatalog={capabilities.canReadCatalog}
            contactsLoading={contactsLoading}
            unitsLoading={unitsLoading}
            productsLoading={productsLoading}
            contactsHasMore={contactsHasMore}
            unitsHasMore={unitsHasMore}
            productsHasMore={productsHasMore}
            busy={busy}
            onSearchContacts={(search) => {
              ++contactsGeneration.current;
              setContacts([]);
              setContactCursor(null);
              setContactsHasMore(false);
              setContactsError(null);
              setContactSearch(search);
            }}
            onMoreContacts={() => void loadMoreContacts()}
            onSearchUnits={(search) => {
              ++unitsGeneration.current;
              setUnits([]);
              setUnitCursor(null);
              setUnitsHasMore(false);
              setUnitsError(null);
              setUnitSearch(search);
            }}
            onMoreUnits={() => void loadMoreUnits()}
            onSearchProducts={(search) => {
              ++productsGeneration.current;
              setProducts([]);
              setProductsCursor(null);
              setProductsHasMore(false);
              setProductsError(null);
              setProductsSearch(search);
            }}
            onMoreProducts={() => void loadMoreProducts()}
            onConvertToManual={(position, snapshot) => void convertLineToManual(position, snapshot)}
            onSave={saveDraft}
            onCancel={() => setEditing(false)}
          />
        </section>
      )}
      <section aria-label="Filtros de cotizaciones" className={styles.filters}>
        <label>
          Estado
          <select
            value={statusFilter}
            onChange={(event) => {
              nextQuoteCursorRef.current = null;
              setStatusFilter(event.target.value);
              setNextQuoteCursor(null);
            }}
          >
            <option value="all">Todos</option>
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {quoteStatusLabel(status)}
              </option>
            ))}
          </select>
        </label>
      </section>
      {replayMessage && !selected && (
        <p className={styles.note} role="status">
          {replayMessage}
        </p>
      )}
      {pageState === "loading" ? (
        <p className={styles.loadingState} aria-live="polite">
          Cargando cotizaciones…
        </p>
      ) : pageState === "error" ? (
        <section className={styles.errorState}>
          <h2>No se pudieron cargar las cotizaciones</h2>
          <p>{listError}</p>
          <button
            className={styles.secondaryButton}
            onClick={() => void loadQuotes()}
            type="button"
          >
            Reintentar
          </button>
        </section>
      ) : (
        <QuoteList
          items={quotes}
          onOpen={(quote) => {
            setSelected(quote);
            setApprovalEvidence(null);
            setEditing(false);
            setActionError(null);
          }}
        />
      )}
      {nextQuoteCursor && (
        <div className={styles.actionRow}>
          <button
            className={styles.secondaryButton}
            disabled={loading}
            onClick={() => void loadQuotes(true)}
            type="button"
          >
            {loading ? "Cargando…" : "Cargar más"}
          </button>
        </div>
      )}
      {selected && !editing && (
        <section aria-label={`Detalle ${selected.number}`} className={styles.detailPanel}>
          <header>
            <div>
              <p className={styles.eyebrow}>Detalle</p>
              <h2>{selected.number}</h2>
            </div>
            <div className={styles.actionRow}>
              {capabilities.canCreate &&
                capabilities.canUseCrm &&
                ["draft", "pending_approval", "approved", "rejected"].includes(selected.status) && (
                  <button
                    className={styles.secondaryButton}
                    onClick={() => openEditor(selected)}
                    type="button"
                  >
                    Editar
                  </button>
                )}
              <button
                className={styles.secondaryButton}
                onClick={() => setSelected(null)}
                type="button"
              >
                Cerrar
              </button>
            </div>
          </header>
          {actionError && (
            <p className={styles.errorBanner} role="alert">
              {actionError}
            </p>
          )}
          {replayMessage && (
            <p className={styles.note} role="status">
              {replayMessage}
            </p>
          )}
          <div className={styles.summaryGrid}>
            <div>
              <span>Cliente</span>
              <strong>{selected.customerNameSnapshot}</strong>
              <small>{selected.customerPhoneSnapshot}</small>
            </div>
            <div>
              <span>Unidad</span>
              <strong>{selected.organizationUnitNameSnapshot}</strong>
            </div>
            <div>
              <span>Moneda</span>
              <strong>{selected.currency}</strong>
            </div>
            <div>
              <span>Total actual</span>
              <strong>
                {selected.total === null ? "Sin cálculo" : `${selected.total} ${selected.currency}`}
              </strong>
              <small>Revisión calculada: {selected.calculatedRevision ?? "ninguna"}</small>
            </div>
          </div>
          <div className={styles.detailLines}>
            {selected.lines.map((line) => (
              <article key={line.id}>
                <div>
                  <strong>{line.description}</strong>
                  <small>
                    {line.sku ??
                      (line.source === "catalog" ? "Producto de catálogo" : "Concepto manual")}{" "}
                    · {line.quantity} {line.unit}
                  </small>
                </div>
                <span>
                  {line.lineTotal === null
                    ? "Sin cálculo"
                    : `${line.lineTotal} ${selected.currency}`}
                </span>
              </article>
            ))}
          </div>
          <QuoteApprovalPanel
            quote={selected}
            capabilities={capabilities}
            evidence={approvalEvidence}
            busy={busy}
            onRequest={() => void runCommand("request")}
            onApprove={(note) => void runCommand("approve", note)}
            onReject={(note) => void runCommand("reject", note)}
            onCancel={() => {
              if (window.confirm(`¿Cancelar ${selected.number}?`)) void runCommand("cancel");
            }}
          />
        </section>
      )}
      <section className={styles.policySection}>
        {policyError && (
          <p className={styles.errorBanner} role="alert">
            {policyError}
          </p>
        )}
        <QuotePolicyPanel
          policy={policy}
          canManage={capabilities.canManagePolicy}
          busy={busy}
          onSave={(value) => void savePolicy(value)}
        />
      </section>
    </main>
  );
}
