import { describe, expect, it } from "vitest";
import { chunkText, sanitizeText } from "./text-chunker";

describe("Text Chunker Unit Tests", () => {
  it("sanitizes text removing null bytes and normalizing newlines", () => {
    const raw = "Hello\0World\r\nSecond line\rThird line";
    const cleaned = sanitizeText(raw);
    expect(cleaned).toBe("HelloWorld\nSecond line\nThird line");
  });

  it("returns empty array for empty or whitespace-only text", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n\t  ")).toEqual([]);
  });

  it("returns single chunk when text is shorter than maxChunkSize", () => {
    const text = "Este es un texto corto que cabe en un solo chunk.";
    const chunks = chunkText(text, { maxChunkSize: 200, chunkOverlap: 20 });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe(text);
    expect(chunks[0]?.index).toBe(0);
    expect(chunks[0]?.charCount).toBe(text.length);
  });

  it("splits long text into multiple chunks respecting paragraph boundaries", () => {
    const p1 =
      "Primer párrafo con información detallada sobre el producto A y sus especificaciones técnicas de alta calidad.";
    const p2 =
      "Segundo párrafo describiendo las políticas de garantía, devolución y tiempos de entrega estimados en 24 horas.";
    const p3 =
      "Tercer párrafo con preguntas frecuentes y métodos de pago aceptados como transferencias y tarjetas de crédito.";
    const longText = `${p1}\n\n${p2}\n\n${p3}`;

    const chunks = chunkText(longText, { maxChunkSize: 120, chunkOverlap: 20 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.content.length <= 120)).toBe(true);
    expect(chunks.every((c, i) => c.index === i)).toBe(true);
  });

  it("throws validation errors for invalid chunking options", () => {
    expect(() => chunkText("test", { maxChunkSize: 0 })).toThrow(
      "maxChunkSize must be greater than 0",
    );
    expect(() => chunkText("test", { maxChunkSize: 100, chunkOverlap: 100 })).toThrow(
      "chunkOverlap must be non-negative and less than maxChunkSize",
    );
    expect(() => chunkText("test", { maxChunkSize: 100, chunkOverlap: -1 })).toThrow(
      "chunkOverlap must be non-negative and less than maxChunkSize",
    );
  });
});
