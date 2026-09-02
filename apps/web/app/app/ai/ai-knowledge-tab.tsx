"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type KnowledgeDocumentDetail,
  type KnowledgeDocumentItem,
  deleteKnowledgeDocument,
  fetchKnowledgeDocumentDetail,
  fetchKnowledgeDocuments,
  formatDocumentStatus,
  formatTokens,
} from "./ai-view-model";
import { KnowledgeDocumentModal } from "./knowledge-document-modal";

type AiKnowledgeTabProps = Readonly<{
  apiBaseUrl: string;
  showToast: (msg: string) => void;
}>;

export function AiKnowledgeTab({ apiBaseUrl, showToast }: AiKnowledgeTabProps) {
  const [documents, setDocuments] = useState<readonly KnowledgeDocumentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Modals state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [detailDoc, setDetailDoc] = useState<KnowledgeDocumentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchKnowledgeDocuments(apiBaseUrl);
      setDocuments(data.documents);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar documentos");
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  async function handleOpenDetail(docId: string) {
    setDetailLoading(true);
    try {
      const detail = await fetchKnowledgeDocumentDetail(apiBaseUrl, docId);
      setDetailDoc(detail);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Error al obtener detalle del documento");
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleDelete(docId: string) {
    try {
      await deleteKnowledgeDocument(apiBaseUrl, docId);
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
      setTotal((prev) => Math.max(0, prev - 1));
      setDeletingDocId(null);
      showToast("Documento y fragmentos eliminados correctamente");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Error al eliminar documento");
    }
  }

  const filteredDocs = documents.filter((d) =>
    d.title.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Action header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Documentos Indexados ({total})
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Base de conocimiento vectorial empleada para alimentar el contexto RAG del agente.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsCreateOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm transition-colors"
        >
          <span>+ Cargar Documento</span>
        </button>
      </div>

      {/* Filter / Search input */}
      <div className="flex items-center gap-3">
        <input
          type="search"
          placeholder="Buscar documento por título..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full sm:max-w-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Documents Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Cargando base de conocimiento...</div>
        ) : filteredDocs.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              No hay documentos cargados
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Carga tu primer documento de soporte, preguntas frecuentes o catálogo para habilitar respuestas RAG.
            </p>
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="mt-4 inline-flex items-center rounded-lg border border-indigo-600 px-4 py-2 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30"
            >
              Cargar primer documento
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-3">Título</th>
                  <th className="px-6 py-3">Fuente</th>
                  <th className="px-6 py-3">Fragmentos</th>
                  <th className="px-6 py-3">Tokens</th>
                  <th className="px-6 py-3">Estado</th>
                  <th className="px-6 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredDocs.map((doc) => {
                  const statusInfo = formatDocumentStatus(doc.status);
                  return (
                    <tr key={doc.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-6 py-4 font-medium text-slate-900 dark:text-slate-100">
                        {doc.title}
                      </td>
                      <td className="px-6 py-4 text-slate-500 uppercase text-xs">
                        {doc.sourceType}
                      </td>
                      <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                        {doc.chunksCount} {doc.chunksCount === 1 ? "chunk" : "chunks"}
                      </td>
                      <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                        {formatTokens(doc.tokenCount)}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusInfo.className}`}
                        >
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right space-x-2">
                        <button
                          type="button"
                          onClick={() => handleOpenDetail(doc.id)}
                          disabled={detailLoading}
                          className="rounded-lg px-2.5 py-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                        >
                          Ver fragmentos
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingDocId(doc.id)}
                          className="rounded-lg px-2.5 py-1 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                        >
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Upload Modal */}
      <KnowledgeDocumentModal
        apiBaseUrl={apiBaseUrl}
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={(newDoc) => {
          setDocuments((prev) => [newDoc, ...prev]);
          setTotal((prev) => prev + 1);
          showToast(`Documento '${newDoc.title}' indexado con éxito`);
        }}
      />

      {/* Chunks Inspection Drawer / Modal */}
      {detailDoc && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
        >
          <div className="w-full max-w-3xl rounded-xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[85vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Fragmentos Vectorizados: {detailDoc.title}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Total de {detailDoc.chunks.length} fragmentos generados para búsqueda semántica.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailDoc(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-3 flex-1">
              {detailDoc.chunks.map((chunk) => (
                <div
                  key={chunk.id}
                  className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-3 space-y-1.5"
                >
                  <div className="flex justify-between text-xs text-slate-500 font-medium">
                    <span>Fragmento #{chunk.chunkIndex}</span>
                    <span>{formatTokens(chunk.tokenCount)} tokens</span>
                  </div>
                  <p className="text-sm font-mono text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                    {chunk.content}
                  </p>
                </div>
              ))}
            </div>

            <div className="border-t border-slate-200 dark:border-slate-800 px-6 py-3 flex justify-end">
              <button
                type="button"
                onClick={() => setDetailDoc(null)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingDocId && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
        >
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-900 shadow-xl border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              ¿Eliminar documento de la base de conocimiento?
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Esta acción eliminará de forma permanente el documento y todos sus fragmentos vectoriales asociados en la base de datos.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeletingDocId(null)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => handleDelete(deletingDocId)}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-500"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
