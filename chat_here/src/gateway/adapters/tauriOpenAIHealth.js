import { invoke } from "@tauri-apps/api/core";

export function createTauriOpenAIHealthClient(options = {}) {
  const invokeImpl = options.invokeImpl ?? invoke;

  return {
    async check() {
      return invokeImpl("openai_health");
    },
  };
}

export function normalizeHealthResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return {
      provider: "tauri_openai",
      ready: false,
      message: "Provider health check returned an invalid payload",
      agents: {
        codex: { ready: false, message: "codex auth status is unavailable" },
        copilot: { ready: false, message: "copilot auth status is unavailable" },
      },
    };
  }

  return {
    provider: typeof result.provider === "string" ? result.provider : "tauri_openai",
    ready: result.ready === true,
    message: typeof result.message === "string" ? result.message : "",
    agents: normalizeAgentHealth(result.agents),
  };
}

function normalizeAgentHealth(agents) {
  return {
    codex: normalizeSingleAgentHealth(agents?.codex, "codex"),
    copilot: normalizeSingleAgentHealth(agents?.copilot, "copilot"),
  };
}

function normalizeSingleAgentHealth(agent, name) {
  if (!agent || typeof agent !== "object" || Array.isArray(agent)) {
    return {
      ready: false,
      message: `${name} auth status is unavailable`,
    };
  }

  return {
    ready: agent.ready === true,
    message: typeof agent.message === "string" ? agent.message : "",
  };
}
