"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTenantAppBootstrap } from "../tenant-app-shell";
import styles from "./catalog.module.css";
import {
  CatalogApiError,
  type CatalogOrganizationUnit,
  createCatalogApi,
  type ProductInput,
} from "./catalog-api";
import { CatalogEditor } from "./catalog-editor";
import { CatalogList } from "./catalog-list";
import {
  type CatalogFilters,
  type CatalogProduct,
  getCatalogCapabilities,
  getCatalogPageState,
} from "./catalog-view-model";

export function CatalogClient({ apiBaseUrl }: Readonly<{ apiBaseUrl?: string }>) {
  const bootstrap = useTenantAppBootstrap();
  const base = apiBaseUrl || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
  const api = useMemo(() => createCatalogApi(base), [base]);
  const capabilities = useMemo(
    () =>
      getCatalogCapabilities({
        modules: bootstrap.effectiveModules,
        permissions: bootstrap.effectivePermissions,
      }),
    [bootstrap.effectiveModules, bootstrap.effectivePermissions],
  );
  const [items, setItems] = useState<readonly CatalogProduct[]>([]);
  const [unitOptions, setUnitOptions] = useState<readonly CatalogOrganizationUnit[]>([]);
  const [unitError, setUnitError] = useState<string | null>(null);
  const [unitSearch, setUnitSearch] = useState("");
  const [unitCursor, setUnitCursor] = useState<string | null>(null);
  const [unitsLoading, setUnitsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState("true");
  const [editor, setEditor] = useState<CatalogProduct | null | undefined>(undefined);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const nextCursorRef = useRef<string | null>(null);
  const listGeneration = useRef(0);
  const unitGeneration = useRef(0);

  const load = useCallback(
    async (append = false) => {
      const generation = ++listGeneration.current;
      if (!capabilities.canRead) {
        setItems([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      const filters: CatalogFilters = {
        limit: 100,
        ...(active === "all" ? {} : { active: active === "true" }),
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(append && nextCursorRef.current ? { cursor: nextCursorRef.current } : {}),
      };
      try {
        const result = await api.loadCatalog(filters);
        if (listGeneration.current !== generation) return;
        setItems((current) => (append ? [...current, ...result.items] : result.items));
        nextCursorRef.current = result.nextCursor;
        setNextCursor(result.nextCursor);
      } catch (loadError) {
        if (listGeneration.current !== generation) return;
        if (loadError instanceof CatalogApiError && loadError.statusCode === 401) {
          setError(loadError.message);
        } else {
          setError(
            loadError instanceof Error ? loadError.message : "No se pudo cargar el catálogo.",
          );
        }
        setItems([]);
      } finally {
        if (listGeneration.current === generation) setLoading(false);
      }
    },
    [active, api, capabilities.canRead, search],
  );

  useEffect(() => {
    nextCursorRef.current = null;
    setNextCursor(null);
    void load();
  }, [load]);

  useEffect(() => {
    if (!capabilities.canManage) {
      unitGeneration.current += 1;
      setUnitOptions([]);
      setUnitCursor(null);
      setUnitsLoading(false);
      return;
    }
    const generation = ++unitGeneration.current;
    const timer = setTimeout(() => {
      setUnitsLoading(true);
      setUnitCursor(null);
      void api
        .loadOrganizationUnits({
          ...(unitSearch.trim() ? { search: unitSearch.trim() } : {}),
          limit: 50,
        })
        .then((page) => {
          if (unitGeneration.current !== generation) return;
          setUnitOptions(page.items);
          setUnitCursor(page.nextCursor);
          setUnitError(null);
        })
        .catch((error: unknown) => {
          if (unitGeneration.current !== generation) return;
          setUnitError(
            error instanceof Error
              ? error.message
              : "No se pudieron cargar las unidades organizativas.",
          );
        })
        .finally(() => {
          if (unitGeneration.current === generation) setUnitsLoading(false);
        });
    }, 180);
    return () => clearTimeout(timer);
  }, [api, capabilities.canManage, unitSearch]);

  const unitNames = useMemo(
    () => new Map(unitOptions.map((unit) => [unit.id, unit.name])),
    [unitOptions],
  );

  const loadMoreProducts = () => {
    if (nextCursorRef.current) void load(true);
  };
  const loadMoreUnits = async () => {
    if (!unitCursor) return;
    const generation = unitGeneration.current;
    setUnitsLoading(true);
    try {
      const page = await api.loadOrganizationUnits({
        ...(unitSearch.trim() ? { search: unitSearch.trim() } : {}),
        cursor: unitCursor,
        limit: 50,
      });
      if (unitGeneration.current !== generation) return;
      setUnitOptions((current) => [...current, ...page.items]);
      setUnitCursor(page.nextCursor);
    } catch (error) {
      if (unitGeneration.current === generation)
        setUnitError(
          error instanceof Error ? error.message : "No se pudieron cargar más unidades.",
        );
    } finally {
      if (unitGeneration.current === generation) setUnitsLoading(false);
    }
  };

  const save = async (input: ProductInput, id?: string) => {
    await api.saveProduct(input, id);
    setEditor(undefined);
    await load();
  };

  const openEditor = (product: CatalogProduct | null) => {
    unitGeneration.current += 1;
    setUnitOptions([]);
    setUnitCursor(null);
    setUnitError(null);
    setUnitSearch("");
    setEditor(product);
  };

  const archive = async (product: CatalogProduct) => {
    if (
      !window.confirm(
        `¿Archivar “${product.name}”? El producto dejará de estar disponible en nuevas cotizaciones.`,
      )
    )
      return;
    setActionError(null);
    try {
      await api.archiveProduct(product.id);
      await load();
    } catch (archiveError) {
      setActionError(
        archiveError instanceof Error ? archiveError.message : "No se pudo archivar el producto.",
      );
    }
  };

  if (!capabilities.moduleEnabled) {
    return (
      <section className={styles.accessState}>
        <span className={styles.accessMark}>!</span>
        <h1>Catálogo no disponible</h1>
        <p>El módulo de catálogo no está activo para este espacio de trabajo.</p>
      </section>
    );
  }
  if (!capabilities.canRead) {
    return (
      <section className={styles.accessState}>
        <span className={styles.accessMark}>⌑</span>
        <h1>Permiso de lectura requerido</h1>
        <p>
          Necesitas <code>catalog.read</code> para consultar los productos.
        </p>
      </section>
    );
  }

  const pageState = getCatalogPageState({ loading, error, items });
  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Ventas</p>
          <h1>Catálogo</h1>
          <p>Productos y precios base disponibles para nuevas cotizaciones.</p>
        </div>
        {capabilities.canManage && (
          <button className={styles.primaryButton} onClick={() => openEditor(null)} type="button">
            ＋ Nuevo producto
          </button>
        )}
      </header>
      {editor !== undefined && (
        <section aria-label="Editor de producto" className={styles.editorPanel}>
          <CatalogEditor
            product={editor}
            canChooseUnit={capabilities.canManage}
            unitOptions={unitOptions}
            unitError={unitError}
            unitSearch={unitSearch}
            unitHasMore={unitCursor !== null}
            unitsLoading={unitsLoading}
            onSearchUnits={(search) => {
              unitGeneration.current += 1;
              setUnitOptions([]);
              setUnitCursor(null);
              setUnitSearch(search);
            }}
            onMoreUnits={() => void loadMoreUnits()}
            onSave={save}
            onCancel={() => setEditor(undefined)}
          />
        </section>
      )}
      <section aria-label="Filtros del catálogo" className={styles.filters}>
        <label>
          Buscar
          <input
            autoComplete="off"
            placeholder="SKU o nombre"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          Estado
          <select value={active} onChange={(event) => setActive(event.target.value)}>
            <option value="true">Activos</option>
            <option value="false">Archivados</option>
            <option value="all">Todos</option>
          </select>
        </label>
      </section>
      {actionError && (
        <div className={styles.errorBanner} role="alert">
          {actionError}
        </div>
      )}
      {pageState === "loading" ? (
        <p className={styles.loadingState} aria-live="polite">
          Cargando catálogo…
        </p>
      ) : pageState === "error" ? (
        <section className={styles.errorState}>
          <h2>No se pudo cargar el catálogo</h2>
          <p>{error}</p>
          <button className={styles.secondaryButton} onClick={() => void load()} type="button">
            Reintentar
          </button>
        </section>
      ) : (
        <CatalogList
          items={items}
          canManage={capabilities.canManage}
          unitNames={unitNames}
          onEdit={openEditor}
          onArchive={(item) => void archive(item)}
        />
      )}
      {pageState === "loaded" && nextCursor && (
        <div className={styles.pager}>
          <span>Se muestran {items.length} productos.</span>
          <button
            className={styles.secondaryButton}
            disabled={loading}
            onClick={loadMoreProducts}
            type="button"
          >
            {loading ? "Cargando…" : "Cargar más"}
          </button>
        </div>
      )}
    </main>
  );
}
