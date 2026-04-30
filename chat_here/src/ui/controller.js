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
import { renderEmpty, renderError, renderHistory, renderLoading, renderMessages, renderSessionList, renderPrivateChat } from "./render.js";

const store = createLocalStorageStore();
const tauriOpenAIHealth = createTauriOpenAIHealthClient();
const authBroker = createTauriAuthBroker();

let cachedHealth = {
  ready: false,
  pending: true,
  message: "检查认证状态",
};

let currentSession = "arch-group";
let sessions = [
  { id: "arch-group", type: "group", name: "架构讨论组", members: ["me", "codex", "copilot", "gateway"] },
];

export function initGatewayController() {
  const elements = {
    app: document.querySelector(".im-app"),
    sessionList: document.querySelector("#session-list"),
    chatHeader: document.querySelector("#chat-header"),
    chatPanel: document.querySelector("#chat-panel"),
    memberList: document.querySelector("#member-list"),
    historyList: document.querySelector("#history-list"),
    detailPanel: document.querySelector("#detail-panel"),
    configPanel: document.querySelector("#config-panel"),
    configToggle: document.querySelector("#config-toggle"),
    closeDetail: document.querySelector("#close-detail"),
    form: document.querySelector("#task-form"),
    taskInput: document.querySelector("#task-input"),
    modelInput: document.querySelector("#model-input"),
    copilotModelInput: document.querySelector("#copilot-model-input"),
    roundInput: document.querySelector("#round-input"),
    providerHealth: document.querySelector("#provider-health"),
    codexAuthButton: document.querySelector("#codex-auth-button"),
    copilotAuthButton: document.querySelector("#copilot-auth-button"),
    sendButton: document.querySelector("#send-button"),
    statusText: document.querySelector("#status"),
    summaryText: document.querySelector("#summary-text"),
    roundBadge: document.querySelector("#round-badge"),
    codexState: document.querySelector("#codex-state"),
    copilotState: document.querySelector("#copilot-state"),
    timeline: {
      dispatch: document.querySelector("#timeline-dispatch"),
      review: document.querySelector("#timeline-review"),
      decision: document.querySelector("#timeline-decision"),
    },
  };

  renderEmpty(elements);
  renderSessionList(elements.sessionList, sessions, currentSession);
  renderModelOptions(elements.modelInput, CODEX_MODELS, DEFAULT_CODEX_MODEL);
  renderModelOptions(elements.copilotModelInput, COPILOT_MODELS, DEFAULT_COPILOT_MODEL);
  refreshHistory(elements);
  refreshProviderHealth(elements, { force: true });

  elements.sessionList.addEventListener("click", (e) => {
    const item = e.target.closest(".session-item");
    if (!item) return;
    
    const sessionId = item.dataset.session;
    switchSession(elements, sessionId);
  });

  elements.memberList.addEventListener("click", (e) => {
    const member = e.target.closest(".member-row");
    if (!member) return;
    
    const memberId = member.dataset.member;
    if (memberId === "me") return;
    
    startPrivateChat(elements, memberId);
  });

  elements.configToggle.addEventListener("click", () => {
    elements.configPanel.classList.toggle("hidden");
  });

  elements.closeDetail.addEventListener("click", () => {
    elements.app.classList.remove("show-detail");
    elements.detailPanel.classList.add("hidden");
  });

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
      elements.statusText.textContent = "请输入内容";
      elements.taskInput.focus();
      return;
    }

    if (!cachedHealth.ready) {
      elements.statusText.textContent = cachedHealth.message;
      return;
    }

    elements.sendButton.disabled = true;
    elements.taskInput.value = "";
    elements.app.classList.add("show-detail");
    elements.detailPanel.classList.remove("hidden");
    renderLoading(elements, prompt);

    try {
      const result = await startRun(prompt, {
        store,
        maxRounds: normalizeRoundInput(elements.roundInput.value),
        providers: buildProviderConfig(elements),
        onUpdate(progress) {
          renderMessages(elements, progress.messages, progress.run);
          updateTimeline(elements, progress.run);
        },
      });
      renderMessages(elements, result.messages, result.run);
      updateSummary(elements, result);
      updateTimeline(elements, result.run);
      await refreshHistory(elements);
    } catch (error) {
      renderError(elements, error);
    } finally {
      elements.sendButton.disabled = false;
    }
  });

  elements.historyList.addEventListener("click", async (e) => {
    const item = e.target.closest(".history-item");
    if (!item) return;

    const snapshot = await store.getRun(item.dataset.runId);
    if (snapshot) {
      renderMessages(elements, snapshot.messages, snapshot.run);
      updateSummary(elements, snapshot);
      updateTimeline(elements, snapshot.run);
      elements.statusText.textContent = `已加载: ${snapshot.run.status}`;
      
      switchSession(elements, "arch-group");
    }
  });
}

