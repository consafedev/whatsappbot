"use client";

import { useState } from "react";
import {
  type CreateKnowledgeDocumentInput,
  createKnowledgeDocument,
  type KnowledgeDocumentItem,
} from "./ai-view-model";

type KnowledgeDocumentModalProps = Readonly<{
  apiBaseUrl: string;
  isOpen: boolean;
  onClose: () => void;
  onCreated: (doc: KnowledgeDocumentItem) => void;
}>;

export function KnowledgeDocumentModal({
  apiBaseUrl,
  isOpen,
  onClose,
  onCreated,
}: KnowledgeDocumentModalProps) {
  const [title, setTitle] = useState("");
  const [sourceType, setSourceType] = useState<"text" | "markdown" | "faq">("markdown");
  const [sourceUrl, setSourceUrl] = useState("");
  const [rawContent, setRawContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("El título es obligatorio.");
      return;
    }
    if (!rawContent.trim()) {
      setError("El contenido del documento no puede estar vacío.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const payload: CreateKnowledgeDocumentInput = {
        title: title.trim(),
        sourceType,
        sourceUrl: sourceUrl.trim() || undefined,
        rawContent: rawContent.trim(),
      };
      const created = await createKnowledgeDocument(apiBaseUrl, payload);
      onCreated(created);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al indexar el documento.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-2xl rounded-xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-6 py-4">
          <h2 id="modal-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Cargar Documento a la Base de Conocimiento
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="Cerrar modal"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="doc-title"
              className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Título del Documento *
            </label>
            <input
              id="doc-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="ej. Políticas de Reembolso y Devolución"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="doc-source-type"
                className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Tipo de Fuente
              </label>
              <select
                id="doc-source-type"
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value as "text" | "markdown" | "faq")}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="markdown">Markdown (.md)</option>
                <option value="text">Texto Plano (.txt)</option>
                <option value="faq">Preguntas Frecuentes (FAQ)</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="doc-source-url"
                className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                URL de Origen (Opcional)
              </label>
              <input
                id="doc-source-url"
                type="url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://ejemplo.com/faq"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="doc-content"
              className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Contenido del Documento *
            </label>
            <textarea
              id="doc-content"
              required
              rows={8}
              value={rawContent}
              onChange={(e) => setRawContent(e.target.value)}
              placeholder="Pega aquí el contenido que el agente autónomo utilizará para responder consultas..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-mono text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              El contenido será particionado recursivamente e indexado vectorialmente de forma
              automática.
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              {submitting ? "Indexando..." : "Indexar Documento"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
