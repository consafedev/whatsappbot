export * from "./crypto";
export * from "./embeddings/gemini-embedding-provider";
export * from "./embeddings/mock-embedding-provider";
export * from "./embeddings/openai-embedding-provider";
export * from "./embeddings/types";
export * from "./key-pool";
export * from "./providers/gemini-provider";
export * from "./providers/mock-provider";
export * from "./providers/openai-compatible-provider";
export * from "./rag-context-builder";
export * from "./resilient-router";
export * from "./text-chunker";
export * from "./types";
export * from "./vector-math";

import { GoogleGeminiEmbeddingProvider } from "./embeddings/gemini-embedding-provider";
import { MockEmbeddingProvider } from "./embeddings/mock-embedding-provider";
import { OpenAiCompatibleEmbeddingProvider } from "./embeddings/openai-embedding-provider";
import type { AiEmbeddingProvider } from "./embeddings/types";
import { GoogleGeminiProvider } from "./providers/gemini-provider";
import { MockAiProvider } from "./providers/mock-provider";
import { OpenAiCompatibleProvider } from "./providers/openai-compatible-provider";
import type { AiProvider, AiProviderType } from "./types";

export function createAiProvider(type: AiProviderType): AiProvider {
  switch (type) {
    case "mock":
      return new MockAiProvider();
    case "google_gemini":
      return new GoogleGeminiProvider();
    case "openai_compatible":
      return new OpenAiCompatibleProvider();
    default: {
      const exhaustiveCheck: never = type;
      throw new Error(`Unsupported AI provider type: ${exhaustiveCheck}`);
    }
  }
}

export function createEmbeddingProvider(type: AiProviderType | string): AiEmbeddingProvider {
  switch (type) {
    case "mock":
      return new MockEmbeddingProvider();
    case "google_gemini":
      return new GoogleGeminiEmbeddingProvider();
    case "openai_compatible":
      return new OpenAiCompatibleEmbeddingProvider();
    default:
      return new OpenAiCompatibleEmbeddingProvider();
  }
}
