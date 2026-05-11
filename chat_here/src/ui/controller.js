import { startRun } from "../gateway/orchestrator/index.js";
import { createCancelToken } from "../gateway/orchestrator/runner.js";
import { ProviderId } from "../gateway/adapters/config.js";
import { createTauriOpenAIHealthClient, normalizeHealthResult } from "../gateway/adapters/tauriOpenAIHealth.js";
import { AuthAgent, createTauriAuthBroker } from "../gateway/auth/tauriAuthBroker.js";
import { createGatewayApiClient, createGatewayEventStream } from "../gateway/http/client.js";
import {
  CODEX_MODELS,
  COPILOT_MODELS,
  DEFAULT_CODEX_MODEL,
  DEFAULT_COPILOT_MODEL,
} from "../gateway/models.js";
import { createLocalStorageStore } from "../gateway/store/localStorageStore.js";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  getErrorMessage,
  renderHistory,
  renderMemberList,
  renderMessages,
  renderSessionList,
  scrollToBottom,
  updateProgress,
} from "./render.js";
import { maskSecret } from "./gatewaySecurity.js";
import { restoreSessionState, serializeSessionState } from "./sessionPersistence.js";

const store = createLocalStorageStore();
const SESSION_STORAGE_KEY = "chat_here_sessions_v1";
const healthClient = createTauriOpenAIHealthClient();
const authBroker = createTauriAuthBroker();
const isTauriRuntime = Boolean(window.__TAURI_INTERNALS__);
const appWindow = isTauriRuntime ? getCurrentWindow() : null;
document.body.classList.toggle("tauri-runtime", isTauriRuntime);
document.body.classList.toggle("browser-preview-runtime", !isTauriRuntime);

const MEMBERS = Object.freeze([
  { id: "me", name: "Me", role: "发起人", short: "M" },
  { id: "codex", name: "Codex", role: "实现与推进", short: "C" },
  { id: "copilot", name: "Copilot", role: "挑战与补充", short: "P" },
  { id: "gateway", name: "Gateway", role: "调度与总结", short: "G" },
]);

let elements = null;
let sessions = [];
let currentSessionId = "";
let searchQuery = "";
let historyRecords = [];
let healthState = {
  codexReady: false,
  copilotReady: false,
  checkedAt: null,
};
let gatewayState = {
  status: null,
  client: null,
  stream: null,
  streamUrl: "",
};

export function initGatewayController() {
  elements = collectElements();
  populateModels();
  bindEvents();
  bootstrapSessions();
  refreshHistory();
  if (isTauriRuntime) {
    refreshHealth();
    refreshGatewayStatus();
  } else {
    healthState = {
      codexReady: false,
      copilotReady: false,
      checkedAt: new Date().toISOString(),
    };
    renderBrowserPreviewMode();
  }
  renderApp();
}

function collectElements() {
  return {
    sessionList: document.getElementById("session-list"),
    sessionSearch: document.getElementById("session-search"),
    chatMessages: document.getElementById("chat-messages"),
    headerTitle: document.getElementById("header-title"),
    headerMeta: document.getElementById("header-meta"),
    providerHealth: document.getElementById("provider-health"),
    messageInput: document.getElementById("message-input"),
    sendBtn: document.getElementById("send-btn"),
    detailPanel: document.getElementById("detail-panel"),
    shell: document.getElementById("im-app"),
    railSessions: document.getElementById("rail-sessions"),
    railMembers: document.getElementById("rail-members"),
    railSelfTest: document.getElementById("rail-self-test"),
    memberInfoBox: document.getElementById("member-info-box"),
    summaryBox: document.getElementById("summary-box"),
    cancelRunBtn: document.getElementById("cancel-run-btn"),
    progressSection: document.getElementById("progress-section"),
    historyList: document.getElementById("history-list"),
    modelInput: document.getElementById("model-input"),
    copilotModelInput: document.getElementById("copilot-model-input"),
    roundInput: document.getElementById("round-input"),
    modalOverlay: document.getElementById("modal-overlay"),
    groupNameInput: document.getElementById("group-name-input"),
    dissolveBtn: document.getElementById("dissolve-btn"),
    selfTestBtn: document.getElementById("self-test-btn"),
    toggleInfo: document.getElementById("toggle-info"),
    detailClose: document.getElementById("detail-close"),
    gatewayStatusBox: document.getElementById("gateway-status-box"),
    gatewayLocalBtn: document.getElementById("gateway-local-btn"),
    gatewayLanBtn: document.getElementById("gateway-lan-btn"),
    gatewayCopyMobileBtn: document.getElementById("gateway-copy-mobile-btn"),
    gatewayStopBtn: document.getElementById("gateway-stop-btn"),
  };
}

