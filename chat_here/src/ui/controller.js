import { startRun } from "../gateway/orchestrator/index.js";
import { ProviderId } from "../gateway/adapters/config.js";
import { createTauriOpenAIHealthClient, normalizeHealthResult } from "../gateway/adapters/tauriOpenAIHealth.js";
import { AuthAgent, createTauriAuthBroker } from "../gateway/auth/tauriAuthBroker.js";
import {
  CODEX_MODELS,
  COPILOT_MODELS,
  DEFAULT_CODEX_MODEL,
  DEFAULT_COPILOT_MODEL,
} from "../gateway/models.js";
import { createLocalStorageStore } from "../gateway/store/localStorageStore.js";
import { renderMessages, renderSessionList, renderMemberList, renderHistory, updateProgress, scrollToBottom } from "./render.js";
import { invoke } from "@tauri-apps/api/core";

const store = createLocalStorageStore();
const healthClient = createTauriOpenAIHealthClient();
const authBroker = createTauriAuthBroker();

let sessions = [];
let currentSession = null;
let healthState = { ready: false, pending: true, message: "检查认证..." };

const AGENTS = {
  codex: { name: "Codex", role: "Primary builder", model: DEFAULT_CODEX_MODEL },
  copilot: { name: "Copilot", role: "Counterpoint reviewer", model: DEFAULT_COPILOT_MODEL },
};

export function initGatewayController() {
  initElements();
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
    dissolveBtn: document.getElementById("dissolve-btn"),
    sessionInfoSection: document.getElementById("session-info-section"),
    sessionInfoBox: document.getElementById("session-info-box"),
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
    const deleteBtn = e.target.closest(".session-delete");
    if (deleteBtn) {
      const item = deleteBtn.closest(".session-item");
      if (item) deleteSession(item.dataset.id);
      return;
    }
    
    const item = e.target.closest(".session-item");
    if (!item) return;
    switchSession(item.dataset.id);
  });

  elements.memberList.addEventListener("click", (e) => {
    const item = e.target.closest(".member-item");
    if (!item) return;
    const agentId = item.dataset.id;
    if (agentId) createPrivateChat(agentId);
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
    elements.configPanel.classList.remove("show");
  });

  elements.dissolveBtn.addEventListener("click", () => {
    if (currentSession) {
      deleteSession(currentSession);
    }
  });

  elements.codexAuthBtn.addEventListener("click", () => startAuth(AuthAgent.CODEX));
  elements.copilotAuthBtn.addEventListener("click", () => startAuth(AuthAgent.COPILOT));

  elements.historyList.addEventListener("click", (e) => {
    const item = e.target.closest(".history-item");
    if (!item) return;
    loadHistoryRun(item.dataset.id);
  });

  renderEmptyState(elements);
}

function closeModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
}

function deleteSession(sessionId) {
  sessions = sessions.filter(s => s.id !== sessionId);
  
  if (currentSession === sessionId) {
    currentSession = null;
    renderEmptyState({
      headerTitle: document.getElementById("header-title"),
      headerCount: document.getElementById("header-count"),
      chatMessages: document.getElementById("chat-messages"),
      memberList: document.getElementById("member-list"),
      detailPanel: document.getElementById("detail-panel"),
    });
  }
  
  renderSessionList(sessions, currentSession);
}

function renderEmptyState(elements) {
  elements.headerTitle.textContent = "Chat Here";
  elements.headerCount.textContent = "";
  elements.chatMessages.innerHTML = `
    <div class="message-wrapper">
      <div class="message-avatar gateway">G</div>
      <div class="message-content">
        <div class="message-author">Gateway</div>
        <div class="message-text">欢迎来到 Chat Here！点击左上角"+"创建群聊，或点击右侧联系人私聊</div>
      </div>
    </div>
  `;

  elements.sessionInfoSection.style.display = "none";
  elements.dissolveBtn.style.display = "none";

  elements.detailPanel.classList.remove("hidden");
  renderSessionList(sessions, currentSession);
}

