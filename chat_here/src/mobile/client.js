import { createGatewayApiClient, createGatewayEventStream } from "../gateway/http/client.js";
import {
  canSendMobileMessage,
  chooseSelectedThreadId,
  filterThreads,
  getMobileConnectionLabel,
  getMobileSendDisabledReason,
  getThreadPreview,
} from "./threadViewModel.js";
import { createSanitizedMobileUrl } from "./urlSecurity.js";

const STORAGE_KEY = "chat_here_mobile_gateway";

let elements = null;
let state = {
  client: null,
  stream: null,
  connected: false,
  liveConnected: false,
  threads: [],
  threadSnapshots: new Map(),
  selectedThreadId: "",
  snapshot: null,
  busy: false,
  sendingMessage: false,
};

export function shouldUseMobileGatewayClient() {
  const params = new URLSearchParams(window.location.search);
  return params.get("mobile") === "1" || window.location.hash === "#mobile";
}

export function initMobileGatewayClient() {
  document.body.classList.add("mobile-client-mode");
  document.getElementById("im-app")?.classList.add("hidden");
  document.getElementById("mobile-app")?.classList.remove("hidden");

  elements = collectElements();
  restoreConfig();
  bindEvents();
  render();
  if (elements.gatewayUrl.value.trim() && elements.gatewayToken.value.trim()) {
    void connect();
  }
}

function collectElements() {
  return {
    status: document.getElementById("mobile-status"),
    note: document.getElementById("mobile-note"),
    gatewayUrl: document.getElementById("mobile-gateway-url"),
    gatewayToken: document.getElementById("mobile-gateway-token"),
    connectBtn: document.getElementById("mobile-connect-btn"),
    disconnectBtn: document.getElementById("mobile-disconnect-btn"),
    refreshBtn: document.getElementById("mobile-refresh-btn"),
    newThreadBtn: document.getElementById("mobile-new-thread-btn"),
    threadTitle: document.getElementById("mobile-thread-title"),
    threadList: document.getElementById("mobile-thread-list"),
    threadName: document.getElementById("mobile-thread-name"),
    threadMeta: document.getElementById("mobile-thread-meta"),
    messageList: document.getElementById("mobile-message-list"),
    messageInput: document.getElementById("mobile-message-input"),
    sendBtn: document.getElementById("mobile-send-btn"),
  };
}

function restoreConfig() {
  const saved = readSavedConfig();
  const query = readQueryConfig();
  const config = {
    baseUrl: query.baseUrl || saved.baseUrl || defaultGatewayUrl(),
    token: query.token || saved.token || "",
  };
  elements.gatewayUrl.value = config.baseUrl;
  elements.gatewayToken.value = config.token;
  if (query.token) {
    saveConfig(config);
    sanitizeCurrentUrl();
  }
}

function bindEvents() {
  elements.connectBtn.addEventListener("click", connect);
  elements.disconnectBtn.addEventListener("click", disconnect);
  elements.refreshBtn.addEventListener("click", refreshAll);
  elements.newThreadBtn.addEventListener("click", createThread);
  elements.threadTitle.addEventListener("input", renderThreads);
  elements.sendBtn.addEventListener("click", sendMessage);
  elements.messageInput.addEventListener("input", renderControls);
  elements.messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
  elements.threadList.addEventListener("click", async (event) => {
    const item = event.target.closest("[data-thread-id]");
    if (!item) {
      return;
    }
    state.selectedThreadId = item.dataset.threadId;
    await loadSelectedThread();
  });
}

function disconnect() {
  closeStream();
  state.client = null;
  state.connected = false;
  state.liveConnected = false;
  state.threads = [];
  state.threadSnapshots = new Map();
  state.selectedThreadId = "";
  state.snapshot = null;
  state.sendingMessage = false;
  localStorage.removeItem(STORAGE_KEY);
  elements.gatewayToken.value = "";
  setNote("已断开，并清除本机保存的连接凭据。");
  render();
}

async function connect() {
  const baseUrl = elements.gatewayUrl.value.trim().replace(/\/+$/, "");
  const token = elements.gatewayToken.value.trim();
  if (!baseUrl || !token) {
    setNote("需要填写 Gateway URL 和 Token。");
    return;
  }

  closeStream();
  state.liveConnected = false;
  state.client = createGatewayApiClient({ baseUrl, token });
  setBusy(true);
  try {
    await state.client.listThreads();
    saveConfig({ baseUrl, token });
    state.connected = true;
    openEventStream(baseUrl, token);
    await refreshAll();
    setNote("已连接，消息会实时同步。");
  } catch (error) {
    state.connected = false;
    state.liveConnected = false;
    state.client = null;
    setNote(`连接失败：${getErrorMessage(error)}`);
  } finally {
    setBusy(false);
    render();
  }
}