function bindEvents() {
  elements.sessionList.addEventListener("click", handleSessionListClick);
  elements.sessionSearch.addEventListener("input", (event) => {
    searchQuery = event.target.value;
    renderSessionList(elements.sessionList, sessions, currentSessionId, searchQuery);
  });
  elements.sendBtn.addEventListener("click", submitTopic);
  elements.messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitTopic();
    }
  });
  document.getElementById("create-btn").addEventListener("click", () => {
    elements.groupNameInput.value = "";
    elements.modalOverlay.classList.remove("hidden");
  });
  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("create-cancel").addEventListener("click", closeModal);
  document.getElementById("create-confirm").addEventListener("click", createGroupSession);
  document.getElementById("codex-auth-btn").addEventListener("click", () => startAuth(AuthAgent.CODEX));
  document.getElementById("copilot-auth-btn").addEventListener("click", () => startAuth(AuthAgent.COPILOT));
  elements.selfTestBtn.addEventListener("click", runSelfTest);
  elements.cancelRunBtn.addEventListener("click", cancelCurrentRun);
  elements.historyList.addEventListener("click", handleHistoryClick);
  elements.dissolveBtn.addEventListener("click", deleteCurrentSession);
  elements.toggleInfo.addEventListener("click", () => elements.detailPanel.classList.toggle("open"));
  elements.detailClose.addEventListener("click", () => elements.detailPanel.classList.remove("open"));
  elements.railSessions.addEventListener("click", toggleSessionList);
  elements.railMembers.addEventListener("click", () => {
    elements.shell.classList.remove("show-session-list");
    elements.detailPanel.classList.toggle("open");
  });
  elements.railSelfTest.addEventListener("click", runSelfTest);
  document.querySelectorAll(".mention-tool").forEach((button) => {
    button.addEventListener("click", () => insertComposerText(button.dataset.insert ?? ""));
  });
  elements.gatewayLocalBtn.addEventListener("click", () => startGateway(false));
  elements.gatewayLanBtn.addEventListener("click", () => startGateway(true));
  elements.gatewayCopyMobileBtn.addEventListener("click", copyMobileEntry);
  elements.gatewayStopBtn.addEventListener("click", stopGateway);
  bindWindowControls();
  syncRuntimeOnlyControls();
  elements.modelInput.addEventListener("change", syncCurrentSessionConfig);
  elements.copilotModelInput.addEventListener("change", syncCurrentSessionConfig);
  elements.roundInput.addEventListener("change", syncCurrentSessionConfig);
}

function bindWindowControls() {
  document.getElementById("window-minimize-btn")?.addEventListener("click", () => appWindow?.minimize());
  document.getElementById("window-maximize-btn")?.addEventListener("click", () => appWindow?.toggleMaximize());
  document.getElementById("window-close-btn")?.addEventListener("click", () => appWindow?.close());
}

function bootstrapSessions() {
  const restored = restoreSessionState(localStorage.getItem(SESSION_STORAGE_KEY), {
    members: MEMBERS,
    createFallbackSession: () => createSession("Architecture Room"),
  });
  sessions = restored.sessions;
  currentSessionId = restored.currentSessionId;
}

function populateModels() {
  elements.modelInput.innerHTML = CODEX_MODELS.map(createOptionHtml(DEFAULT_CODEX_MODEL)).join("");
  elements.copilotModelInput.innerHTML = COPILOT_MODELS.map(createOptionHtml(DEFAULT_COPILOT_MODEL)).join("");
}

function createOptionHtml(selectedValue) {
  return (model) =>
    `<option value="${model.id}"${model.id === selectedValue ? " selected" : ""}>${model.label}</option>`;
}