function switchSession(elements, sessionId) {
  currentSession = sessionId;
  renderSessionList(elements.sessionList, sessions, currentSession);
  
  const session = sessions.find(s => s.id === sessionId);
  if (session) {
    updateChatHeader(elements, session);
    
    if (session.type === "private") {
      renderPrivateChat(elements, session);
    } else {
      renderEmpty(elements);
    }
  }
}

function startPrivateChat(elements, memberId) {
  const existing = sessions.find(s => s.id === memberId);
  if (existing) {
    switchSession(elements, memberId);
    return;
  }

  const names = {
    codex: "Codex",
    copilot: "Copilot",
    gateway: "Gateway",
  };

  const session = {
    id: memberId,
    type: "private",
    name: names[memberId] || memberId,
    member: memberId,
  };

  sessions.push(session);
  renderSessionList(elements.sessionList, sessions, currentSession);
  switchSession(elements, memberId);
}

function updateChatHeader(elements, session) {
  const titleEl = elements.chatHeader.querySelector(".header-title");
  const membersEl = elements.chatHeader.querySelector(".header-members");
  
  if (session.type === "group") {
    titleEl.textContent = session.name;
    membersEl.textContent = `${session.members.length}人`;
  } else {
    titleEl.textContent = session.name;
    membersEl.textContent = "私聊";
  }
}

async function startAgentAuth(elements, agent) {
  elements.statusText.textContent = `正在${agent}认证`;
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
  const snapshots = await Promise.all(runs.slice(0, 20).map((run) => store.getRun(run.id)));
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
    message: "检查认证状态",
  });

  try {
    const health = normalizeHealthResult(await tauriOpenAIHealth.check());
    cachedHealth = selectProviderHealth(health);
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
  elements.providerHealth.className = health.ready ? "health-ready" : health.pending ? "health-pending" : "health-error";
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

function normalizeRoundInput(value) {
  const rounds = Number(value);
  if (!Number.isInteger(rounds) || rounds < 1) return 1;
  return Math.min(rounds, 5);
}

function selectProviderHealth(health) {
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
    message: "认证就绪",
  };
}

function updateSummary(elements, result) {
  const { decision, error } = result;
  if (decision) {
    elements.summaryText.textContent = `${decision.summary}\n\n${decision.rationale}`;
  } else if (error) {
    elements.summaryText.textContent = error instanceof Error ? error.message : String(error);
  }
}

function updateTimeline(elements, run) {
  const status = run.status;
  
  elements.timeline.dispatch.classList.remove("active", "done");
  elements.timeline.review.classList.remove("active", "done");
  elements.timeline.decision.classList.remove("active", "done");
  
  if (run.currentStep || status.includes("RUNNING")) {
    elements.timeline.dispatch.classList.add("done");
    elements.timeline.review.classList.add("active");
  }
  
  if (status === "COMPLETED") {
    elements.timeline.dispatch.classList.add("done");
    elements.timeline.review.classList.add("done");
    elements.timeline.decision.classList.add("done");
  }
  
  if (status === "FAILED") {
    elements.timeline.review.classList.add("active");
  }

  elements.roundBadge.textContent = `Round ${run.round}`;
}