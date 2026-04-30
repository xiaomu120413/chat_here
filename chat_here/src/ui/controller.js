import { startRun } from "../gateway/orchestrator/index.js";
import { ProviderId } from "../gateway/adapters/config.js";
import { createTauriOpenAIHealthClient, normalizeHealthResult } from "../gateway/adapters/tauriOpenAIHealth.js";
import { AuthAgent, createTauriAuthBroker } from "../gateway/auth/tauriAuthBroker.js";
import { CODEX_MODELS, COPILOT_MODELS, DEFAULT_CODEX_MODEL, DEFAULT_COPILOT_MODEL } from "../gateway/models.js";
import { createLocalStorageStore } from "../gateway/store/localStorageStore.js";
import { invoke } from "@tauri-apps/api/core";

const store = createLocalStorageStore();
const healthClient = createTauriOpenAIHealthClient();
const authBroker = createTauriAuthBroker();

const AGENTS = {
  codex: { name: "Codex", model: DEFAULT_CODEX_MODEL },
  copilot: { name: "Copilot", model: DEFAULT_COPILOT_MODEL },
};

let sessions = [];
let currentSession = null;
let healthState = { ready: false };

export function initGatewayController() {
  const el = {
    sessionList: document.getElementById("session-list"),
    contactsList: document.getElementById("contacts-list"),
    chatMessages: document.getElementById("chat-messages"),
    headerTitle: document.getElementById("header-title"),
    messageInput: document.getElementById("message-input"),
    sendBtn: document.getElementById("send-btn"),
    detailPanel: document.getElementById("detail-panel"),
    memberInfoBox: document.getElementById("member-info-box"),
    dissolveBtn: document.getElementById("dissolve-btn"),
    historyList: document.getElementById("history-list"),
    summaryBox: document.getElementById("summary-box"),
    progressSection: document.getElementById("progress-section"),
    configPanel: document.getElementById("config-panel"),
    modalOverlay: document.getElementById("modal-overlay"),
    groupNameInput: document.getElementById("group-name-input"),
    modelInput: document.getElementById("model-input"),
    copilotModelInput: document.getElementById("copilot-model-input"),
    roundInput: document.getElementById("round-input"),
  };

  el.modelInput.innerHTML = CODEX_MODELS.map(m => `<option value="${m.id}" ${m.id === DEFAULT_CODEX_MODEL ? 'selected' : ''}>${m.label}</option>`).join('');
  el.copilotModelInput.innerHTML = COPILOT_MODELS.map(m => `<option value="${m.id}" ${m.id === DEFAULT_COPILOT_MODEL ? 'selected' : ''}>${m.label}</option>`).join('');

  el.sessionList.onclick = e => {
    const del = e.target.closest(".session-delete");
    if (del) { deleteSession(del.closest(".session-item").dataset.id); return; }
    const item = e.target.closest(".session-item");
    if (item) switchSession(item.dataset.id);
  };

  el.contactsList.onclick = e => {
    const item = e.target.closest(".contact-item");
    if (item) createPrivateChat(item.dataset.id);
  };

  el.sendBtn.onclick = () => sendMessage(el);
  el.messageInput.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(el); } };

  document.getElementById("create-btn").onclick = () => el.modalOverlay.classList.remove("hidden");
  document.getElementById("modal-close").onclick = () => el.modalOverlay.classList.add("hidden");
  document.getElementById("create-cancel").onclick = () => el.modalOverlay.classList.add("hidden");
  document.getElementById("create-confirm").onclick = () => createGroup(el);

  document.getElementById("show-config").onclick = () => el.configPanel.classList.toggle("hidden");
  document.getElementById("detail-close").onclick = () => el.detailPanel.classList.add("hidden");
  el.dissolveBtn.onclick = () => { if (currentSession) deleteSession(currentSession); };

  document.getElementById("codex-auth-btn").onclick = () => startAuth(AuthAgent.CODEX);
  document.getElementById("copilot-auth-btn").onclick = () => startAuth(AuthAgent.COPILOT);

  el.historyList.onclick = e => {
    const item = e.target.closest(".history-item");
    if (item) loadHistoryRun(item.dataset.id, el);
  };

  checkHealth();
  loadHistory(el);
  renderWelcome(el);
}

