import { invoke } from "@tauri-apps/api/core";

export const AuthAgent = Object.freeze({
  CODEX: "codex",
  COPILOT: "copilot",
});

export function createTauriAuthBroker(options = {}) {
  const invokeImpl = options.invokeImpl ?? invoke;

  return {
    async start(agent) {
      return invokeImpl("start_agent_auth", {
        request: { agent },
      });
    },
  };
}