function createPrivateChat(agentId) {
  const existing = sessions.find(s => s.type === "private" && s.agent === agentId);
  if (existing) {
    switchSession(existing.id);
    return;
  }

  const agent = AGENTS[agentId];
  const chat = {
    id: `private-${agentId}-${Date.now()}`,
    type: "private",
    name: agent.name,
    agent: agentId,
    model: agent.model,
    messages: [],
    lastMessage: "开始私聊",
    lastTime: Date.now(),
  };

  sessions.unshift(chat);
  renderSessionList(sessions, currentSession);
  switchSession(chat.id);
}

function createGroup(elements) {
  const name = elements.groupNameInput.value.trim();
  if (!name) {
    elements.groupNameInput.focus();
    return;
  }

  const checkboxes = document.querySelectorAll("#member-checkbox-list input:checked");
  const selectedAgents = Array.from(checkboxes).map(cb => cb.value);

  if (selectedAgents.length < 1) {
    alert("请至少选择1个成员");
    return;
  }

  const group = {
    id: `group-${Date.now()}`,
    type: "group",
    name,
    agents: selectedAgents,
    model: elements.modelInput.value,
    copilotModel: elements.copilotModelInput.value,
    rounds: parseInt(elements.roundInput.value) || 1,
    messages: [],
    lastMessage: "群聊已创建",
    lastTime: Date.now(),
  };

  sessions.unshift(group);
  renderSessionList(sessions, currentSession);
  closeModal();
  switchSession(group.id);
}

function switchSession(sessionId) {
  currentSession = sessionId;
  const session = sessions.find(s => s.id === sessionId);
  if (!session) return;

  const elements = {
    headerTitle: document.getElementById("header-title"),
    headerCount: document.getElementById("header-count"),
    chatMessages: document.getElementById("chat-messages"),
    sessionInfoSection: document.getElementById("session-info-section"),
    sessionInfoBox: document.getElementById("session-info-box"),
    dissolveBtn: document.getElementById("dissolve-btn"),
  };

  elements.headerTitle.textContent = session.name;
  elements.headerCount.textContent = session.type === "group" 
    ? `${session.agents.length + 1}人` 
    : "私聊";

  elements.dissolveBtn.textContent = session.type === "group" ? "解散群聊" : "删除私聊";
  elements.dissolveBtn.style.display = "block";
  elements.sessionInfoSection.style.display = "block";

  if (session.type === "private") {
    const agent = AGENTS[session.agent];
    elements.sessionInfoBox.innerHTML = `
      <div class="session-member">
        <div class="member-avatar me">M</div>
        <span class="member-name">Me</span>
      </div>
      <div class="session-member">
        <div class="member-avatar ${session.agent}">${session.agent.charAt(0).toUpperCase()}</div>
        <span class="member-name">${agent.name}</span>
      </div>
    `;
  } else {
    let html = `<div class="session-member"><div class="member-avatar me">M</div><span class="member-name">Me</span></div>`;
    session.agents.forEach(agentId => {
      const agent = AGENTS[agentId];
      html += `<div class="session-member"><div class="member-avatar ${agentId}">${agentId.charAt(0).toUpperCase()}</div><span class="member-name">${agent.name}</span></div>`;
    });
    elements.sessionInfoBox.innerHTML = html;
  }

  renderSessionList(sessions, currentSession);
  renderMessages(session.messages || []);
  
  if (!session.messages || session.messages.length === 0) {
    elements.chatMessages.innerHTML = `
      <div class="message-wrapper">
        <div class="message-avatar gateway">G</div>
        <div class="message-content">
          <div class="message-author">Gateway</div>
          <div class="message-text">${session.type === "private" 
            ? `开始与 ${session.name} 私聊` 
            : "群聊已创建，发送话题开始讨论"}</div>
        </div>
      </div>
    `;
  }
}

