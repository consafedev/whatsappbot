import styles from "./catalog.module.css";
import type { CatalogProduct } from "./catalog-view-model";
import { formatCatalogMoney } from "./catalog-view-model";

export function CatalogList({
  items,
  canManage,
  unitNames,
  onEdit,
  onArchive,
}: Readonly<{
  items: readonly CatalogProduct[];
  canManage: boolean;
  unitNames: ReadonlyMap<string, string>;
  onEdit: (product: CatalogProduct) => void;
  onArchive: (product: CatalogProduct) => void;
}>) {
  if (items.length === 0) {
    return (
      <section className={styles.emptyState}>
        <span aria-hidden="true">◇</span>
        <h2>Sin productos por ahora</h2>
        <p>Los productos activos aparecerán aquí. No se crean registros de muestra.</p>
      </section>
    );
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Producto</th>
            <th scope="col">SKU</th>
            <th scope="col">Precio base</th>
            <th scope="col">Impuesto</th>
            <th scope="col">Unidad</th>
            <th scope="col">Estado</th>
            {canManage && (
              <th scope="col">
                <span className={styles.srOnly}>Acciones</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((product) => (
            <tr key={product.id}>
              <td data-label="Producto">
                <strong>{product.name}</strong>
                {product.description && <small>{product.description}</small>}
              </td>
              <td data-label="SKU">
                <code>{product.sku}</code>
              </td>
              <td data-label="Precio base">
                {formatCatalogMoney(product.price, product.currency, 4)}
              </td>
              <td data-label="Impuesto">
                {product.taxRate === null ? "Sin configurar" : `${product.taxRate}%`}
              </td>
              <td data-label="Unidad">
                {product.organizationUnitId
                  ? (unitNames.get(product.organizationUnitId) ?? "Unidad asignada")
                  : "Todas las unidades"}
              </td>
              <td data-label="Estado">
                <span className={product.active ? styles.activeBadge : styles.inactiveBadge}>
                  {product.active ? "Activo" : "Archivado"}
                </span>
              </td>
              {canManage && (
                <td data-label="Acciones" className={styles.rowActions}>
                  <button
                    className={styles.secondaryButton}
                    onClick={() => onEdit(product)}
                    type="button"
                  >
                    Editar
                  </button>
                  {product.active && (
                    <button
                      className={styles.dangerButton}
                      onClick={() => onArchive(product)}
                      type="button"
                    >
                      Archivar
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
