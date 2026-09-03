import { describe, expect, it } from "vitest";
import {
  buildRagContextPrompt,
  injectRagContextIntoMessages,
  type RagCitation,
} from "./rag-context-builder";
import type { AiMessage } from "./types";

describe("RAG Context Builder Unit Tests", () => {
  const citations: RagCitation[] = [
    {
      documentId: "doc-1",
      documentTitle: "Política de Devoluciones",
      chunkIndex: 0,
      content: "Las devoluciones son gratuitas dentro de los primeros 30 días.",
      score: 0.942,
    },
    {
      documentId: "doc-2",
      documentTitle: "Preguntas Frecuentes",
      chunkIndex: 2,
      content: "El tiempo estimado de entrega es de 24 a 48 horas hábiles.",
      score: 0.815,
    },
  ];

  it("builds formatted RAG context block with citation headers", () => {
    const prompt = buildRagContextPrompt(citations);

    expect(prompt).toContain("--- CONTEXTO DE LA BASE DE CONOCIMIENTO ---");
    expect(prompt).toContain(
      "[Fuente: Política de Devoluciones | Fragmento #0 | Relevancia: 94.2%]",
    );
    expect(prompt).toContain("Las devoluciones son gratuitas dentro de los primeros 30 días.");
    expect(prompt).toContain("[Fuente: Preguntas Frecuentes | Fragmento #2 | Relevancia: 81.5%]");
    expect(prompt).toContain("El tiempo estimado de entrega es de 24 a 48 horas hábiles.");
    expect(prompt).toContain("--- FIN DEL CONTEXTO ---");
  });

  it("returns empty string when citations list is empty", () => {
    expect(buildRagContextPrompt([])).toBe("");
  });

  it("injects RAG context into existing system message", () => {
    const messages: AiMessage[] = [
      { role: "system", content: "Eres un asistente de atención al cliente amable." },
      { role: "user", content: "¿Cómo devuelvo un producto?" },
    ];

    const context = buildRagContextPrompt(citations);
    const enriched = injectRagContextIntoMessages(messages, context);

    expect(enriched).toHaveLength(2);
    expect(enriched[0]?.role).toBe("system");
    expect(enriched[0]?.content).toContain("Eres un asistente de atención al cliente amable.");
    expect(enriched[0]?.content).toContain("--- CONTEXTO DE LA BASE DE CONOCIMIENTO ---");
    expect(enriched[1]?.role).toBe("user");
  });

  it("prepends new system message when none exists", () => {
    const messages: AiMessage[] = [
      { role: "user", content: "¿Cuáles son los tiempos de entrega?" },
    ];

    const context = buildRagContextPrompt(citations);
    const enriched = injectRagContextIntoMessages(messages, context);

    expect(enriched).toHaveLength(2);
    expect(enriched[0]?.role).toBe("system");
    expect(enriched[0]?.content).toContain("--- CONTEXTO DE LA BASE DE CONOCIMIENTO ---");
    expect(enriched[1]?.role).toBe("user");
  });

  it("returns original messages unchanged if ragContext is empty", () => {
    const messages: AiMessage[] = [{ role: "user", content: "Hola" }];
    const enriched = injectRagContextIntoMessages(messages, "");
    expect(enriched).toEqual(messages);
  });
});
