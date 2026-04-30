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
import { renderMessages, renderSessionList, renderMemberList, renderHistory, updateProgress, scrollToBottom } from "./render.js";

const store = createLocalStorageStore();
const healthClient = createTauriOpenAIHealthClient();
const authBroker = createTauriAuthBroker();

let sessions = [];
let currentSession = null;
let healthState = { ready: false, pending: true, message: "检查认证..." };

const AGENT_NAMES = {
  codex: "Codex",
  copilot: "Copilot",
  gateway: "Gateway",
};

export function initGatewayController() {
  initElements();
  initDefaultSessions();
  checkHealth();
  loadHistory();
}

function initElements() {
  const elements = {
    sessionList: document.getElementById("session-list"),
    memberList: document.getElementById("member-list"),
    historyList: document.getElementById("history-list"),
    chatMessages: document.getElementById("chat-messages"),
    headerTitle: document.getElementById("header-title"),
    headerCount: document.getElementById("header-count"),
    messageInput: document.getElementById("message-input"),
    sendBtn: document.getElementById("send-btn"),
    detailPanel: document.getElementById("detail-panel"),
    configPanel: document.getElementById("config-panel"),
    createBtn: document.getElementById("create-btn"),
    showDetail: document.getElementById("show-detail"),
    showConfig: document.getElementById("show-config"),
    detailClose: document.getElementById("detail-close"),
    configClose: document.getElementById("config-close"),
    modalOverlay: document.getElementById("modal-overlay"),
    modalClose: document.getElementById("modal-close"),
    createCancel: document.getElementById("create-cancel"),
    createConfirm: document.getElementById("create-confirm"),
    groupNameInput: document.getElementById("group-name-input"),
    modelInput: document.getElementById("model-input"),
    copilotModelInput: document.getElementById("copilot-model-input"),
    roundInput: document.getElementById("round-input"),
    codexAuthBtn: document.getElementById("codex-auth-btn"),
    copilotAuthBtn: document.getElementById("copilot-auth-btn"),
    providerHealth: document.getElementById("provider-health"),
    summaryBox: document.getElementById("summary-box"),
  };

  renderModelOptions(elements.modelInput, CODEX_MODELS, DEFAULT_CODEX_MODEL);
  renderModelOptions(elements.copilotModelInput, COPILOT_MODELS, DEFAULT_COPILOT_MODEL);

  elements.sessionList.addEventListener("click", (e) => {
    const item = e.target.closest(".session-item");
    if (!item) return;
    switchSession(item.dataset.id);
  });

  elements.memberList.addEventListener("click", (e) => {
    const item = e.target.closest(".member-item");
    if (!item) return;
    const memberId = item.dataset.id;
    if (memberId === "me") return;
    createPrivateChat(memberId);
  });

  elements.historyList.addEventListener("click", (e) => {
    const item = e.target.closest(".history-item");
    if (!item) return;
    loadHistoryRun(item.dataset.id);
  });

  elements.sendBtn.addEventListener("click", () => sendMessage(elements));
  elements.messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(elements);
    }
  });

  elements.createBtn.addEventListener("click", () => {
    elements.modalOverlay.classList.remove("hidden");
    elements.groupNameInput.value = "";
    elements.groupNameInput.focus();
  });

  elements.modalClose.addEventListener("click", closeModal);
  elements.createCancel.addEventListener("click", closeModal);
  elements.createConfirm.addEventListener("click", () => createGroup(elements));

  elements.showDetail.addEventListener("click", () => {
    elements.detailPanel.classList.toggle("hidden");
  });

  elements.showConfig.addEventListener("click", () => {
    elements.configPanel.classList.toggle("show");
  });

  elements.detailClose.addEventListener("click", () => {
    elements.detailPanel.classList.add("hidden");
  });

  elements.configClose.addEventListener("click", () => {
    elements.configPanel.classList.add("show");
    elements.configPanel.classList.remove("show");
  });

  elements.codexAuthBtn.addEventListener("click", () => startAuth(AuthAgent.CODEX));
  elements.copilotAuthBtn.addEventListener("click", () => startAuth(AuthAgent.COPILOT));
}

