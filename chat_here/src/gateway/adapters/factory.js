import { createMockCodexAdapter } from "./mockCodexAdapter.js";
import { createMockCopilotAdapter } from "./mockCopilotAdapter.js";
import { createCodexAdapter } from "./codexAdapter.js";
import { createCopilotAdapter } from "./copilotAdapter.js";
import { ProviderId, createProviderConfig } from "./config.js";
import { createTauriCodexTransport } from "./tauriCodexTransport.js";
import { createTauriCopilotTransport } from "./tauriCopilotTransport.js";
import { createTauriOpenAIResponsesTransport } from "./tauriOpenAITransport.js";

export function createAdapters(providerInput = {}, options = {}) {
  const config = createProviderConfig(providerInput);

  return {
    codex: createCodexProvider(config.codex, options.codex),
    copilot: createCopilotProvider(config.copilot, options.copilot),
    config,
  };
}

function createCodexProvider(config, options) {
  if (config.provider === ProviderId.MOCK) {
    return createMockCodexAdapter(options);
  }

  if (config.provider === ProviderId.OPENAI) {
    return createCodexAdapter(config, options);
  }

  if (config.provider === ProviderId.TAURI_OPENAI) {
    return createCodexAdapter(config, {
      ...options,
      transport: options?.transport ?? createTauriOpenAIResponsesTransport(options),
    });
  }

  if (config.provider === ProviderId.TAURI_CODEX) {
    return createCodexAdapter(config, {
      ...options,
      transport: options?.transport ?? createTauriCodexTransport(options),
    });
  }

  throw new Error(`unsupported codex provider: ${config.provider}`);
}

function createCopilotProvider(config, options) {
  if (config.provider === ProviderId.MOCK) {
    return createMockCopilotAdapter(options);
  }

  if (config.provider === ProviderId.OPENAI) {
    return createCopilotAdapter(config, options);
  }

  if (config.provider === ProviderId.TAURI_OPENAI) {
    return createCopilotAdapter(config, {
      ...options,
      transport: options?.transport ?? createTauriOpenAIResponsesTransport(options),
    });
  }

  if (config.provider === ProviderId.TAURI_COPILOT) {
    return createCopilotAdapter(config, {
      ...options,
      transport: options?.transport ?? createTauriCopilotTransport(options),
    });
  }

  throw new Error(`unsupported copilot provider: ${config.provider}`);
}