function createSession(name) {
  const now = new Date().toISOString();
  return {
    id: `session_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    avatar: "群",
    preview: "等待新话题",
    lastActivityAt: now,
    codexModel: DEFAULT_CODEX_MODEL,
    copilotModel: DEFAULT_COPILOT_MODEL,
    rounds: 3,
    members: MEMBERS,
    messages: [],
    baseMessages: [],
    gatewayThreadId: "",
    gatewayMirroredMessageIds: new Set(),
    run: null,
    summary: "等待新的讨论。",
    activeRunId: "",
    activeCancelToken: null,
  };
}

function getCurrentSession() {
  return sessions.find((session) => session.id === currentSessionId) ?? sessions[0] ?? null;
}

function renderApp() {
  const session = getCurrentSession();
  if (!session) {
    return;
  }

  elements.headerTitle.textContent = session.name;
  elements.headerMeta.textContent = buildHeaderMeta(session);
  elements.modelInput.value = session.codexModel;
  elements.copilotModelInput.value = session.copilotModel;
  elements.roundInput.value = String(session.rounds);
  elements.summaryBox.textContent = session.summary;
  elements.providerHealth.textContent = buildHealthLabel();

  renderSessionList(elements.sessionList, sessions, currentSessionId, searchQuery);
  renderMemberList(elements.memberInfoBox, session);
  renderMessages(elements.chatMessages, session);
  updateProgress(elements.progressSection, session.run);
  renderHistory(elements.historyList, historyRecords, session.activeRunId);
  elements.cancelRunBtn.disabled = !session.activeCancelToken || !session.activeRunId;
  scrollToBottom(elements.chatMessages);
  persistSessions();
}

function buildHeaderMeta(session) {
  const running = session.run && !["completed", "failed"].includes(session.run.status);
  if (running) {
    return `${session.members.length} 位成员 · ${describeRunStatus(session.run.status)}`;
  }
  return `${session.members.length} 位成员 · ${session.preview || "等待新话题"}`;
}

function buildHealthLabel() {
  if (!isTauriRuntime) {
    return "浏览器预览模式：Tauri 后端不可用";
  }
  if (!healthState.checkedAt) {
    return "正在检查认证状态";
  }
  if (healthState.codexReady && healthState.copilotReady) {
    return "Codex / Copilot 已认证";
  }
  const missing = [];
  if (!healthState.codexReady) {
    missing.push("Codex");
  }
  if (!healthState.copilotReady) {
    missing.push("Copilot");
  }
  return `${missing.join(" / ")} 未认证`;
}

function handleSessionListClick(event) {
  const deleteButton = event.target.closest("[data-role='delete']");
  if (deleteButton) {
    event.stopPropagation();
    deleteSession(deleteButton.closest(".session-item")?.dataset.id || "");
    return;
  }

  const item = event.target.closest(".session-item");
  if (!item?.dataset.id) {
    return;
  }
  currentSessionId = item.dataset.id;
  elements.shell.classList.remove("show-session-list");
  renderApp();
}

function toggleSessionList() {
  elements.detailPanel.classList.remove("open");
  elements.shell.classList.toggle("show-session-list");
}

function insertComposerText(text) {
  if (!text) {
    return;
  }
  const input = elements.messageInput;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const prefix = start > 0 && !/\s$/.test(input.value.slice(0, start)) ? " " : "";
  input.value = `${input.value.slice(0, start)}${prefix}${text}${input.value.slice(end)}`;
  const nextCursor = start + prefix.length + text.length;
  input.focus();
  input.setSelectionRange(nextCursor, nextCursor);
}

function closeModal() {
  elements.modalOverlay.classList.add("hidden");
}

function createGroupSession() {
  const name = elements.groupNameInput.value.trim();
  if (!name) {
    return;
  }

  const session = createSession(name);
  sessions.unshift(session);
  currentSessionId = session.id;
  closeModal();
  renderApp();
  void ensureGatewayThread(session);
}

function deleteCurrentSession() {
  deleteSession(currentSessionId);
}

function deleteSession(sessionId) {
  if (!sessionId) {
    return;
  }
  sessions = sessions.filter((session) => session.id !== sessionId);
  if (!sessions.length) {
    sessions = [createSession("Architecture Room")];
  }
  currentSessionId = sessions[0].id;
  renderApp();
}

function syncCurrentSessionConfig() {
  const session = getCurrentSession();
  if (!session) {
    return;
  }
  session.codexModel = elements.modelInput.value;
  session.copilotModel = elements.copilotModelInput.value;
  session.rounds = normalizeRoundValue(elements.roundInput.value);
  persistSessions();
}

function normalizeRoundValue(value) {
  const rounds = Number(value);
  if (!Number.isInteger(rounds)) {
    return 3;
  }
  return Math.max(1, Math.min(5, rounds));
}

async function submitTopic() {
  const session = getCurrentSession();
  const prompt = elements.messageInput.value.trim();
  if (!session || !prompt) {
    return;
  }

  if (!isTauriRuntime) {
    session.messages = [
      ...session.messages,
      createUiMessage({
        source: "gateway",
        kind: "error",
        content: "当前是浏览器预览模式，只用于检查 UI。请在 Tauri 窗口中发送真实讨论。",
        createdAt: new Date().toISOString(),
      }),
    ];
    renderApp();
    return;
  }

  syncCurrentSessionConfig();
  elements.messageInput.value = "";
  await runPrompt(session, prompt, {
    preview: prompt,
    pendingSummary: "讨论已发出，等待成员开始发言。",
  });
}

async function runSelfTest() {
  if (!isTauriRuntime) {
    renderBrowserPreviewMode();
    return;
  }
  const session = ensureDiagnosticSession();
  currentSessionId = session.id;
  session.summary = "正在运行 CLI smoke：Codex / Copilot";
  renderApp();

  elements.selfTestBtn.disabled = true;
  try {
    const smoke = await invoke("cli_smoke_test");
    const lines = [
      smoke?.codex?.ok ? "Codex smoke: PASS" : `Codex smoke: FAIL - ${smoke?.codex?.message ?? "unknown error"}`,
      smoke?.copilot?.ok
        ? "Copilot smoke: PASS"
        : `Copilot smoke: FAIL - ${smoke?.copilot?.message ?? "unknown error"}`,
    ];
    session.summary = lines.join("\n");
    if (!smoke?.ready) {
      session.messages = [
        createUiMessage({
          source: "gateway",
          kind: "error",
          content: `真实链路自检失败。\n\n${session.summary}`,
          createdAt: new Date().toISOString(),
        }),
      ];
      renderApp();
      return;
    }
  } catch (error) {
    session.summary = `CLI smoke failed: ${getErrorMessage(error)}`;
    session.messages = [
      createUiMessage({
        source: "gateway",
        kind: "error",
        content: session.summary,
        createdAt: new Date().toISOString(),
      }),
    ];
    renderApp();
    return;
  } finally {
    elements.selfTestBtn.disabled = false;
  }

  await runPrompt(
    session,
    "请作为真实在线的 Codex 与 Copilot 做一次最小自检讨论。Codex 先用一句话确认自己在线并说明职责；Copilot 再用一句话确认自己在线并说明职责；最后请 Codex 输出供网关生成总结所需的简短结论。不要寒暄，不要输出 markdown。",
    {
      preview: "真实链路自检",
      pendingSummary: "正在运行真实链路自检：Codex -> Copilot -> Codex summary",
    },
  );
}

async function runPrompt(session, prompt, options = {}) {
  if (!session || session.activeRunId) {
    return;
  }

  if (!healthState.codexReady || !healthState.copilotReady) {
    session.summary = buildHealthLabel();
    renderApp();
    return;
  }

  elements.sendBtn.disabled = true;
  elements.selfTestBtn.disabled = true;
  const cancelToken = createCancelToken();
  session.activeCancelToken = cancelToken;
  session.baseMessages = [...session.messages];
  session.summary = options.pendingSummary ?? "讨论已发出，等待成员开始发言。";
  session.preview = options.preview ?? prompt;
  session.lastActivityAt = new Date().toISOString();
  session.run = {
    status: "dispatching",
    currentStep: "dispatch",
  };
  renderApp();

  try {
    if (!options.skipGatewayMirror) {
      await mirrorUserPromptToGateway(session, prompt);
    }
    const result = await startRun(prompt, {
      store,
      maxRounds: session.rounds,
      providers: {
        codex: { provider: ProviderId.TAURI_CODEX, model: session.codexModel },
        copilot: { provider: ProviderId.TAURI_COPILOT, model: session.copilotModel },
      },
      cancelToken,
      onUpdate(snapshot) {
        syncSessionFromSnapshot(session, snapshot);
      },
    });

    syncSessionFromSnapshot(session, result, {
      suppressUserPrompt: options.suppressUserPrompt ? prompt : "",
    });
    await mirrorRunResultToGateway(session, result);
    session.summary = result.decision
      ? [result.decision.summary, result.decision.rationale].filter(Boolean).join("\n\n")
      : "讨论完成。";
    await mirrorSummaryToGateway(session, result);
    await refreshHistory();
  } catch (error) {
    session.activeRunId = "";
    session.run = {
      status: "failed",
      currentStep: "summary",
      error: getErrorMessage(error),
    };
    session.summary = `失败：${getErrorMessage(error)}`;
    session.messages = [
      ...session.baseMessages,
      createUiMessage({
        source: "gateway",
        kind: "error",
        content: session.summary,
        createdAt: new Date().toISOString(),
      }),
    ];
    await mirrorGatewayMessageToGateway(session, session.summary, "error");
  } finally {
    session.activeCancelToken = null;
    session.baseMessages = [...session.messages];
    elements.sendBtn.disabled = false;
    elements.selfTestBtn.disabled = false;
    renderApp();
  }
}

function cancelCurrentRun() {
  const session = getCurrentSession();
  if (!session?.activeCancelToken) {
    return;
  }
  session.activeCancelToken.cancel("user stopped from desktop");
  session.summary = "正在停止当前讨论。已发出的底层 CLI 调用可能还会短暂收尾，但 UI 会尽快恢复。";
  renderApp();
}

function ensureDiagnosticSession() {
  const existing = sessions.find((session) => session.name === "真实链路自检");
  if (existing) {
    existing.messages = [];
    existing.baseMessages = [];
    existing.summary = "等待新的讨论。";
    existing.activeRunId = "";
    existing.activeCancelToken = null;
    existing.run = null;
    existing.preview = "等待新话题";
    existing.lastActivityAt = new Date().toISOString();
    return existing;
  }

  const session = createSession("真实链路自检");
  session.rounds = 2;
  sessions.unshift(session);
  return session;
}

function syncSessionFromSnapshot(session, snapshot, options = {}) {
  session.activeRunId = snapshot.run?.status === "completed" || snapshot.run?.status === "failed" ? "" : snapshot.run?.id || "";
  session.run = snapshot.run ?? null;
  const snapshotMessages = options.suppressUserPrompt
    ? snapshot.messages.filter(
        (message) => !(message.source === "user" && message.content === options.suppressUserPrompt),
      )
    : snapshot.messages;
  session.messages = [
    ...session.baseMessages,
    ...snapshotMessages.map((message) =>
      createUiMessage({
        id: message.id,
        source: mapSource(message.source),
        kind: message.kind,
        content: message.content,
        createdAt: message.createdAt,
        round: message.round,
      }),
    ),
  ];
  session.preview = session.messages.at(-1)?.content ?? session.preview;
  session.lastActivityAt = snapshot.run?.startedAt ?? session.lastActivityAt;
  renderApp();
}

function createUiMessage({ id, source, kind, content, createdAt, round }) {
  const profile = getMemberProfile(source);
  return {
    id: id ?? `ui_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    source,
    name: profile.name,
    short: profile.short,
    tag: buildMessageTag(source, kind, round),
    content,
    createdAt: createdAt ?? new Date().toISOString(),
  };
}

