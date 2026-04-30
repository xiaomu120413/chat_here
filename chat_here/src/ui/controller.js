import { startRun } from "../gateway/orchestrator/index.js";
import { ProviderId } from "../gateway/adapters/config.js";
import { createTauriOpenAIHealthClient, normalizeHealthResult } from "../gateway/adapters/tauriOpenAIHealth.js";
import { AuthAgent, createTauriAuthBroker } from "../gateway/auth/tauriAuthBroker.js";
import {
  CODEX_MODELS,
  COPILOT_MODELS,
  DEFAULT_CODEX_MODEL,
  DEFAULT_COPILOT_MODEL,
  isSupportedCodexModel,
  isSupportedCopilotModel,
} from "../gateway/models.js";
import { createLocalStorageStore } from "../gateway/store/localStorageStore.js";
import { renderEmpty, renderError, renderHistory, renderLoading, renderRun } from "./render.js";

const store = createLocalStorageStore();
const tauriOpenAIHealth = createTauriOpenAIHealthClient();
const authBroker = createTauriAuthBroker();
let cachedHealth = {
  ready: false,
  pending: true,
  message: "Checking Codex and Copilot auth",
};

export function initGatewayController() {
  const elements = {
    form: document.querySelector("#task-form"),
    taskInput: document.querySelector("#task-input"),
    modelInput: document.querySelector("#model-input"),
    copilotModelInput: document.querySelector("#copilot-model-input"),
    roundInput: document.querySelector("#round-input"),
    providerHealth: document.querySelector("#provider-health"),
    codexAuthButton: document.querySelector("#codex-auth-button"),
    copilotAuthButton: document.querySelector("#copilot-auth-button"),
    runButton: document.querySelector("#send-button"),
    statusText: document.querySelector("#status"),
    summaryText: document.querySelector("#summary-text"),
    roundBadge: document.querySelector("#round-badge"),
    chatPanel: document.querySelector("#chat-panel"),
    copilotState: document.querySelector("#copilot-state"),
    codexState: document.querySelector("#codex-state"),
    historyList: document.querySelector("#history-list"),
    timeline: {
      dispatch: document.querySelector("#timeline-dispatch"),
      review: document.querySelector("#timeline-review"),
      decision: document.querySelector("#timeline-decision"),
    },
  };

  renderEmpty(elements);
  renderModelOptions(elements.modelInput, CODEX_MODELS, DEFAULT_CODEX_MODEL);
  renderModelOptions(elements.copilotModelInput, COPILOT_MODELS, DEFAULT_COPILOT_MODEL);
  refreshHistory(elements);
  refreshProviderHealth(elements, { force: true });

  elements.codexAuthButton.addEventListener("click", () => {
    startAgentAuth(elements, AuthAgent.CODEX);
  });
  elements.copilotAuthButton.addEventListener("click", () => {
    startAgentAuth(elements, AuthAgent.COPILOT);
  });

  elements.form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const prompt = elements.taskInput.value.trim();
    if (!prompt) {
      elements.statusText.textContent = "Enter a task first";
      elements.taskInput.focus();
      return;
    }

    const modelError = validateSelectedModels(elements);
    if (modelError) {
      elements.statusText.textContent = modelError;
      return;
    }

    if (!cachedHealth.ready) {
      elements.statusText.textContent = cachedHealth.message;
      return;
    }

    elements.runButton.disabled = true;
    renderLoading(elements, prompt);

    try {
      const result = await startRun(prompt, {
        store,
        maxRounds: normalizeRoundInput(elements.roundInput.value),
        providers: buildProviderConfig(elements),
        onUpdate(progress) {
          renderRun(elements, progress);
        },
      });
      renderRun(elements, result);
      await refreshHistory(elements);
    } catch (error) {
      renderError(elements, error);
    } finally {
      elements.runButton.disabled = false;
    }
  });

  elements.historyList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-run-id]");
    if (!button) {
      return;
    }

    const snapshot = await store.getRun(button.dataset.runId);
    if (snapshot) {
      renderRun(elements, snapshot);
      elements.statusText.textContent = `Loaded: ${snapshot.run.status}`;
    }
  });
}

async function startAgentAuth(elements, agent) {
  elements.statusText.textContent = `Starting ${agent} auth`;
  try {
    const result = await authBroker.start(agent);
    elements.statusText.textContent = result.message;
  } catch (error) {
    elements.statusText.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    await refreshProviderHealth(elements, { force: true });
  }
}

async function refreshHistory(elements) {
  const runs = await store.listRuns();
  const snapshots = await Promise.all(runs.slice(0, 10).map((run) => store.getRun(run.id)));
  renderHistory(elements, snapshots.filter(Boolean));
}

async function refreshProviderHealth(elements, options = {}) {
  if (options.force !== true && cachedHealth.pending !== true && cachedHealth.message) {
    setProviderHealth(elements, cachedHealth);
    return cachedHealth;
  }

  setProviderHealth(elements, {
    ready: false,
    pending: true,
    message: "Checking Codex and Copilot auth",
  });

  try {
    const health = normalizeHealthResult(await tauriOpenAIHealth.check());
    const selectedHealth = selectProviderHealth(elements, health);
    cachedHealth = selectedHealth;
    setProviderHealth(elements, cachedHealth);
    return cachedHealth;
  } catch (error) {
    cachedHealth = {
      ready: false,
      message: error instanceof Error ? error.message : String(error),
    };
    setProviderHealth(elements, cachedHealth);
    return cachedHealth;
  }
}

function setProviderHealth(elements, health) {
  elements.providerHealth.textContent = health.message;
  elements.providerHealth.classList.toggle("is-ready", health.ready === true);
  elements.providerHealth.classList.toggle("is-pending", health.pending === true);
  elements.providerHealth.classList.toggle("is-error", health.ready !== true && health.pending !== true);
}

function buildProviderConfig(elements) {
  return {
    codex: {
      provider: ProviderId.TAURI_CODEX,
      model: elements.modelInput.value || DEFAULT_CODEX_MODEL,
    },
    copilot: {
      provider: ProviderId.TAURI_COPILOT,
      model: elements.copilotModelInput.value || DEFAULT_COPILOT_MODEL,
    },
  };
}

function renderModelOptions(select, models, selected) {
  select.innerHTML = "";
  for (const model of models) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.label;
    option.selected = model.id === selected;
    select.appendChild(option);
  }
}

function validateSelectedModels(elements) {
  if (!isSupportedCodexModel(elements.modelInput.value)) {
    return `Unsupported Codex model: ${elements.modelInput.value}`;
  }

  if (!isSupportedCopilotModel(elements.copilotModelInput.value)) {
    return `Unsupported Copilot model: ${elements.copilotModelInput.value}`;
  }

  return "";
}

function normalizeRoundInput(value) {
  const rounds = Number(value);
  if (!Number.isInteger(rounds) || rounds < 1) {
    return 1;
  }
  return Math.min(rounds, 5);
}

function selectProviderHealth(elements, health) {
  const checks = [
    { label: "Codex", ...health.agents.codex },
    { label: "Copilot", ...health.agents.copilot },
  ];

  const missing = checks.filter((check) => !check.ready);
  if (missing.length > 0) {
    return {
      ready: false,
      message: missing.map((check) => `${check.label}: ${check.message}`).join("; "),
    };
  }

  return {
    ready: true,
    message: checks.map((check) => `${check.label} auth ready`).join("; "),
  };
}
