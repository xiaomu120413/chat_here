export const CODEX_MODELS = Object.freeze([
  { id: "gpt-5.5", label: "GPT-5.5" },
  { id: "gpt-5.4", label: "GPT-5.4" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini" },
  { id: "gpt-5.4-nano", label: "GPT-5.4 nano" },
  { id: "gpt-5.3-codex", label: "GPT-5.3-Codex" },
  { id: "gpt-5.2-codex", label: "GPT-5.2-Codex" },
]);

export const COPILOT_MODELS = Object.freeze([
  { id: "copilot-auto", label: "Copilot Auto" },
  { id: "gpt-5.3-codex", label: "GPT-5.3-Codex" },
  { id: "gpt-5.2-codex", label: "GPT-5.2-Codex" },
  { id: "gpt-5.4", label: "GPT-5.4" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini" },
  { id: "claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
  { id: "claude-opus-4.7", label: "Claude Opus 4.7" },
  { id: "gemini-3.1-pro", label: "Gemini 3.1 Pro" },
]);

export const DEFAULT_CODEX_MODEL = "gpt-5.4";
export const DEFAULT_COPILOT_MODEL = "gpt-5.4-mini";

export function isSupportedCodexModel(model) {
  return CODEX_MODELS.some((candidate) => candidate.id === model);
}

export function isSupportedCopilotModel(model) {
  return COPILOT_MODELS.some((candidate) => candidate.id === model);
}