async function refreshAll() {
  if (!state.client) {
    setNote("请先连接 Gateway。");
    return;
  }
  setBusy(true);
  try {
    const listed = await state.client.listThreads();
    state.threads = listed.threads ?? [];
    await refreshThreadPreviews();
    chooseSelectedThread();
    await loadSelectedThread();
  } catch (error) {
    setNote(`刷新失败：${getErrorMessage(error)}`);
  } finally {
    setBusy(false);
    render();
  }
}

async function refreshThreadPreviews() {
  if (!state.client) {
    state.threadSnapshots = new Map();
    return;
  }
  const pairs = await Promise.all(
    state.threads.slice(0, 20).map(async (thread) => {
      try {
        return [thread.id, await state.client.getThread(thread.id)];
      } catch {
        return [thread.id, null];
      }
    }),
  );
  state.threadSnapshots = new Map(pairs.filter(([, snapshot]) => snapshot));
}

function chooseSelectedThread() {
  state.selectedThreadId = chooseSelectedThreadId(state.threads, state.threadSnapshots, state.selectedThreadId);
}

async function createThread() {
  if (!state.client) {
    setNote("请先连接 Gateway。");
    return;
  }
  const title = elements.threadTitle.value.trim() || "移动端讨论";
  setBusy(true);
  try {
    const created = await state.client.createThread({
      title,
      createdBy: { type: "human", id: "mobile", name: "Mobile" },
      metadata: { source: "mobile" },
    });
    elements.threadTitle.value = "";
    state.selectedThreadId = created.thread.id;
    await refreshAll();
  } catch (error) {
    setNote(`创建会话失败：${getErrorMessage(error)}`);
  } finally {
    setBusy(false);
  }
}

async function loadSelectedThread() {
  if (!state.client || !state.selectedThreadId) {
    state.snapshot = null;
    render();
    return;
  }
  try {
    state.snapshot = await state.client.getThread(state.selectedThreadId);
  } catch (error) {
    setNote(`加载会话失败：${getErrorMessage(error)}`);
  }
  render();
}

async function sendMessage() {
  const content = elements.messageInput.value.trim();
  const disabledReason = getMobileSendDisabledReason({
    connected: state.connected,
    selectedThreadId: state.selectedThreadId,
    content,
    sending: state.sendingMessage,
  });
  if (disabledReason) {
    setNote(disabledReason);
    return;
  }
  state.sendingMessage = true;
  renderControls();
  try {
    await state.client.sendMessage(state.selectedThreadId, {
      kind: "user",
      source: { type: "human", id: "mobile", name: "Mobile" },
      content,
      targetAgents: inferTargets(content),
      dispatch: false,
    });
    elements.messageInput.value = "";
    await loadSelectedThread();
  } catch (error) {
    setNote(`发送失败：${getErrorMessage(error)}`);
  } finally {
    state.sendingMessage = false;
    render();
  }
}

function openEventStream(baseUrl, token) {
  try {
    state.stream = createGatewayEventStream({ baseUrl, token });
    state.stream.addEventListener("message.created", refreshAfterEvent);
    state.stream.addEventListener("thread.created", refreshAfterEvent);
    state.stream.addEventListener("gateway.connected", () => {
      state.liveConnected = true;
      setNote("实时通道已连接。");
      render();
    });
    state.stream.onerror = () => {
      state.liveConnected = false;
      setNote("实时通道已断开，可手动刷新。");
      render();
    };
  } catch (error) {
    setNote(`实时通道不可用：${getErrorMessage(error)}`);
  }
}

function refreshAfterEvent(event) {
  try {
    const record = JSON.parse(event.data);
    if (!state.selectedThreadId || record.threadId === state.selectedThreadId || record.type === "thread.created") {
      void refreshAll();
    }
  } catch {
    void refreshAll();
  }
}

function closeStream() {
  if (state.stream) {
    state.stream.close();
    state.stream = null;
  }
  state.liveConnected = false;
}

