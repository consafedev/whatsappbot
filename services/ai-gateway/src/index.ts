export * from "./types";
export * from "./crypto";
export * from "./key-pool";
export * from "./resilient-router";
export * from "./providers/mock-provider";
export * from "./providers/openai-compatible-provider";
export * from "./providers/gemini-provider";

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
