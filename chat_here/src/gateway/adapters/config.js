export const ProviderId = Object.freeze({
  MOCK: "mock",
  OPENAI: "openai",
  TAURI_OPENAI: "tauri_openai",
  TAURI_CODEX: "tauri_codex",
  TAURI_COPILOT: "tauri_copilot",
});

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5.5";

export function createProviderConfig(input = {}) {
  const codex = normalizeAgentProvider(input.codex ?? { provider: ProviderId.MOCK });
  const copilot = normalizeAgentProvider(input.copilot ?? { provider: ProviderId.MOCK });

  return { codex, copilot };
}

export function normalizeAgentProvider(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("provider config must be an object");
  }

  const provider = input.provider ?? ProviderId.MOCK;
  if (!Object.values(ProviderId).includes(provider)) {
    throw new Error(`unsupported provider: ${provider}`);
  }

  if (provider === ProviderId.MOCK) {
    return { provider };
  }

  if (
    provider === ProviderId.TAURI_OPENAI ||
    provider === ProviderId.TAURI_CODEX ||
    provider === ProviderId.TAURI_COPILOT
  ) {
    return {
      provider,
      baseUrl: normalizeUrl(input.baseUrl ?? DEFAULT_OPENAI_BASE_URL),
      model: normalizeModel(input.model ?? DEFAULT_OPENAI_MODEL),
    };
  }

  return {
    provider,
    apiKey: normalizeApiKey(input.apiKey),
    baseUrl: normalizeUrl(input.baseUrl ?? DEFAULT_OPENAI_BASE_URL),
    model: normalizeModel(input.model ?? DEFAULT_OPENAI_MODEL),
  };
}

function normalizeApiKey(apiKey) {
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw new Error("openai provider requires apiKey");
  }
  return apiKey.trim();
}

function normalizeModel(model) {
  if (typeof model !== "string" || model.trim().length === 0) {
    throw new Error("openai provider requires model");
  }
  return model.trim();
}

function normalizeUrl(url) {
  try {
    return new URL(url).toString().replace(/\/$/, "");
  } catch {
    throw new Error("openai provider requires a valid baseUrl");
  }
}
