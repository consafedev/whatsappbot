import { type FormEvent, useState } from "react";
import styles from "./catalog.module.css";
import { type ProductInput, parseProductCustomValues } from "./catalog-api";
import type { CatalogProduct } from "./catalog-view-model";

export function CatalogEditor({
  product,
  canChooseUnit,
  unitOptions,
  unitError,
  unitSearch,
  unitHasMore,
  unitsLoading,
  onSearchUnits,
  onMoreUnits,
  onSave,
  onCancel,
}: Readonly<{
  product: CatalogProduct | null;
  canChooseUnit: boolean;
  unitOptions: readonly Readonly<{ id: string; name: string; code?: string | null }>[];
  unitError: string | null;
  unitSearch: string;
  unitHasMore: boolean;
  unitsLoading: boolean;
  onSearchUnits: (search: string) => void;
  onMoreUnits: () => void;
  onSave: (input: ProductInput, id?: string) => Promise<void>;
  onCancel: () => void;
}>) {
  const [sku, setSku] = useState(product?.sku ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [category, setCategory] = useState(product?.category ?? "");
  const [unit, setUnit] = useState(product?.unit ?? "unidad");
  const [price, setPrice] = useState(product?.price ?? "");
  const [currency, setCurrency] = useState(product?.currency ?? "MXN");
  const [taxCode, setTaxCode] = useState(product?.taxCode ?? "");
  const [taxRate, setTaxRate] = useState(product?.taxRate ?? "");
  const [organizationUnitId, setOrganizationUnitId] = useState(product?.organizationUnitId ?? "");
  const [isExceptional, setIsExceptional] = useState(product?.isExceptional ?? false);
  const [customValues, setCustomValues] = useState(
    product?.customValues == null ? "" : JSON.stringify(product.customValues, null, 2),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    let parsedCustomValues: unknown | null;
    try {
      parsedCustomValues = parseProductCustomValues(customValues);
    } catch (parseError) {
      setError(
        parseError instanceof Error
          ? parseError.message
          : "Los datos personalizados deben ser JSON válido.",
      );
      setBusy(false);
      return;
    }
    const input: ProductInput = {
      sku: sku.trim(),
      name: name.trim(),
      description: description.trim() || null,
      category: category.trim() || null,
      unit: unit.trim(),
      price,
      currency: currency.trim().toUpperCase(),
      taxCode: taxCode.trim() || null,
      taxRate: taxRate === "" ? null : taxRate,
      ...(canChooseUnit ? { organizationUnitId: organizationUnitId || null } : {}),
      isExceptional,
      customValues: parsedCustomValues,
    };
    try {
      await onSave(input, product?.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar el producto.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.editor} onSubmit={submit}>
      <header>
        <div>
          <p className={styles.eyebrow}>{product ? "Editar" : "Nuevo"}</p>
          <h2>{product ? product.name : "Producto"}</h2>
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
          SKU
          <input
            autoComplete="off"
            maxLength={64}
            required
            value={sku}
            onChange={(event) => setSku(event.target.value)}
          />
        </label>
        <label>
          Nombre
          <input
            maxLength={150}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className={styles.spanTwo}>
          Descripción
          <textarea
            maxLength={2000}
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label>
          Categoría
          <input
            maxLength={120}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          />
        </label>
        <label>
          Unidad de venta
          <input
            maxLength={32}
            required
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
          />
        </label>
        <label>
          Precio base
          <input
            inputMode="decimal"
            maxLength={14}
            pattern="\d{1,9}(\.\d{1,4})?"
            required
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
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
            onChange={(event) => setCurrency(event.target.value)}
          />
        </label>
        <label>
          Código fiscal
          <input
            maxLength={64}
            value={taxCode}
            onChange={(event) => setTaxCode(event.target.value)}
          />
        </label>
        <label>
          Tasa de impuesto (%)
          <input
            inputMode="decimal"
            maxLength={8}
            pattern="\d{1,3}(\.\d{1,4})?"
            value={taxRate}
            onChange={(event) => setTaxRate(event.target.value)}
          />
          <small>Déjala vacía si aún no se configura; 0 es una tasa explícita.</small>
        </label>
        {canChooseUnit ? (
          <>
            <label className={styles.spanTwo}>
              Buscar unidad organizativa
              <input
                autoComplete="off"
                maxLength={100}
                value={unitSearch}
                onChange={(event) => onSearchUnits(event.target.value)}
                placeholder="Nombre o código"
              />
            </label>
            <label className={styles.spanTwo}>
              Unidad organizativa
              <select
                value={organizationUnitId}
                onChange={(event) => setOrganizationUnitId(event.target.value)}
              >
                <option value="">Todas las unidades</option>
                {product?.organizationUnitId &&
                  !unitOptions.some((item) => item.id === product.organizationUnitId) && (
                    <option value={product.organizationUnitId}>
                      Unidad existente · se conservará
                    </option>
                  )}
                {unitOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.code ? ` · ${item.code}` : ""}
                  </option>
                ))}
              </select>
              {unitsLoading && <small aria-live="polite">Buscando unidades…</small>}
              {unitHasMore && (
                <button className={styles.secondaryButton} onClick={onMoreUnits} type="button">
                  Cargar más unidades
                </button>
              )}
              {unitError && <small role="alert">{unitError}</small>}
            </label>
          </>
        ) : (
          <p className={`${styles.note} ${styles.spanTwo}`}>
            {product?.organizationUnitId
              ? "La unidad organizativa existente se conservará."
              : "El producto será visible en todas las unidades."}
          </p>
        )}
        <label className={`${styles.checkField} ${styles.spanTwo}`}>
          <input
            checked={isExceptional}
            onChange={(event) => setIsExceptional(event.target.checked)}
            type="checkbox"
          />
          Requiere aprobación por excepción comercial
        </label>
        <label className={styles.spanTwo}>
          Datos personalizados (JSON, opcional)
          <textarea
            maxLength={16384}
            rows={5}
            spellCheck={false}
            value={customValues}
            onChange={(event) => setCustomValues(event.target.value)}
          />
          <small>Objeto de hasta 16 KiB. El servidor valida profundidad y claves seguras.</small>
        </label>
      </div>
      <footer className={styles.formActions}>
        <button className={styles.secondaryButton} onClick={onCancel} type="button">
          Cancelar
        </button>
        <button className={styles.primaryButton} disabled={busy} type="submit">
          {busy ? "Guardando…" : "Guardar producto"}
        </button>
      </footer>
    </form>
  );
}
