import { createGatewayApiClient, createGatewayEventStream } from "../gateway/http/client.js";

const STORAGE_KEY = "chat_here_mobile_gateway";

let elements = null;
let state = {
  client: null,
  stream: null,
  connected: false,
  threads: [],
  threadSnapshots: new Map(),
  selectedThreadId: "",
  snapshot: null,
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
  elements.gatewayUrl.value = query.baseUrl || saved.baseUrl || defaultGatewayUrl();
  elements.gatewayToken.value = query.token || saved.token || "";
}

function bindEvents() {
  elements.connectBtn.addEventListener("click", connect);
  elements.refreshBtn.addEventListener("click", refreshAll);
  elements.newThreadBtn.addEventListener("click", createThread);
  elements.threadTitle.addEventListener("input", renderThreads);
  elements.sendBtn.addEventListener("click", sendMessage);
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

async function connect() {
  const baseUrl = elements.gatewayUrl.value.trim().replace(/\/+$/, "");
  const token = elements.gatewayToken.value.trim();
  if (!baseUrl || !token) {
    setNote("Gateway URL and token are required.");
    return;
  }

  closeStream();
  state.client = createGatewayApiClient({ baseUrl, token });
  setBusy(true);
  try {
    await state.client.listThreads();
    saveConfig({ baseUrl, token });
    state.connected = true;
    openEventStream(baseUrl, token);
    await refreshAll();
    setNote("Connected. Threads and messages are live.");
  } catch (error) {
    state.connected = false;
    setNote(`Connect failed: ${getErrorMessage(error)}`);
  } finally {
    setBusy(false);
    render();
  }
}

async function refreshAll() {
  if (!state.client) {
    setNote("Connect to a Gateway first.");
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
    setNote(`Refresh failed: ${getErrorMessage(error)}`);
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
  if (!state.threads.length) {
    state.selectedThreadId = "";
    return;
  }
  if (state.threads.some((thread) => thread.id === state.selectedThreadId)) {
    return;
  }
  const firstActive = state.threads.find((thread) => {
    const snapshot = state.threadSnapshots.get(thread.id);
    return snapshot?.messages?.length;
  });
  state.selectedThreadId = firstActive?.id ?? state.threads[0].id;
}

async function createThread() {
  if (!state.client) {
    setNote("Connect to a Gateway first.");
    return;
  }
  const title = elements.threadTitle.value.trim() || "Mobile discussion";
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
    setNote(`Create room failed: ${getErrorMessage(error)}`);
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
    setNote(`Load room failed: ${getErrorMessage(error)}`);
  }
  render();
}

async function sendMessage() {
  const content = elements.messageInput.value.trim();
  if (!state.client || !state.selectedThreadId || !content) {
    return;
  }
  elements.sendBtn.disabled = true;
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
    setNote(`Send failed: ${getErrorMessage(error)}`);
  } finally {
    elements.sendBtn.disabled = false;
  }
}

function openEventStream(baseUrl, token) {
  try {
    state.stream = createGatewayEventStream({ baseUrl, token });
    state.stream.addEventListener("message.created", refreshAfterEvent);
    state.stream.addEventListener("thread.created", refreshAfterEvent);
    state.stream.addEventListener("gateway.connected", () => setNote("Live stream connected."));
    state.stream.onerror = () => setNote("Live stream disconnected. Manual refresh still works.");
  } catch (error) {
    setNote(`Live stream unavailable: ${getErrorMessage(error)}`);
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
}

function render() {
  document.getElementById("mobile-app")?.classList.toggle("connected", state.connected);
  elements.status.textContent = state.connected ? "online" : "offline";
  elements.status.classList.toggle("online", state.connected);
  renderThreads();
  renderSnapshot();
}

function renderThreads() {
  elements.threadList.innerHTML = "";
  if (!state.threads.length) {
    elements.threadList.append(createEmpty("No rooms yet."));
    return;
  }

  const filter = elements.threadTitle.value.trim().toLowerCase();
  const visibleThreads = filter
    ? state.threads.filter((thread) => {
        const snapshot = state.threadSnapshots.get(thread.id);
        const lastMessage = snapshot?.messages?.at(-1);
        return (
          thread.title.toLowerCase().includes(filter) ||
          (lastMessage?.content ?? "").toLowerCase().includes(filter)
        );
      })
    : state.threads;

  if (!visibleThreads.length) {
    elements.threadList.append(createEmpty("没有匹配会话，点 + 可新建。"));
    return;
  }

  for (const thread of visibleThreads) {
    const snapshot = state.threadSnapshots.get(thread.id);
    const lastMessage = snapshot?.messages?.at(-1) ?? null;
    const item = document.createElement("button");
    item.type = "button";
    item.className = `mobile-thread-item${thread.id === state.selectedThreadId ? " active" : ""}`;
    item.dataset.threadId = thread.id;
    const title = document.createElement("span");
    title.className = "mobile-thread-title";
    title.textContent = thread.title;
    const preview = document.createElement("span");
    preview.className = "mobile-thread-preview";
    preview.textContent = lastMessage ? compactText(lastMessage.content, 34) : "暂无消息";
    const meta = document.createElement("small");
    meta.textContent = formatTime(thread.updatedAt);
    item.append(title, preview, meta);
    elements.threadList.append(item);
  }
}

function renderSnapshot() {
  const thread = state.snapshot?.thread ?? null;
  const messages = state.snapshot?.messages ?? [];
  elements.threadName.textContent = thread?.title ?? "No room selected";
  elements.threadMeta.textContent = thread
    ? `${messages.length} messages · ${formatTime(thread.updatedAt)}`
    : "Connect first.";

  elements.messageList.innerHTML = "";
  if (!messages.length) {
    elements.messageList.append(createEmpty(thread ? "No messages yet." : "Select a room to read messages."));
    return;
  }

  for (const message of messages) {
    const row = document.createElement("article");
    row.className = `mobile-message ${message.source?.type ?? "system"}`;
    const meta = document.createElement("div");
    meta.className = "mobile-message-meta";
    meta.textContent = `${message.source?.name ?? message.source?.id ?? "Unknown"} · ${message.kind} · ${formatTime(message.createdAt)}`;
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
  elements.connectBtn.disabled = busy;
  elements.refreshBtn.disabled = busy;
  elements.newThreadBtn.disabled = busy;
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

function compactText(value, maxLength) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
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