function render() {
  document.getElementById("mobile-app")?.classList.toggle("connected", state.connected);
  elements.status.textContent = getMobileConnectionLabel(state);
  elements.status.classList.toggle("online", state.connected);
  renderThreads();
  renderSnapshot();
  renderControls();
}

function renderThreads() {
  elements.threadList.innerHTML = "";
  if (!state.threads.length) {
    elements.threadList.append(createEmpty("还没有会话。"));
    return;
  }

  const visibleThreads = filterThreads(state.threads, state.threadSnapshots, elements.threadTitle.value);

  if (!visibleThreads.length) {
    elements.threadList.append(createEmpty("没有匹配会话，点 + 可新建。"));
    return;
  }

  for (const thread of visibleThreads) {
    const snapshot = state.threadSnapshots.get(thread.id);
    const item = document.createElement("button");
    item.type = "button";
    item.className = `mobile-thread-item${thread.id === state.selectedThreadId ? " active" : ""}`;
    item.dataset.threadId = thread.id;
    const title = document.createElement("span");
    title.className = "mobile-thread-title";
    title.textContent = thread.title;
    const preview = document.createElement("span");
    preview.className = "mobile-thread-preview";
    preview.textContent = getThreadPreview(thread, snapshot);
    const meta = document.createElement("small");
    meta.textContent = formatTime(thread.updatedAt);
    item.append(title, preview, meta);
    elements.threadList.append(item);
  }
}

function renderSnapshot() {
  const thread = state.snapshot?.thread ?? null;
  const messages = state.snapshot?.messages ?? [];
  elements.threadName.textContent = thread?.title ?? "未选择会话";
  elements.threadMeta.textContent = thread
    ? `${messages.length} 条消息 · ${formatTime(thread.updatedAt)}`
    : "请先连接。";

  elements.messageList.innerHTML = "";
  if (!messages.length) {
    elements.messageList.append(createEmpty(thread ? "还没有消息。" : "选择一个会话查看消息。"));
    return;
  }

  for (const message of messages) {
    const row = document.createElement("article");
    row.className = `mobile-message ${message.source?.type ?? "system"}`;
    const meta = document.createElement("div");
    meta.className = "mobile-message-meta";
    meta.textContent = `${message.source?.name ?? message.source?.id ?? "未知"} · ${message.kind} · ${formatTime(message.createdAt)}`;
    const body = document.createElement("div");
    body.className = "mobile-message-body";
    body.textContent = message.content;
    row.append(meta, body);
    elements.messageList.append(row);
  }
  elements.messageList.scrollTop = elements.messageList.scrollHeight;
}

function createEmpty(text) {
  const empty = document.createElement("div");
  empty.className = "mobile-empty";
  empty.textContent = text;
  return empty;
}

function setBusy(busy) {
  state.busy = busy;
  renderControls();
}

function renderControls() {
  elements.connectBtn.disabled = state.busy;
  elements.disconnectBtn.disabled = state.busy || (!state.connected && !elements.gatewayToken.value.trim());
  elements.refreshBtn.disabled = state.busy || !state.connected;
  elements.newThreadBtn.disabled = state.busy || !state.connected;
  elements.sendBtn.disabled = !canSendMobileMessage({
    connected: state.connected,
    selectedThreadId: state.selectedThreadId,
    content: elements.messageInput.value,
    sending: state.busy || state.sendingMessage,
  });
}

function setNote(text) {
  elements.note.textContent = text;
}

function inferTargets(content) {
  const normalized = content.toLowerCase();
  const targets = [];
  if (normalized.includes("@codex") || normalized.includes("@all")) {
    targets.push("codex");
  }
  if (normalized.includes("@copilot") || normalized.includes("@all")) {
    targets.push("copilot");
  }
  return targets;
}

function defaultGatewayUrl() {
  const host = window.location.hostname || "127.0.0.1";
  return `http://${host}:17321`;
}

function readSavedConfig() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function readQueryConfig() {
  const params = new URLSearchParams(window.location.search);
  return {
    baseUrl: params.get("gateway") || params.get("gatewayUrl") || "",
    token: params.get("token") || "",
  };
}

function sanitizeCurrentUrl() {
  const nextUrl = createSanitizedMobileUrl(window.location.href);
  if (nextUrl !== window.location.href) {
    window.history.replaceState(null, "", nextUrl);
  }
}

function saveConfig(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

function formatTime(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function getErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (error && typeof error === "object" && typeof error.message === "string") {
    return error.message;
  }
  return String(error || "unknown error");
}
