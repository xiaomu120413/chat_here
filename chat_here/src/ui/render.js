const PROGRESS_STAGES = [
  { id: "dispatch", title: "调度器", match: () => true },
  { id: "discussion", title: "群组讨论", match: (run) => run.currentStep?.includes("codex") || run.currentStep?.includes("copilot") },
  { id: "summary", title: "总结", match: (run) => run.currentStep === "summary" || run.status === "completed" },
];

export function renderMessages(container, session) {
  container.innerHTML = "";

  if (!session?.messages?.length) {
    const empty = document.createElement("div");
    empty.className = "messages-empty";
    empty.textContent = "在这里抛出一个问题，Codex 和 Copilot 会在群里展开讨论。";
    container.append(empty);
    return;
  }

  let lastDay = "";
  for (const message of session.messages) {
    const dayKey = formatDay(message.createdAt);
    if (dayKey !== lastDay) {
      container.append(createDayDivider(dayKey));
      lastDay = dayKey;
    }
    container.append(createMessageRow(message));
  }
}

export function renderSessionList(container, sessions, currentSessionId, query = "") {
  const normalizedQuery = query.trim().toLowerCase();
  const visibleSessions = normalizedQuery
    ? sessions.filter((session) => session.name.toLowerCase().includes(normalizedQuery))
    : sessions;

  container.innerHTML = "";

  if (!visibleSessions.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "没有匹配的会话。";
    container.append(empty);
    return;
  }

  for (const session of visibleSessions) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `session-item${session.id === currentSessionId ? " active" : ""}`;
    item.dataset.id = session.id;

    const avatar = document.createElement("div");
    avatar.className = "session-avatar group";
    avatar.textContent = session.avatar ?? "群";

    const content = document.createElement("div");
    content.className = "session-content";

    const nameRow = document.createElement("div");
    nameRow.className = "session-name-row";

    const name = document.createElement("div");
    name.className = "session-name";
    name.textContent = session.name;

    const time = document.createElement("div");
    time.className = "session-time";
    time.textContent = formatShortTime(session.lastActivityAt);

    const preview = document.createElement("div");
    preview.className = "session-preview";
    preview.textContent = session.preview || "等待新话题";

    nameRow.append(name, time);
    content.append(nameRow, preview);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "session-delete";
    close.dataset.role = "delete";
    close.textContent = "×";

    item.append(avatar, content, close);
    container.append(item);
  }
}

export function renderMemberList(container, session) {
  container.innerHTML = "";
  for (const member of session.members) {
    const row = document.createElement("div");
    row.className = "member-row";

    const avatar = document.createElement("div");
    avatar.className = `member-avatar ${member.id}`;
    avatar.textContent = member.short;

    const content = document.createElement("div");
    const name = document.createElement("div");
    name.className = "member-name";
    name.textContent = member.name;

    const role = document.createElement("div");
    role.className = "member-role";
    role.textContent = member.role;

    content.append(name, role);
    row.append(avatar, content);
    container.append(row);
  }
}

export function renderHistory(container, records, activeRunId = "") {
  container.innerHTML = "";
  if (!records.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "还没有运行记录。";
    container.append(empty);
    return;
  }

  for (const record of records) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `history-item${record.run.id === activeRunId ? " active" : ""}`;
    item.dataset.id = record.run.id;

    const titleRow = document.createElement("div");
    titleRow.className = "history-title-row";

    const title = document.createElement("div");
    title.textContent = truncate(record.task?.title || record.task?.prompt || record.run.id, 28);

    const time = document.createElement("div");
    time.className = "history-meta";
    time.textContent = formatShortTime(record.run.startedAt);

    const meta = document.createElement("div");
    meta.className = "history-meta";
    meta.textContent = `${record.run.status} · ${record.messages?.length ?? 0} 条消息`;

    titleRow.append(title, time);
    item.append(titleRow, meta);
    container.append(item);
  }
}

export function updateProgress(container, run) {
  container.innerHTML = "";
  if (!run) {
    container.append(createProgressCard("dispatch", "等待开始", "idle"));
    container.append(createProgressCard("discussion", "暂无讨论", "idle"));
    container.append(createProgressCard("summary", "暂无总结", "idle"));
    return;
  }

  for (const stage of PROGRESS_STAGES) {
    let state = "idle";
    let label = "等待";

    if (run.status === "failed") {
      if (stage.id === "summary") {
        state = "failed";
        label = "失败";
      } else if (stage.match(run)) {
        state = "failed";
        label = "失败";
      } else {
        state = "done";
        label = "完成";
      }
    } else if (run.status === "completed") {
      state = "done";
      label = "完成";
    } else if (stage.match(run)) {
      state = "active";
      label = stage.id === "discussion" ? describeRunStep(run.currentStep) : "进行中";
    } else if (isStageBeforeCurrent(stage.id, run.currentStep)) {
      state = "done";
      label = "完成";
    }

    container.append(createProgressCard(stage.title, label, state));
  }
}

export function getErrorMessage(error, fallback = "未知错误") {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (error && typeof error === "object" && typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }
  return fallback;
}

export function scrollToBottom(container) {
  container.scrollTop = container.scrollHeight;
}

function createMessageRow(message) {
  const row = document.createElement("div");
  const self = message.source === "me";
  const gateway = message.source === "gateway";
  row.className = `message-row${self ? " self" : ""}${gateway ? " gateway" : ""}`;

  const avatar = document.createElement("div");
  avatar.className = `message-avatar ${message.source}`;
  avatar.textContent = message.short;

  const stack = document.createElement("div");
  stack.className = "message-stack";

  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent = `${message.name} · ${formatClock(message.createdAt)} · ${message.tag}`;

  const parts = splitMessageContent(message.content);
  for (const part of parts) {
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    bubble.textContent = part;
    stack.append(bubble);
  }

  stack.prepend(meta);
  row.append(avatar, stack);
  return row;
}

function createDayDivider(text) {
  const divider = document.createElement("div");
  divider.className = "day-divider";
  const label = document.createElement("span");
  label.textContent = text;
  divider.append(label);
  return divider;
}

function createProgressCard(title, label, state) {
  const card = document.createElement("div");
  card.className = `progress-card${state === "active" ? " active" : ""}${state === "done" ? " done" : ""}${state === "failed" ? " failed" : ""}`;

  const left = document.createElement("div");
  left.textContent = title;

  const right = document.createElement("div");
  right.className = "history-meta";
  right.textContent = label;

  card.append(left, right);
  return card;
}

function splitMessageContent(content) {
  return String(content ?? "")
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function formatDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "今天";
  }
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatClock(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatShortTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function describeRunStep(step) {
  switch (step) {
    case "codex_draft":
      return "Codex 开场";
    case "codex_revision":
      return "Codex 继续";
    case "copilot_review":
      return "Copilot 回复";
    case "summary":
      return "生成总结";
    default:
      return "进行中";
  }
}

function isStageBeforeCurrent(stageId, currentStep) {
  if (stageId === "dispatch") {
    return currentStep !== "dispatch";
  }
  if (stageId === "discussion") {
    return currentStep === "summary";
  }
  return false;
}

function truncate(text, length) {
  if (!text) {
    return "";
  }
  return text.length > length ? `${text.slice(0, length)}...` : text;
}