function renderWelcome(el) {
  el.headerTitle.textContent = "Chat Here";
  el.chatMessages.innerHTML = `<div class="message-wrapper"><div class="message-avatar gateway">G</div><div class="message-content">欢迎！点击左侧联系人开始私聊，或点击"+"创建群聊</div></div>`;
  el.detailPanel.classList.add("hidden");
  renderSessions();
}

function renderSessions() {
  const list = document.getElementById("session-list");
  list.innerHTML = sessions.map(s => `
    <div class="session-item ${s.id === currentSession ? 'active' : ''}" data-id="${s.id}">
      <div class="session-avatar ${s.type === 'group' ? 'group' : s.agent}">${s.type === 'group' ? '群' : s.agent.charAt(0).toUpperCase()}</div>
      <span class="session-name">${s.name}</span>
      <button class="session-delete">×</button>
    </div>
  `).join('');
}

function createPrivateChat(agentId) {
  const existing = sessions.find(s => s.type === "private" && s.agent === agentId);
  if (existing) { switchSession(existing.id); return; }
  
  const agent = AGENTS[agentId];
  sessions.unshift({ id: `p-${agentId}-${Date.now()}`, type: "private", name: agent.name, agent: agentId, model: agent.model, messages: [] });
  renderSessions();
  switchSession(sessions[0].id);
}

function createGroup(el) {
  const name = el.groupNameInput.value.trim();
  if (!name) return;
  
  const agents = [...document.querySelectorAll(".member-checkbox-list input:checked")].map(c => c.value);
  sessions.unshift({ id: `g-${Date.now()}`, type: "group", name, agents, model: el.modelInput.value, copilotModel: el.copilotModelInput.value, rounds: +el.roundInput.value || 1, messages: [] });
  
  el.modalOverlay.classList.add("hidden");
  renderSessions();
  switchSession(sessions[0].id);
}

function switchSession(id) {
  currentSession = id;
  const s = sessions.find(x => x.id === id);
  if (!s) return;

  const el = {
    headerTitle: document.getElementById("header-title"),
    chatMessages: document.getElementById("chat-messages"),
    detailPanel: document.getElementById("detail-panel"),
    memberInfoBox: document.getElementById("member-info-box"),
    dissolveBtn: document.getElementById("dissolve-btn"),
    progressSection: document.getElementById("progress-section"),
  };

  el.headerTitle.textContent = s.name;
  el.dissolveBtn.textContent = s.type === "group" ? "解散群聊" : "删除私聊";
  
  let membersHtml = `<div class="member-row"><div class="message-avatar me">M</div><span>Me</span></div>`;
  if (s.type === "private") {
    membersHtml += `<div class="member-row"><div class="message-avatar ${s.agent}">${s.agent.charAt(0).toUpperCase()}</div><span>${AGENTS[s.agent].name}</span></div>`;
    el.progressSection.style.display = "none";
  } else {
    s.agents.forEach(a => membersHtml += `<div class="member-row"><div class="message-avatar ${a}">${a.charAt(0).toUpperCase()}</div><span>${AGENTS[a].name}</span></div>`);
    el.progressSection.style.display = "block";
  }
  el.memberInfoBox.innerHTML = membersHtml;

  el.chatMessages.innerHTML = s.messages.length ? "" : `<div class="message-wrapper"><div class="message-avatar gateway">G</div><div class="message-content">${s.type === "private" ? `开始与${s.name}私聊` : "群聊已创建，发送话题开始讨论"}</div></div>`;
  s.messages.forEach(m => el.chatMessages.appendChild(createMsg(m)));

  el.detailPanel.classList.remove("hidden");
  renderSessions();
}

function deleteSession(id) {
  sessions = sessions.filter(s => s.id !== id);
  if (currentSession === id) { currentSession = null; renderWelcome({ headerTitle: document.getElementById("header-title"), chatMessages: document.getElementById("chat-messages"), detailPanel: document.getElementById("detail-panel") }); }
  renderSessions();
}