function mapSource(source) {
  return source === "user" ? "me" : source;
}

function getMemberProfile(source) {
  return MEMBERS.find((member) => member.id === source) ?? MEMBERS[3];
}

function buildMessageTag(source, kind, round) {
  if (source === "me") {
    return "发起话题";
  }
  if (source === "gateway") {
    return kind === "error" ? "调度失败" : "网关消息";
  }
  return `Round ${round} · ${kind}`;
}

async function refreshHealth() {
  if (!isTauriRuntime) {
    renderBrowserPreviewMode();
    return;
  }
  try {
    const normalized = normalizeHealthResult(await healthClient.check());
    healthState = {
      codexReady: Boolean(normalized.agents?.codex?.ready),
      copilotReady: Boolean(normalized.agents?.copilot?.ready),
      checkedAt: new Date().toISOString(),
    };
  } catch {
    healthState = {
      codexReady: false,
      copilotReady: false,
      checkedAt: new Date().toISOString(),
    };
  }
  renderApp();
}

async function startAuth(agent) {
  if (!isTauriRuntime) {
    renderBrowserPreviewMode();
    return;
  }
  await authBroker.start(agent);
  await refreshHealth();
}

async function refreshGatewayStatus() {
  if (!isTauriRuntime) {
    renderBrowserPreviewMode();
    return;
  }
  try {
    renderGatewayStatus(await invoke("gateway_status"));
  } catch (error) {
    elements.gatewayStatusBox.textContent = `Gateway 状态读取失败：${getErrorMessage(error)}`;
  }
}