function initDefaultSessions() {
  const defaultGroup = {
    id: "default-group",
    type: "group",
    name: "架构讨论组",
    members: ["me", "codex", "copilot", "gateway"],
    messages: [],
    isDefault: true,
  };

  sessions.push(defaultGroup);
  currentSession = defaultGroup.id;
  renderSessionList(sessions, currentSession);
  renderMemberList(defaultGroup.members);
  switchSession(defaultGroup.id);
}

function closeModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
}

function createGroup(elements) {
  const name = elements.groupNameInput.value.trim();
  if (!name) {
    elements.groupNameInput.focus();
    return;
  }

  const checkboxes = document.querySelectorAll("#member-checkbox-list input:checked");
  const members = Array.from(checkboxes).map(cb => cb.value);

  if (members.length < 2) {
    alert("请至少选择2个成员");
    return;
  }

  const group = {
    id: `group-${Date.now()}`,
    type: "group",
    name,
    members: ["me", ...members],
    messages: [],
    lastMessage: "群聊已创建",
    lastTime: Date.now(),
  };

  sessions.unshift(group);
  renderSessionList(sessions, currentSession);
  closeModal();
  switchSession(group.id);
}

function createPrivateChat(memberId) {
  const existing = sessions.find(s => s.type === "private" && s.member === memberId);
  if (existing) {
    switchSession(existing.id);
    return;
  }

  const chat = {
    id: `private-${memberId}-${Date.now()}`,
    type: "private",
    name: AGENT_NAMES[memberId] || memberId,
    member: memberId,
    members: ["me", memberId],
    messages: [],
    lastMessage: "开始私聊",
    lastTime: Date.now(),
  };

  sessions.unshift(chat);
  renderSessionList(sessions, currentSession);
  switchSession(chat.id);
}

function switchSession(sessionId) {
  currentSession = sessionId;
  const session = sessions.find(s => s.id === sessionId);
  if (!session) return;

  document.getElementById("header-title").textContent = session.name;
  document.getElementById("header-count").textContent = session.type === "group" 
    ? `${session.members.length}人` 
    : "私聊";

  renderSessionList(sessions, currentSession);
  renderMemberList(session.members);
  renderMessages(session.messages || []);

  if (session.isDefault) {
    document.getElementById("detail-panel").classList.remove("hidden");
  }
}

async function sendMessage(elements) {
  const input = elements.messageInput;
  const text = input.value.trim();
  if (!text) return;

  const session = sessions.find(s => s.id === currentSession);
  if (!session) return;

  input.value = "";

  if (session.type === "private") {
    appendMessage(session, "me", text);
    renderMessages(session.messages);
    scrollToBottom(elements.chatMessages);
    
    appendMessage(session, session.member, "私聊功能暂未接入AI模型，请使用群聊讨论功能");
    renderMessages(session.messages);
    scrollToBottom(elements.chatMessages);
    return;
  }

  if (!session.isDefault) {
    appendMessage(session, "me", text);
    renderMessages(session.messages);
    scrollToBottom(elements.chatMessages);
    
    appendMessage(session, "gateway", "自定义群聊暂未接入AI模型，请使用默认群聊");
    renderMessages(session.messages);
    scrollToBottom(elements.chatMessages);
    return;
  }

  if (!healthState.ready) {
    appendMessage(session, "gateway", `认证未就绪: ${healthState.message}`);
    renderMessages(session.messages);
    scrollToBottom(elements.chatMessages);
    return;
  }

  elements.sendBtn.disabled = true;
  appendMessage(session, "me", text);
  renderMessages(session.messages);
  scrollToBottom(elements.chatMessages);

  updateProgress("dispatch", "active", "进行中");

  try {
    const result = await startRun(text, {
      store,
      maxRounds: parseInt(elements.roundInput.value) || 1,
      providers: buildConfig(elements),
      onUpdate: (progress) => {
        syncMessagesFromRun(session, progress.messages);
        renderMessages(session.messages);
        scrollToBottom(elements.chatMessages);
        updateProgressFromRun(progress.run);
      },
    });

    syncMessagesFromRun(session, result.messages);
    renderMessages(session.messages);
    scrollToBottom(elements.chatMessages);
    updateProgressFromRun(result.run);
    
    elements.summaryBox.textContent = result.decision 
      ? `${result.decision.summary}\n\n${result.decision.rationale}`
      : "讨论完成";

    await loadHistory();
  } catch (err) {
    appendMessage(session, "gateway", `发生错误: ${err.message}`);
    renderMessages(session.messages);
    scrollToBottom(elements.chatMessages);
    updateProgress("review", "active", "失败");
  } finally {
    elements.sendBtn.disabled = false;
  }
}