async function sendMessage(el) {
  const text = el.messageInput.value.trim();
  if (!text || !currentSession) return;
  
  const s = sessions.find(x => x.id === currentSession);
  el.messageInput.value = "";
  
  s.messages.push({ from: "me", content: text, time: Date.now() });
  el.chatMessages.appendChild(createMsg(s.messages[s.messages.length - 1]));
  
  if (s.type === "private") {
    if (!healthState.ready) { showReply(s, "认证未就绪"); return; }
    el.sendBtn.disabled = true;
    try {
      const res = await invoke("chat_with_agent", { request: { agent: s.agent, model: s.model, message: s.messages.map(m => `${m.from}: ${m.content}`).join("\n") } });
      showReply(s, res.output_text || "收到回复");
    } catch (e) { showReply(s, `错误: ${e}`); }
    el.sendBtn.disabled = false;
  } else {
    if (!healthState.ready) { showReply(s, "认证未就绪"); return; }
    el.sendBtn.disabled = true;
    setProgress("dispatch", "active");
    try {
      const result = await startRun(text, { store, maxRounds: s.rounds, providers: { codex: { provider: ProviderId.TAURI_CODEX, model: s.model }, copilot: { provider: ProviderId.TAURI_COPILOT, model: s.copilotModel } }, onUpdate: p => { syncMsgs(s, p.messages); refreshChat(s); updateProgress(p.run); } });
      syncMsgs(s, result.messages);
      refreshChat(s);
      setProgress("dispatch", "done"); setProgress("review", "done"); setProgress("decision", "done");
      el.summaryBox.textContent = result.decision ? `${result.decision.summary}\n\n${result.decision.rationale}` : "完成";
      loadHistory(el);
    } catch (e) { showReply(s, `错误: ${e.message}`); }
    el.sendBtn.disabled = false;
  }
}

function showReply(s, text) {
  s.messages.push({ from: s.agent || "gateway", content: text, time: Date.now() });
  document.getElementById("chat-messages").appendChild(createMsg(s.messages[s.messages.length - 1]));
}

function syncMsgs(s, msgs) {
  msgs.forEach(m => {
    if (!s.messages.find(x => x.time === (m.createdAt || Date.now()))) {
      s.messages.push({ from: m.source.toLowerCase(), content: m.content, time: m.createdAt || Date.now() });
    }
  });
}

function refreshChat(s) {
  const el = document.getElementById("chat-messages");
  el.innerHTML = "";
  s.messages.forEach(m => el.appendChild(createMsg(m)));
}

function createMsg(m) {
  const div = document.createElement("div");
  div.className = `message-wrapper ${m.from === "me" ? "self" : ""}`;
  div.innerHTML = `<div class="message-avatar ${m.from === "me" ? "me" : m.from}">${m.from === "me" ? "M" : m.from.charAt(0).toUpperCase()}</div><div class="message-content">${m.content}</div>`;
  return div;
}

function setProgress(id, state) {
  const el = document.getElementById(`progress-${id}`);
  el.className = `progress-item ${state}`;
  el.querySelector(".progress-status").textContent = state === "done" ? "完成" : state === "active" ? "进行中" : "等待";
}

function updateProgress(run) {
  if (run.status === "COMPLETED") { setProgress("dispatch", "done"); setProgress("review", "done"); setProgress("decision", "done"); }
  else if (run.currentStep?.includes("CODEX")) { setProgress("dispatch", "done"); setProgress("review", "active"); }
  else if (run.currentStep?.includes("COPILOT")) { setProgress("dispatch", "done"); setProgress("review", "active"); }
}

async function checkHealth() {
  try {
    const r = normalizeHealthResult(await healthClient.check());
    healthState.ready = r.agents.codex.ready && r.agents.copilot.ready;
    document.getElementById("provider-health").textContent = healthState.ready ? "认证就绪" : "未认证";
  } catch (e) { document.getElementById("provider-health").textContent = "检查失败"; }
}

async function startAuth(agent) { await authBroker.start(agent); checkHealth(); }

async function loadHistory(el) {
  const runs = await store.listRuns();
  const snaps = await Promise.all(runs.slice(0, 10).map(r => store.getRun(r.id)));
  el.historyList.innerHTML = snaps.filter(Boolean).map(s => `<div class="history-item" data-id="${s.run.id}">${truncate(s.task?.prompt || s.run.id, 30)}</div>`).join("") || "<div class='history-item'>暂无历史</div>";
}

async function loadHistoryRun(id, el) {
  const snap = await store.getRun(id);
  if (!snap) return;
  el.chatMessages.innerHTML = "";
  snap.messages?.forEach(m => el.chatMessages.appendChild(createMsg({ from: m.source.toLowerCase(), content: m.content })));
  el.summaryBox.textContent = snap.decision ? `${snap.decision.summary}\n\n${snap.decision.rationale}` : "历史记录";
}

function truncate(t, n) { return t?.length > n ? t.slice(0, n) + "..." : t || ""; }