async function startGateway(exposeLan) {
  if (!isTauriRuntime) {
    renderBrowserPreviewMode();
    return;
  }
  setGatewayButtonsDisabled(true);
  try {
    renderGatewayStatus(
      await invoke("start_gateway_service", {
        request: {
          exposeLan,
          port: 17321,
        },
      }),
    );
  } catch (error) {
    elements.gatewayStatusBox.textContent = `Gateway 启动失败：${getErrorMessage(error)}`;
  } finally {
    setGatewayButtonsDisabled(false);
  }
}

async function stopGateway() {
  if (!isTauriRuntime) {
    renderBrowserPreviewMode();
    return;
  }
  setGatewayButtonsDisabled(true);
  try {
    renderGatewayStatus(await invoke("stop_gateway_service"));
  } catch (error) {
    elements.gatewayStatusBox.textContent = `Gateway 停止失败：${getErrorMessage(error)}`;
  } finally {
    setGatewayButtonsDisabled(false);
  }
}

function renderGatewayStatus(status) {
  if (!status?.running) {
    closeGatewayEventStream();
    gatewayState = {
      status: null,
      client: null,
      stream: null,
      streamUrl: "",
    };
    elements.gatewayStatusBox.textContent = "Gateway 未启动。\n局域网模式不会自动开启，需要手动点击。";
    elements.gatewayCopyMobileBtn.disabled = true;
    elements.gatewayCopyMobileBtn.dataset.mobileEntryUrl = "";
    return;
  }

  gatewayState = {
    status,
    client: createGatewayApiClient({
      baseUrl: status.localUrl,
      token: status.token,
    }),
    stream: gatewayState.stream,
    streamUrl: gatewayState.streamUrl,
  };
  openGatewayEventStream(status);

  const lines = [
    `状态：运行中 (${status.exposeLan ? "局域网" : "本机"})`,
    `本机：${status.localUrl}`,
  ];
  let mobileEntryUrl = "";
  if (status.lanUrl) {
    lines.push(`手机：${status.lanUrl}`);
    mobileEntryUrl = buildMobileEntryUrl(status.lanUrl, status.token);
    lines.push(`手机入口：${mobileEntryUrl}`);
  }
  lines.push(`Token：${maskSecret(status.token)}`);
  lines.push("说明：完整 token 不在界面明文展示，请使用复制手机入口。");
  elements.gatewayStatusBox.textContent = lines.join("\n");
  elements.gatewayCopyMobileBtn.disabled = !mobileEntryUrl;
  elements.gatewayCopyMobileBtn.dataset.mobileEntryUrl = mobileEntryUrl;
}