function appendMessage(session, from, content) {
  session.messages.push({
    id: `msg-${Date.now()}`,
    from,
    content,
    time: Date.now(),
  });
  session.lastMessage = content.slice(0, 30);
  session.lastTime = Date.now();
}

function syncMessagesFromRun(session, runMessages) {
  session.messages = runMessages.map(msg => ({
    id: `msg-${msg.createdAt || Date.now()}`,
    from: msg.source.toLowerCase(),
    content: msg.content,
    time: msg.createdAt || Date.now(),
  }));
}

function updateProgressFromRun(run) {
  if (run.status === "COMPLETED") {
    updateProgress("dispatch", "done", "完成");
    updateProgress("review", "done", "完成");
    updateProgress("decision", "done", "完成");
  } else if (run.status === "FAILED") {
    updateProgress("review", "active", "失败");
  } else if (run.currentStep?.includes("CODEX")) {
    updateProgress("dispatch", "done", "完成");
    updateProgress("review", "active", "进行中");
  } else if (run.currentStep?.includes("COPILOT")) {
    updateProgress("dispatch", "done", "完成");
    updateProgress("review", "active", "进行中");
  }
}

async function checkHealth() {
  const el = document.getElementById("provider-health");
  el.textContent = "检查认证...";
  
  try {
    const result = normalizeHealthResult(await healthClient.check());
    healthState = selectHealth(result);
    el.textContent = healthState.message;
    el.style.color = healthState.ready ? "#10b981" : "#ef4444";
  } catch (err) {
    healthState = { ready: false, message: err.message };
    el.textContent = err.message;
    el.style.color = "#ef4444";
  }
}

async function startAuth(agent) {
  try {
    const result = await authBroker.start(agent);
    await checkHealth();
  } catch (err) {
    document.getElementById("provider-health").textContent = err.message;
  }
}

function selectHealth(result) {
  const checks = [
    { name: "Codex", ...result.agents.codex },
    { name: "Copilot", ...result.agents.copilot },
  ];

  const missing = checks.filter(c => !c.ready);
  if (missing.length > 0) {
    return {
      ready: false,
      message: missing.map(c => `${c.name}: ${c.message}`).join("; "),
    };
  }

  return { ready: true, message: "认证就绪" };
}

async function loadHistory() {
  const runs = await store.listRuns();
  const snapshots = await Promise.all(runs.slice(0, 10).map(r => store.getRun(r.id)));
  renderHistory(snapshots.filter(Boolean));
}

async function loadHistoryRun(runId) {
  const snapshot = await store.getRun(runId);
  if (!snapshot) return;

  const session = sessions.find(s => s.isDefault);
  if (session) {
    syncMessagesFromRun(session, snapshot.messages || []);
    renderMessages(session.messages);
    scrollToBottom(document.getElementById("chat-messages"));
    
    document.getElementById("summary-box").textContent = snapshot.decision
      ? `${snapshot.decision.summary}\n\n${snapshot.decision.rationale}`
      : "历史记录";
  }

  switchSession(session?.id || "default-group");
}

function buildConfig(elements) {
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
  models.forEach(model => {
    const opt = document.createElement("option");
    opt.value = model.id;
    opt.textContent = model.label;
    opt.selected = model.id === selected;
    select.appendChild(opt);
  });
}