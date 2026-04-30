import { invoke } from "@tauri-apps/api/core";

export function createTauriOpenAIResponsesTransport(options = {}) {
  const invokeImpl = options.invokeImpl ?? invoke;

  return {
    async createResponse({ agent, baseUrl, model, input }) {
      try {
        return await invokeImpl("openai_response", {
          request: {
            agent,
            baseUrl,
            model,
            input,
          },
        });
      } catch (error) {
        throw normalizeInvokeError(error, "OpenAI request failed");
      }
    },
  };
}

export function normalizeInvokeError(error, fallbackMessage) {
  if (error instanceof Error) {
    return error;
  }

  const message =
    typeof error?.message === "string" && error.message.trim().length > 0
      ? error.message
      : fallbackMessage ?? String(error);

  return new Error(message);
}