async function copyMobileEntry() {
  const mobileEntryUrl = elements.gatewayCopyMobileBtn.dataset.mobileEntryUrl || "";
  if (!mobileEntryUrl) {
    return;
  }
  try {
    await navigator.clipboard.writeText(mobileEntryUrl);
    elements.gatewayCopyMobileBtn.textContent = "已复制";
    window.setTimeout(() => {
      elements.gatewayCopyMobileBtn.textContent = "复制手机入口";
    }, 1200);
  } catch (error) {
    elements.gatewayStatusBox.textContent = `${elements.gatewayStatusBox.textContent}\n复制失败：${getErrorMessage(error)}`;
  }
}

function buildMobileEntryUrl(gatewayUrl, token) {
  const gateway = new URL(gatewayUrl);
  const appUrl = new URL(window.location.href);
  appUrl.hostname = gateway.hostname;
  appUrl.port = "1421";
  appUrl.pathname = "/";
  appUrl.search = "";
  appUrl.hash = "";
  appUrl.searchParams.set("mobile", "1");
  appUrl.searchParams.set("gateway", gatewayUrl);
  appUrl.searchParams.set("token", token);
  return appUrl.toString();
}

function openGatewayEventStream(status) {
  const streamUrl = `${status.localUrl}|${status.token}`;
  if (gatewayState.stream && gatewayState.streamUrl === streamUrl) {
    return;
  }

  closeGatewayEventStream();
  try {
    const stream = createGatewayEventStream({
      baseUrl: status.localUrl,
      token: status.token,
    });
    stream.addEventListener("message.created", handleGatewayMessageCreated);
    stream.addEventListener("thread.created", () => refreshGatewayBackedSessions());
    gatewayState.stream = stream;
    gatewayState.streamUrl = streamUrl;
  } catch (error) {
    elements.gatewayStatusBox.textContent = `Gateway 实时监听失败：${getErrorMessage(error)}`;
  }
}

function closeGatewayEventStream() {
  if (gatewayState.stream) {
    gatewayState.stream.close();
  }
}

function handleGatewayMessageCreated(event) {
  try {
    const record = JSON.parse(event.data);
    void syncGatewayThreadToPcSession(record.threadId);
  } catch {
    void refreshGatewayBackedSessions();
  }
}

function refreshGatewayBackedSessions() {
  for (const session of sessions) {
    if (session.gatewayThreadId) {
      void syncGatewayThreadToPcSession(session.gatewayThreadId);
    }
  }
}

async function syncGatewayThreadToPcSession(threadId) {
  if (!gatewayState.client || !threadId) {
    return;
  }
  const session = sessions.find((candidate) => candidate.gatewayThreadId === threadId);
  if (!session) {
    return;
  }

  try {
    const snapshot = await gatewayState.client.getThread(threadId);
    const incoming = (snapshot.messages ?? [])
      .filter((message) => !session.gatewayMirroredMessageIds.has(message.id))
      .map(gatewayMessageToUiMessage);
    if (!incoming.length) {
      return;
    }

    const autoRunMessage = incoming.find((message) =>
      shouldAutoRunGatewayMessage(snapshot.messages.find((candidate) => candidate.id === message.id)),
    );
    for (const message of incoming) {
      session.gatewayMirroredMessageIds.add(message.id);
    }
    session.messages = [...session.messages, ...incoming];
    session.baseMessages = [...session.baseMessages, ...incoming];
    session.preview = incoming.at(-1)?.content ?? session.preview;
    session.lastActivityAt = incoming.at(-1)?.createdAt ?? session.lastActivityAt;
    renderApp();
    if (autoRunMessage && !session.activeRunId) {
      void runPrompt(session, autoRunMessage.content, {
        preview: autoRunMessage.content,
        pendingSummary: "手机端话题已收到，正在派发给 Codex / Copilot。",
        skipGatewayMirror: true,
        suppressUserPrompt: true,
      });
    }
  } catch (error) {
    appendGatewayNotice(session, `Gateway 实时同步失败：${getErrorMessage(error)}`);
  }
}

