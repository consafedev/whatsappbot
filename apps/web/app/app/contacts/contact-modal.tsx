"use client";

import { useEffect, useState } from "react";
import { type ContactItem, createContact, updateContact } from "./contacts-view-model";

type ContactModalProps = Readonly<{
  apiBaseUrl: string;
  isOpen: boolean;
  contactToEdit?: ContactItem | null | undefined;
  onClose: () => void;
  onSuccess: (contact: ContactItem) => void;
  showToast: (msg: string) => void;
}>;

export function ContactModal({
  apiBaseUrl,
  isOpen,
  contactToEdit,
  onClose,
  onSuccess,
  showToast,
}: ContactModalProps) {
  const isEditing = Boolean(contactToEdit);

  const [name, setName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      if (contactToEdit) {
        setName(contactToEdit.name);
        setPhoneNumber(contactToEdit.phoneNumber);
        setEmail(contactToEdit.email ?? "");
        setTags([...contactToEdit.tags]);
        setTagsInput("");
      } else {
        setName("");
        setPhoneNumber("");
        setEmail("");
        setTags([]);
        setTagsInput("");
      }
    }
  }, [isOpen, contactToEdit]);

  if (!isOpen) return null;

  function handleAddTag() {
    const trimmed = tagsInput.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      setTags((prev) => [...prev, trimmed]);
      setTagsInput("");
    }
  }

  function handleRemoveTag(tagToRemove: string) {
    setTags((prev) => prev.filter((t) => t !== tagToRemove));
  }

  function handleKeyDownTag(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      handleAddTag();
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    const trimmedPhone = phoneNumber.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName) {
      setError("El nombre del contacto es requerido.");
      return;
    }

    if (!isEditing && !trimmedPhone) {
      setError("El número de teléfono es requerido.");
      return;
    }

    setSubmitting(true);
    try {
      if (isEditing && contactToEdit) {
        const updated = await updateContact(apiBaseUrl, contactToEdit.id, {
          name: trimmedName,
          email: trimmedEmail || undefined,
          tags: tags.length > 0 ? tags : [],
        });
        showToast("Contacto actualizado exitosamente.");
        onSuccess(updated);
        onClose();
      } else {
        const created = await createContact(apiBaseUrl, {
          name: trimmedName,
          phoneNumber: trimmedPhone,
          email: trimmedEmail || undefined,
          tags: tags.length > 0 ? tags : undefined,
        });
        showToast("Contacto creado exitosamente.");
        onSuccess(created);
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al procesar el contacto.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="contact-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <div className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-6 py-4 bg-slate-50 dark:bg-slate-800/50">
          <div>
            <h2
              id="contact-modal-title"
              className="text-lg font-semibold text-slate-900 dark:text-slate-100"
            >
              {isEditing ? "Editar Contacto" : "Nuevo Contacto"}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {isEditing
                ? "Actualiza la información del contacto en el CRM."
                : "Registra un nuevo contacto para mensajería y campañas."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200"
            aria-label="Cerrar modal"
          >
            ✕
          </button>
        </div>

        {/* Body Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 text-sm rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="contact-name"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1"
            >
              Nombre Completo *
            </label>
            <input
              id="contact-name"
              type="text"
              required
              placeholder="Ej. Juan Pérez"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label
              htmlFor="contact-phone"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1"
            >
              Teléfono (WhatsApp) *
            </label>
            <input
              id="contact-phone"
              type="text"
              required
              disabled={isEditing}
              placeholder="Ej. +52 1 55 1234 5678"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 disabled:bg-slate-100 dark:disabled:bg-slate-800/50 disabled:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
            />
            {isEditing && (
              <p className="text-xs text-slate-400 mt-1">
                El número de teléfono no se puede modificar directamente para preservar el historial
                de mensajes.
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="contact-email"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1"
            >
              Correo Electrónico
            </label>
            <input
              id="contact-email"
              type="email"
              placeholder="juan.perez@ejemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Tags */}
          <div>
            <label
              htmlFor="contact-tags-input"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1"
            >
              Etiquetas de Segmentación
            </label>
            <div className="flex gap-2">
              <input
                id="contact-tags-input"
                type="text"
                placeholder="Escribe una etiqueta y presiona Enter"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                onKeyDown={handleKeyDownTag}
                className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                type="button"
                onClick={handleAddTag}
                className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200"
              >
                Agregar
              </button>
            </div>

            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-sky-100 dark:bg-sky-950/50 text-sky-800 dark:text-sky-300 border border-sky-300 dark:border-sky-800"
                  >
                    <span>#{tag}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="text-sky-600 hover:text-sky-900 dark:text-sky-400 font-bold"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Footer buttons */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white shadow-sm"
            >
              {submitting ? "Guardando..." : isEditing ? "Actualizar" : "Crear Contacto"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
