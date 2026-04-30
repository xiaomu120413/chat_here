import { invoke } from "@tauri-apps/api/core";
import { normalizeInvokeError } from "./tauriOpenAITransport.js";

export function createTauriCopilotTransport(options = {}) {
  const invokeImpl = options.invokeImpl ?? invoke;

  return {
    async createResponse({ model, input }) {
      try {
        return await invokeImpl("copilot_exec_response", {
          request: {
            model,
            input,
          },
        });
      } catch (error) {
        throw normalizeInvokeError(error, "Copilot request failed");
      }
    },
  };
}