function shouldAutoRunGatewayMessage(message) {
  if (!message || message.kind !== "user") {
    return false;
  }
  if (message.source?.type !== "human") {
    return false;
  }
  return message.source?.id !== "user";
}

function gatewayMessageToUiMessage(message) {
  const source = mapGatewaySourceToUiSource(message.source);
  return createUiMessage({
    id: message.id,
    source,
    kind: message.kind,
    content: message.content,
    createdAt: message.createdAt,
  });
}

function mapGatewaySourceToUiSource(source) {
  if (source?.type === "agent" && source.id === "codex") {
    return "codex";
  }
  if (source?.type === "agent" && source.id === "copilot") {
    return "copilot";
  }
  if (source?.type === "gateway" || source?.id === "gateway") {
    return "gateway";
  }
  return "me";
}

async function ensureGatewayThread(session) {
  if (!session || !gatewayState.client || session.gatewayThreadId) {
    return session?.gatewayThreadId ?? "";
  }

  try {
    const created = await gatewayState.client.createThread({
      title: session.name,
      createdBy: { type: "human", id: "user", name: "Me" },
      metadata: { pcSessionId: session.id },
    });
    session.gatewayThreadId = created.thread.id;
    persistSessions();
    return session.gatewayThreadId;
  } catch (error) {
    appendGatewayNotice(session, `Gateway 同步会话失败：${getErrorMessage(error)}`);
    return "";
  }
}

async function mirrorUserPromptToGateway(session, prompt) {
  if (!session || !prompt || !gatewayState.client) {
    return;
  }
  const threadId = await ensureGatewayThread(session);
  if (!threadId) {
    return;
  }

  const mirrorKey = `user:${prompt}:${session.lastActivityAt}`;
  if (session.gatewayMirroredMessageIds.has(mirrorKey)) {
    return;
  }

  try {
    const sent = await gatewayState.client.sendMessage(threadId, {
      kind: "user",
      source: { type: "human", id: "user", name: "Me" },
      targetAgents: inferTargetAgents(prompt),
      content: prompt,
      dispatch: false,
    });
    session.gatewayMirroredMessageIds.add(mirrorKey);
    if (sent?.message?.id) {
      session.gatewayMirroredMessageIds.add(sent.message.id);
    }
  } catch (error) {
    appendGatewayNotice(session, `Gateway 同步消息失败：${getErrorMessage(error)}`);
  }
}

async function mirrorRunResultToGateway(session, result) {
  if (!session || !result?.messages?.length || !gatewayState.client) {
    return;
  }
  const threadId = await ensureGatewayThread(session);
  if (!threadId) {
    return;
  }

  for (const message of result.messages) {
    if (!message?.id || session.gatewayMirroredMessageIds.has(message.id) || message.source === "user") {
      continue;
    }
    try {
      const sent = await gatewayState.client.sendMessage(threadId, {
        kind: mapGatewayMessageKind(message),
        source: createGatewayMessageSource(message.source),
        targetAgents: message.target ? [message.target].filter((target) => target !== "user") : [],
        content: message.content,
        dispatch: false,
      });
      session.gatewayMirroredMessageIds.add(message.id);
      if (sent?.message?.id) {
        session.gatewayMirroredMessageIds.add(sent.message.id);
      }
    } catch (error) {
      appendGatewayNotice(session, `Gateway 同步 ${message.source} 回复失败：${getErrorMessage(error)}`);
      return;
    }
  }
}

async function mirrorSummaryToGateway(session, result) {
  if (!session || !result?.decision || !gatewayState.client) {
    return;
  }
  const threadId = await ensureGatewayThread(session);
  const key = `summary:${result.decision.id}`;
  if (!threadId || session.gatewayMirroredMessageIds.has(key)) {
    return;
  }

  const content = [result.decision.summary, result.decision.rationale].filter(Boolean).join("\n\n");
  if (!content.trim()) {
    return;
  }

  try {
    const sent = await gatewayState.client.sendMessage(threadId, {
      kind: "summary",
      source: { type: "gateway", id: "gateway", name: "Gateway" },
      targetAgents: [],
      content,
      dispatch: false,
    });
    session.gatewayMirroredMessageIds.add(key);
    if (sent?.message?.id) {
      session.gatewayMirroredMessageIds.add(sent.message.id);
    }
  } catch (error) {
    appendGatewayNotice(session, `Gateway 同步总结失败：${getErrorMessage(error)}`);
  }
}

