import type {
  AiCompletionRequest,
  AiCompletionResponse,
  AiProvider,
  AiProviderCredentials,
  AiProviderType,
} from "../types";

export class MockAiProvider implements AiProvider {
  readonly providerType: AiProviderType = "mock";

  async generateCompletion(
    request: AiCompletionRequest,
    _credentials: AiProviderCredentials,
  ): Promise<AiCompletionResponse> {
    const startTime = Date.now();
    const lastUserMessage = [...request.messages].reverse().find((m) => m.role === "user")?.content ?? "No message";
    const promptLen = request.messages.reduce((acc, m) => acc + m.content.length, 0);
    const promptTokens = Math.max(1, Math.ceil(promptLen / 4));
    const completionTokens = 16;

    return {
      id: `mock-completion-${Date.now()}`,
      model: request.model || "mock-model",
      content: `[Mock AI Response] Echo: ${lastUserMessage}`,
      finishReason: "stop",
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      latencyMs: Math.max(1, Date.now() - startTime),
      rawResponse: { mock: true },
    };
  }

  async fetchAvailableModels(_credentials: AiProviderCredentials): Promise<string[]> {
    return ["mock-gpt-4o", "mock-gemini-pro", "mock-llama-3"];
  }
}
