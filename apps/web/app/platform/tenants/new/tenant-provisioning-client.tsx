"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, type InputHTMLAttributes, useState } from "react";
import {
  defaultTenantModules,
  provisioningErrorMessage,
  tenantModuleOptions,
  tenantProvisioningPayload,
} from "./tenant-provisioning-view-model";

const initialForm = {
  channelAccounts: "1",
  defaultCurrency: "MXN",
  defaultLocale: "es-MX",
  defaultTimezone: "America/Mexico_City",
  deploymentId: "",
  displayName: "",
  enabledModules: [...defaultTenantModules] as string[],
  legalName: "",
  monthlyAiBudget: "0",
  organizationUnits: "1",
  ownerDisplayName: "",
  ownerEmail: "",
  ownerPassword: "",
  slug: "",
  storageBytes: "0",
  users: "1",
};

type Field = keyof typeof initialForm;

export function TenantProvisioningClient({ apiBaseUrl }: Readonly<{ apiBaseUrl: string }>) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function setField(field: Field, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function toggleModule(key: string) {
    setForm((current) => ({
      ...current,
      enabledModules: current.enabledModules.includes(key)
        ? current.enabledModules.filter((value) => value !== key)
        : [...current.enabledModules, key],
    }));
  }

  function canContinue(): boolean {
    if (step === 1)
      return Boolean(
        form.displayName.trim() &&
          form.legalName.trim() &&
          form.slug.trim() &&
          form.defaultTimezone.trim() &&
          form.defaultLocale.trim() &&
          form.defaultCurrency.trim(),
      );
    if (step === 2)
      return [form.channelAccounts, form.users, form.organizationUnits, form.storageBytes].every(
        (value) => value.trim() !== "" && Number.isSafeInteger(Number(value)),
      );
    if (step === 3)
      return Boolean(
        form.ownerDisplayName.trim() && form.ownerEmail.trim() && form.ownerPassword.length >= 15,
      );
    return true;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch(`${apiBaseUrl}/platform/tenants`, {
        body: JSON.stringify(tenantProvisioningPayload(form)),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        setForm((current) => ({ ...current, ownerPassword: "" }));
        setError(provisioningErrorMessage(response.status));
        return;
      }
      router.push(
        `/platform/tenants?created=${encodeURIComponent(form.slug.trim().toLowerCase())}`,
      );
      router.refresh();
    } catch {
      setForm((current) => ({ ...current, ownerPassword: "" }));
      setError(provisioningErrorMessage(500));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="tenant-content tenant-create-content">
      <div className="tenant-heading">
        <div>
          <p className="kicker">Platform Control</p>
          <h1>Crear tenant</h1>
          <p className="tenant-subtitle">Aprovisionamiento atómico de workspace y Owner.</p>
        </div>
        <a className="button-secondary" href="/platform/tenants">
          Cancelar
        </a>
      </div>

      <ol className="wizard-steps" aria-label="Progreso">
        {["Empresa", "Capacidades", "Owner", "Confirmación"].map((label, index) => (
          <li
            className={step === index + 1 ? "is-active" : step > index + 1 ? "is-done" : ""}
            key={label}
          >
            <span>{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      <form className="wizard-card" onSubmit={submit}>
        {step === 1 && (
          <section aria-labelledby="company-title">
            <h2 id="company-title">Empresa</h2>
            <div className="form-grid">
              <Field
                label="Nombre visible"
                value={form.displayName}
                onChange={(v) => setField("displayName", v)}
              />
              <Field
                label="Slug"
                value={form.slug}
                onChange={(v) => setField("slug", v)}
                pattern="[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*"
              />
              <Field
                label="Razón social"
                value={form.legalName}
                onChange={(v) => setField("legalName", v)}
              />
              <Field
                label="Timezone IANA"
                value={form.defaultTimezone}
                onChange={(v) => setField("defaultTimezone", v)}
              />
              <Field
                label="Locale"
                value={form.defaultLocale}
                onChange={(v) => setField("defaultLocale", v)}
              />
              <Field
                label="Moneda ISO"
                value={form.defaultCurrency}
                onChange={(v) => setField("defaultCurrency", v)}
                maxLength={3}
              />
              <Field
                label="Deployment UUID (opcional)"
                value={form.deploymentId}
                onChange={(v) => setField("deploymentId", v)}
                required={false}
              />
            </div>
          </section>
        )}

        {step === 2 && (
          <section aria-labelledby="capabilities-title">
            <h2 id="capabilities-title">Capacidades iniciales</h2>
            <p className="form-help">Sólo se crearán los módulos seleccionados.</p>
            <div className="module-choice-grid">
              {tenantModuleOptions.map(([key, label]) => (
                <label className={form.enabledModules.includes(key) ? "is-selected" : ""} key={key}>
                  <input
                    type="checkbox"
                    checked={form.enabledModules.includes(key)}
                    onChange={() => toggleModule(key)}
                  />
                  <span>
                    <strong>{label}</strong>
                    <code>{key}</code>
                  </span>
                </label>
              ))}
            </div>
            <h3>Límites</h3>
            <div className="form-grid form-grid-limits">
              <NumberField
                label="Cuentas WhatsApp"
                value={form.channelAccounts}
                onChange={(v) => setField("channelAccounts", v)}
                min={0}
              />
              <NumberField
                label="Usuarios"
                value={form.users}
                onChange={(v) => setField("users", v)}
                min={1}
              />
              <NumberField
                label="Unidades organizacionales"
                value={form.organizationUnits}
                onChange={(v) => setField("organizationUnits", v)}
                min={1}
              />
              <NumberField
                label="Almacenamiento (bytes)"
                value={form.storageBytes}
                onChange={(v) => setField("storageBytes", v)}
                min={0}
              />
              <NumberField
                label="Presupuesto IA mensual"
                value={form.monthlyAiBudget}
                onChange={(v) => setField("monthlyAiBudget", v)}
                min={0}
                step="0.0001"
                required={false}
              />
            </div>
          </section>
        )}

        {step === 3 && (
          <section aria-labelledby="owner-title">
            <h2 id="owner-title">Usuario Owner</h2>
            <div className="form-grid">
              <Field
                label="Nombre completo"
                value={form.ownerDisplayName}
                onChange={(v) => setField("ownerDisplayName", v)}
              />
              <Field
                label="Correo"
                value={form.ownerEmail}
                onChange={(v) => setField("ownerEmail", v)}
                type="email"
              />
              <Field
                label="Contraseña inicial"
                value={form.ownerPassword}
                onChange={(v) => setField("ownerPassword", v)}
                type="password"
                minLength={15}
                maxLength={128}
                autoComplete="new-password"
              />
            </div>
            <p className="form-help">
              Entre 15 y 128 caracteres. No se guarda en el navegador ni se muestra después del
              envío.
            </p>
          </section>
        )}

        {step === 4 && (
          <section aria-labelledby="review-title">
            <h2 id="review-title">Revisa y confirma</h2>
            <dl className="review-list">
              <div>
                <dt>Tenant</dt>
                <dd>
                  {form.displayName} · <code>{form.slug.toLowerCase()}</code>
                </dd>
              </div>
              <div>
                <dt>Razón social</dt>
                <dd>{form.legalName}</dd>
              </div>
              <div>
                <dt>Deployment</dt>
                <dd>{form.deploymentId || "Sin asignar"}</dd>
              </div>
              <div>
                <dt>Módulos</dt>
                <dd>{form.enabledModules.length}</dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>
                  {form.ownerDisplayName} · {form.ownerEmail}
                </dd>
              </div>
              <div>
                <dt>Estado inicial</dt>
                <dd>Activo al completar la transacción</dd>
              </div>
            </dl>
          </section>
        )}

        {error !== null && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="wizard-actions">
          <button
            className="button-secondary"
            type="button"
            disabled={step === 1 || submitting}
            onClick={() => setStep((value) => value - 1)}
          >
            Atrás
          </button>
          {step < 4 ? (
            <button
              type="button"
              disabled={!canContinue()}
              onClick={() => setStep((value) => value + 1)}
            >
              {step === 3 ? "Revisar" : "Continuar"}
            </button>
          ) : (
            <button type="submit" disabled={submitting}>
              {submitting ? "Creando…" : "Crear tenant"}
            </button>
          )}
        </div>
      </form>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  required = true,
  ...input
}: Readonly<
  { label: string; value: string; onChange(value: string): void; required?: boolean } & Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "onChange" | "value"
  >
>) {
  return (
    <label className="form-field">
      <span>
        {label}
        {required && <b aria-hidden="true"> *</b>}
      </span>
      <input
        {...input}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function NumberField(
  props: Readonly<{
    label: string;
    value: string;
    onChange(value: string): void;
    min: number;
    step?: string;
    required?: boolean;
  }>,
) {
  return <Field {...props} type="number" />;
}