async function sendMessage(elements) {
  const input = elements.messageInput;
  const text = input.value.trim();
  if (!text) return;

  const session = sessions.find(s => s.id === currentSession);
  if (!session) return;

  input.value = "";

  appendMessage(session, "me", text);
  renderMessages(session.messages);
  scrollToBottom(elements.chatMessages);

  if (session.type === "private") {
    await sendPrivateMessage(session, elements);
  } else {
    await sendGroupMessage(session, elements);
  }
}

async function sendPrivateMessage(session, elements) {
  if (!healthState.ready) {
    appendMessage(session, "gateway", `认证未就绪: ${healthState.message}`);
    renderMessages(session.messages);
    scrollToBottom(elements.chatMessages);
    return;
  }

  elements.sendBtn.disabled = true;

  try {
    const response = await invoke("chat_with_agent", {
      request: {
        agent: session.agent,
        model: session.model,
        message: session.messages.map(m => `${m.from}: ${m.content}`).join("\n"),
      },
    });

    const replyText = response.output_text || "收到回复";
    appendMessage(session, session.agent, replyText);
    renderMessages(session.messages);
    scrollToBottom(elements.chatMessages);
  } catch (err) {
    appendMessage(session, "gateway", `发生错误: ${err}`);
    renderMessages(session.messages);
    scrollToBottom(elements.chatMessages);
  } finally {
    elements.sendBtn.disabled = false;
  }
}

async function sendGroupMessage(session, elements) {
  if (!healthState.ready) {
    appendMessage(session, "gateway", `认证未就绪: ${healthState.message}`);
    renderMessages(session.messages);
    scrollToBottom(elements.chatMessages);
    return;
  }

  const lastUserMessage = session.messages.filter(m => m.from === "me").pop();
  const prompt = lastUserMessage?.content || "";

  elements.sendBtn.disabled = true;
  elements.detailPanel.classList.remove("hidden");
  updateProgress("dispatch", "active", "进行中");

  try {
    const result = await startRun(prompt, {
      store,
      maxRounds: session.rounds,
      providers: {
        codex: {
          provider: ProviderId.TAURI_CODEX,
          model: session.model,
        },
        copilot: {
          provider: ProviderId.TAURI_COPILOT,
          model: session.copilotModel,
        },
      },
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
    
    document.getElementById("summary-box").textContent = result.decision 
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
  const existingIds = session.messages.map(m => m.id);
  
  runMessages.forEach(msg => {
    const id = `run-${msg.createdAt || Date.now()}`;
    if (!existingIds.includes(id)) {
      session.messages.push({
        id,
        from: msg.source.toLowerCase(),
        content: msg.content,
        time: msg.createdAt || Date.now(),
      });
    }
  });
  
  session.lastMessage = runMessages[runMessages.length - 1]?.content?.slice(0, 30) || "讨论中";
  session.lastTime = Date.now();
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
    await authBroker.start(agent);
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

  const container = document.getElementById("chat-messages");
  container.innerHTML = "";

  snapshot.messages?.forEach(msg => {
    const row = document.createElement("div");
    const from = msg.source?.toLowerCase() || "gateway";
    const isSelf = from === "user";
    row.className = `message-wrapper ${isSelf ? "self" : ""}`;
    
    row.innerHTML = `
      <div class="message-avatar ${from}">${from.charAt(0).toUpperCase()}</div>
      <div class="message-content">
        ${!isSelf ? `<div class="message-author">${from}</div>` : ""}
        <div class="message-text">${msg.content}</div>
        <div class="message-time">${formatTime(msg.createdAt)}</div>
      </div>
    `;
    
    container.appendChild(row);
  });

  scrollToBottom(container);
  
  document.getElementById("summary-box").textContent = snapshot.decision
    ? `${snapshot.decision.summary}\n\n${snapshot.decision.rationale}`
    : "历史记录";
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

function formatTime(timestamp) {
  if (!timestamp) return "刚刚";
  const date = new Date(timestamp);
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}