async function mirrorGatewayMessageToGateway(session, content, kind = "gateway") {
  if (!session || !content || !gatewayState.client) {
    return;
  }
  const threadId = await ensureGatewayThread(session);
  if (!threadId) {
    return;
  }

  const key = `${kind}:${content}`;
  if (session.gatewayMirroredMessageIds.has(key)) {
    return;
  }

  try {
    const sent = await gatewayState.client.sendMessage(threadId, {
      kind,
      source: { type: "gateway", id: "gateway", name: "Gateway" },
      targetAgents: [],
      content,
      dispatch: false,
    });
    session.gatewayMirroredMessageIds.add(key);
    if (sent?.message?.id) {
      session.gatewayMirroredMessageIds.add(sent.message.id);
    }
  } catch {
    // Avoid recursive UI errors when the Gateway error reporter itself fails.
  }
}

function inferTargetAgents(prompt) {
  const normalized = prompt.toLowerCase();
  const targets = [];
  if (normalized.includes("@codex") || normalized.includes("@all")) {
    targets.push("codex");
  }
  if (normalized.includes("@copilot") || normalized.includes("@all")) {
    targets.push("copilot");
  }
  return targets;
}

function mapGatewayMessageKind(message) {
  if (message.kind === "error") {
    return "error";
  }
  if (message.source === "gateway") {
    return "gateway";
  }
  return "agent";
}

function createGatewayMessageSource(source) {
  if (source === "codex") {
    return { type: "agent", id: "codex", name: "Codex" };
  }
  if (source === "copilot") {
    return { type: "agent", id: "copilot", name: "Copilot" };
  }
  if (source === "gateway") {
    return { type: "gateway", id: "gateway", name: "Gateway" };
  }
  return { type: "human", id: "user", name: "Me" };
}

function appendGatewayNotice(session, content) {
  if (!session || !content) {
    return;
  }
  const notice = createUiMessage({
    source: "gateway",
    kind: "error",
    content,
    createdAt: new Date().toISOString(),
  });
  session.messages = [
    ...session.messages,
    notice,
  ];
  session.baseMessages = [
    ...session.baseMessages,
    notice,
  ];
  renderApp();
}

function persistSessions() {
  localStorage.setItem(SESSION_STORAGE_KEY, serializeSessionState(sessions, currentSessionId));
}

function setGatewayButtonsDisabled(disabled) {
  elements.gatewayLocalBtn.disabled = disabled;
  elements.gatewayLanBtn.disabled = disabled;
  elements.gatewayStopBtn.disabled = disabled;
  elements.gatewayCopyMobileBtn.disabled = disabled || !elements.gatewayCopyMobileBtn.dataset.mobileEntryUrl;
}

function syncRuntimeOnlyControls() {
  if (isTauriRuntime) {
    return;
  }

  const runtimeOnlyControls = [
    elements.selfTestBtn,
    elements.railSelfTest,
    elements.gatewayLocalBtn,
    elements.gatewayLanBtn,
    elements.gatewayCopyMobileBtn,
    elements.gatewayStopBtn,
    document.getElementById("codex-auth-btn"),
    document.getElementById("copilot-auth-btn"),
  ];
  for (const control of runtimeOnlyControls) {
    control.disabled = true;
    control.title = "需要在 Tauri 应用窗口中使用";
  }
}

function renderBrowserPreviewMode() {
  if (elements?.gatewayStatusBox) {
    elements.gatewayStatusBox.textContent =
      "浏览器预览模式：Tauri 后端不可用。\n这里可以检查布局和输入体验；真实 Gateway、登录和自检请在 Tauri 窗口中使用。";
  }
}

async function refreshHistory() {
  const runs = await store.listRuns();
  historyRecords = (
    await Promise.all(
      runs.slice(0, 12).map(async (run) => store.getRun(run.id)),
    )
  ).filter(Boolean);
  renderApp();
}

async function handleHistoryClick(event) {
  const item = event.target.closest(".history-item");
  if (!item?.dataset.id) {
    return;
  }

  const snapshot = await store.getRun(item.dataset.id);
  if (!snapshot) {
    return;
  }

  const session = getCurrentSession();
  if (!session) {
    return;
  }

  session.messages = snapshot.messages.map((message) =>
    createUiMessage({
      id: message.id,
      source: mapSource(message.source),
      kind: message.kind,
      content: message.content,
      createdAt: message.createdAt,
      round: message.round,
    }),
  );
  session.baseMessages = [...session.messages];
  session.run = snapshot.run;
  session.activeRunId = snapshot.run.id;
  session.summary = snapshot.decision
    ? [snapshot.decision.summary, snapshot.decision.rationale].filter(Boolean).join("\n\n")
    : "该运行没有总结。";
  session.preview = snapshot.task?.prompt ?? session.preview;
  renderApp();
}

function describeRunStatus(status) {
  switch (status) {
    case "dispatching":
      return "正在派发";
    case "awaiting_codex":
      return "Codex 思考中";
    case "awaiting_copilot":
      return "Copilot 思考中";
    case "summarizing":
      return "Codex 总结中";
    case "completed":
      return "已完成";
    case "failed":
      return "已失败";
    default:
      return "处理中";
  }
}
