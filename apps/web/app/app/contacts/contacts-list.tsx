"use client";

import { useState } from "react";
import type { ContactItem } from "./contacts-view-model";

type ContactsListProps = Readonly<{
  contacts: readonly ContactItem[];
  loading: boolean;
  canWrite: boolean;
  onEdit: (contact: ContactItem) => void;
  onArchive: (contactId: string) => Promise<void>;
  onNewContact: () => void;
}>;

export function ContactsList({
  contacts,
  loading,
  canWrite,
  onEdit,
  onArchive,
  onNewContact,
}: ContactsListProps) {
  const [archivingId, setArchivingId] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600 mb-2" />
        <p className="text-sm text-slate-500 dark:text-slate-400">Cargando contactos...</p>
      </div>
    );
  }

  if (contacts.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center text-xl mb-3">
          👥
        </div>
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          No hay contactos disponibles
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto mt-1 mb-4">
          No se encontraron contactos con los filtros actuales. Puedes registrar un nuevo contacto
          para comenzar a interactuar y enviar mensajes.
        </p>
        {canWrite && (
          <button
            type="button"
            onClick={onNewContact}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium shadow-sm transition-colors"
          >
            <span>+</span> Agregar Primer Contacto
          </button>
        )}
      </div>
    );
  }

  async function handleArchive(contactId: string) {
    if (!confirm("¿Estás seguro de que deseas archivar este contacto?")) return;
    setArchivingId(contactId);
    try {
      await onArchive(contactId);
    } finally {
      setArchivingId(null);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider">
              <th className="px-6 py-3.5">Contacto</th>
              <th className="px-6 py-3.5">Teléfono (WhatsApp)</th>
              <th className="px-6 py-3.5">Correo Electrónico</th>
              <th className="px-6 py-3.5">Etiquetas</th>
              <th className="px-6 py-3.5">Estado</th>
              <th className="px-6 py-3.5 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {contacts.map((contact) => {
              const isArchiving = archivingId === contact.id;
              const isArchived = contact.status === "ARCHIVED";

              return (
                <tr
                  key={contact.id}
                  className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
                >
                  {/* Name + Avatar */}
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center text-xs font-bold uppercase">
                        {contact.name.substring(0, 2)}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {contact.name}
                        </div>
                        <div className="text-[11px] text-slate-400 dark:text-slate-500">
                          Registrado{" "}
                          {new Date(contact.createdAt).toLocaleDateString("es-MX", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Phone */}
                  <td className="px-6 py-4 font-mono text-xs text-slate-700 dark:text-slate-300">
                    {contact.phoneNumber}
                  </td>

                  {/* Email */}
                  <td className="px-6 py-4 text-xs text-slate-600 dark:text-slate-400">
                    {contact.email ?? "—"}
                  </td>

                  {/* Tags */}
                  <td className="px-6 py-4">
                    {contact.tags && contact.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {contact.tags.map((tag) => (
                          <span
                            key={tag}
                            className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400 italic">Sin etiquetas</span>
                    )}
                  </td>

                  {/* Status */}
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                        isArchived
                          ? "bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700"
                          : "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
                      }`}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: isArchived ? "#adb5bd" : "#2b8a3e" }}
                      />
                      {isArchived ? "Archivado" : "Activo"}
                    </span>
                  </td>

                  {/* Actions */}
                  <td className="px-6 py-4 text-right">
                    {canWrite ? (
                      <div className="inline-flex items-center gap-2 justify-end">
                        <button
                          type="button"
                          onClick={() => onEdit(contact)}
                          className="px-2.5 py-1 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        >
                          Editar
                        </button>
                        {!isArchived && (
                          <button
                            type="button"
                            disabled={isArchiving}
                            onClick={() => handleArchive(contact.id)}
                            className="px-2.5 py-1 text-xs font-medium rounded-lg border border-rose-200 dark:border-rose-900 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                          >
                            {isArchiving ? "..." : "Archivar"}
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400 italic">Solo lectura</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
