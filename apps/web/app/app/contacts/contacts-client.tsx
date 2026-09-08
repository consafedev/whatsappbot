"use client";

import { useCallback, useEffect, useState } from "react";
import { useTenantAppBootstrap } from "../tenant-app-shell";
import { ContactModal } from "./contact-modal";
import { ContactsList } from "./contacts-list";
import { archiveContact, type ContactItem, fetchContacts } from "./contacts-view-model";

type ContactsClientProps = Readonly<{
  apiBaseUrl?: string | undefined;
}>;

export function ContactsClient({ apiBaseUrl }: ContactsClientProps) {
  const bootstrap = useTenantAppBootstrap();
  const base = apiBaseUrl ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

  const hasCrmModule = bootstrap.effectiveModules.includes("module.crm_lite");
  const canReadContacts = bootstrap.effectivePermissions.includes("contacts.read");
  const canWriteContacts = bootstrap.effectivePermissions.includes("contacts.write");

  // State
  const [contacts, setContacts] = useState<readonly ContactItem[]>([]);
  const [_total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [contactToEdit, setContactToEdit] = useState<ContactItem | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  }, []);

  const loadContacts = useCallback(async () => {
    if (!hasCrmModule || !canReadContacts) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchContacts(base, {
        search: searchQuery.trim() || undefined,
        tag: tagFilter.trim() || undefined,
        status: statusFilter !== "ALL" ? statusFilter : undefined,
        limit: 100,
        page: 1,
      });
      setContacts(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar la lista de contactos.");
    } finally {
      setLoading(false);
    }
  }, [base, hasCrmModule, canReadContacts, searchQuery, tagFilter, statusFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadContacts();
    }, 250);
    return () => clearTimeout(timer);
  }, [loadContacts]);

  function handleOpenCreate() {
    setContactToEdit(null);
    setIsModalOpen(true);
  }

  function handleOpenEdit(contact: ContactItem) {
    setContactToEdit(contact);
    setIsModalOpen(true);
  }

  const handleArchive = useCallback(
    async (contactId: string) => {
      try {
        const archived = await archiveContact(base, contactId);
        setContacts((prev) => prev.map((c) => (c.id === contactId ? archived : c)));
        showToast("Contacto archivado exitosamente.");
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Error al archivar el contacto.");
      }
    },
    [base, showToast],
  );

  // Module check
  if (!hasCrmModule) {
    return (
      <div className="p-8 max-w-2xl mx-auto text-center space-y-3">
        <div className="mx-auto w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-950/40 text-amber-600 flex items-center justify-center text-xl font-bold">
          !
        </div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Módulo de Contactos No Contratado
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Tu organización no cuenta con el módulo{" "}
          <code className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">
            module.crm_lite
          </code>{" "}
          activado. Contacta al administrador para habilitar la libreta de contactos y segmentación.
        </p>
      </div>
    );
  }

  // Permission check
  if (!canReadContacts) {
    return (
      <div className="p-8 max-w-2xl mx-auto text-center space-y-3">
        <div className="mx-auto w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-950/40 text-rose-600 flex items-center justify-center text-xl font-bold">
          ✕
        </div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Permiso Insuficiente
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Requieres el permiso{" "}
          <code className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">
            contacts.read
          </code>{" "}
          para consultar la base de datos de contactos.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Libreta de Contactos
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Gestiona tus clientes, prospectos y audiencias para mensajes de WhatsApp y
            automatizaciones.
          </p>
        </div>

        {canWriteContacts && (
          <button
            type="button"
            onClick={handleOpenCreate}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 transition-colors self-start sm:self-auto"
          >
            <span>+</span> Nuevo Contacto
          </button>
        )}
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 px-4 py-3 shadow-lg text-sm transition-all"
        >
          {toastMessage}
        </div>
      )}

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="flex flex-1 gap-3">
          <input
            type="text"
            placeholder="Buscar por nombre o teléfono..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full max-w-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <input
            type="text"
            placeholder="Filtrar por etiqueta..."
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="w-full max-w-[180px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <label
            htmlFor="status-filter-select"
            className="text-xs font-semibold uppercase text-slate-500"
          >
            Estado:
          </label>
          <select
            id="status-filter-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="ALL">Todos los estados</option>
            <option value="ACTIVE">Activos</option>
            <option value="ARCHIVED">Archivados</option>
          </select>
        </div>
      </div>

      {/* Error alert */}
      {error && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 dark:bg-rose-950/40 p-4 text-sm text-rose-800 dark:text-rose-300 flex justify-between items-center">
          <span>{error}</span>
          <button
            type="button"
            onClick={loadContacts}
            className="underline font-medium hover:text-rose-900"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Contacts List */}
      <ContactsList
        contacts={contacts}
        loading={loading}
        canWrite={canWriteContacts}
        onEdit={handleOpenEdit}
        onArchive={handleArchive}
        onNewContact={handleOpenCreate}
      />

      {/* Contact Create/Edit Modal */}
      <ContactModal
        apiBaseUrl={base}
        isOpen={isModalOpen}
        contactToEdit={contactToEdit}
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => loadContacts()}
        showToast={showToast}
      />
    </div>
  );
}
