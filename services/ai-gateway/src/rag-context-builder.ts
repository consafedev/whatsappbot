import type { AiMessage } from "./types";

export interface RagCitation {
  readonly documentId: string;
  readonly documentTitle: string;
  readonly chunkIndex: number;
  readonly content: string;
  readonly score: number;
}

/**
 * Builds a structured Markdown context block from retrieved knowledge base citations.
 * Returns an empty string if no citations are provided.
 */
export function buildRagContextPrompt(citations: readonly RagCitation[]): string {
  if (!citations || citations.length === 0) {
    return "";
  }

  const lines: string[] = ["--- CONTEXTO DE LA BASE DE CONOCIMIENTO ---"];

  for (const citation of citations) {
    const relevance = (citation.score * 100).toFixed(1);
    lines.push(
      `[Fuente: ${citation.documentTitle} | Fragmento #${citation.chunkIndex} | Relevancia: ${relevance}%]`,
    );
    lines.push(citation.content);
    lines.push("");
  }

  lines.push("--- FIN DEL CONTEXTO ---");

  return lines.join("\n").trim();
}

/**
 * Injects formatted RAG context into the system message of a conversation.
 * If a system message already exists, appends the context. Otherwise, prepends a new system message.
 */
export function injectRagContextIntoMessages(
  messages: readonly AiMessage[],
  ragContext: string,
): readonly AiMessage[] {
  const trimmedContext = ragContext.trim();
  if (!trimmedContext) {
    return [...messages];
  }

  const systemIndex = messages.findIndex((m) => m.role === "system");

  if (systemIndex >= 0) {
    const existingSystem = messages[systemIndex];
    if (!existingSystem) {
      return [...messages];
    }
    const updatedSystem: AiMessage = {
      role: "system",
      content: `${existingSystem.content}\n\n${trimmedContext}`.trim(),
      name: existingSystem.name,
    };

    const copy = [...messages];
    copy[systemIndex] = updatedSystem;
    return copy;
  }

  return [
    {
      role: "system",
      content: `Utiliza la siguiente información de la base de conocimiento para responder si es relevante:\n\n${trimmedContext}`,
    },
    ...messages,
  ];
}
