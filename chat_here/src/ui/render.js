import { AgentId, MessageKind, RunStatus, StepType } from "../gateway/schema/index.js";

export function renderEmpty(elements) {
  elements.statusText.textContent = "Idle";
  elements.roundBadge.textContent = "Round 0";
  elements.summaryText.textContent = "Gateway 状态和最终决策将在运行后显示";
  elements.codexState.textContent = "Codex Idle";
  elements.copilotState.textContent = "Copilot Idle";
  renderConversation(elements, []);
  setTimeline(elements, "idle");
}

export function renderLoading(elements, prompt) {
  elements.statusText.textContent = "开始讨论";
  elements.roundBadge.textContent = "Round 1";
  elements.summaryText.textContent = `话题已接受: ${prompt}`;
  elements.codexState.textContent = "Codex Thinking";
  elements.copilotState.textContent = "Copilot Waiting";
  renderConversation(elements, [
    {
      source: AgentId.USER,
      kind: MessageKind.TASK,
      round: 1,
      content: prompt,
      createdAt: Date.now(),
    },
  ]);
  setTimeline(elements, "running");
}

export function renderRun(elements, result) {
  const { run, messages, decision, error } = result;
  const isFailed = run.status === RunStatus.FAILED;
  const isCompleted = run.status === RunStatus.COMPLETED;
  const errorMessage = getErrorMessage(error, run.error ?? "无决策结果");

  if (isFailed) {
    elements.statusText.textContent = `失败: ${errorMessage}`;
  } else if (isCompleted) {
    elements.statusText.textContent = `完成: ${run.status}`;
  } else {
    elements.statusText.textContent = `运行: ${formatRunStatus(run.status)}`;
  }

  elements.roundBadge.textContent = `Round ${run.round}`;
  elements.summaryText.textContent = decision
    ? `${decision.summary}\n\n${decision.rationale}`
    : summarizeProgress(run, messages);

  applyAgentStates(elements, run, isFailed);
  renderConversation(elements, messages);
  setTimeline(elements, isFailed ? "failed" : isCompleted ? "completed" : "running");
}

export function renderHistory(elements, snapshots) {
  elements.historyList.innerHTML = "";

  if (snapshots.length === 0) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "暂无历史记录";
    elements.historyList.appendChild(empty);
    return;
  }

  for (const snapshot of snapshots) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "history-item";
    item.dataset.runId = snapshot.run.id;

    const title = document.createElement("span");
    title.className = "history-item-title";
    title.textContent = snapshot.task?.title ?? snapshot.task?.prompt ?? snapshot.run.id;

    const meta = document.createElement("span");
    meta.className = "history-item-meta";
    meta.textContent = `${snapshot.run.status} / ${formatTime(snapshot.run.startedAt)}`;

    item.append(title, meta);
    elements.historyList.appendChild(item);
  }
}

export function renderError(elements, error) {
  elements.statusText.textContent = "失败";
  elements.summaryText.textContent = getErrorMessage(error);
  elements.codexState.textContent = "Codex Error";
  elements.copilotState.textContent = "Copilot Error";
  renderConversation(elements, []);
  setTimeline(elements, "failed");
}

export function getErrorMessage(error, fallback = "未知错误") {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error?.message === "string" && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback ?? String(error);
}

function renderConversation(elements, messages) {
  elements.chatPanel.innerHTML = "";

  if (messages.length === 0) {
    elements.chatPanel.appendChild(
      createChatBubble({
        author: "Gateway",
        role: "system",
        avatar: "G",
        time: Date.now(),
        content: "群组已创建，发送话题开始讨论",
      }),
    );
    scrollToBottom(elements.chatPanel);
    return;
  }

  const now = Date.now();
  let lastTime = null;
  
  for (const message of messages) {
    const messageTime = message.createdAt ?? now;
    
    if (lastTime !== null && messageTime - lastTime > 5 * 60 * 1000) {
      elements.chatPanel.appendChild(createTimeDivider(lastTime));
    }
    lastTime = messageTime;

    const chunks = splitMessageIntoChunks(message.content);
    for (const [index, chunk] of chunks.entries()) {
      elements.chatPanel.appendChild(
        createChatBubble(toBubbleViewModel(message, chunk, index, chunks.length, messageTime)),
      );
    }
  }

  scrollToBottom(elements.chatPanel);
}

function createChatBubble({ author, role, avatar, time, content }) {
  const block = document.createElement("div");
  block.className = `chat-bubble ${role}`;

  const avatarNode = document.createElement("div");
  avatarNode.className = `bubble-avatar ${role === "user" ? "me" : role}`;
  avatarNode.textContent = avatar;

  const contentWrap = document.createElement("div");
  contentWrap.className = "bubble-content";

  const headerNode = document.createElement("div");
  headerNode.className = "bubble-header";

  const authorNode = document.createElement("span");
  authorNode.className = "bubble-author";
  authorNode.textContent = author;

  const timeNode = document.createElement("span");
  timeNode.className = "bubble-time";
  timeNode.textContent = formatTime(time);

  const textNode = document.createElement("div");
  textNode.className = "bubble-text";
  textNode.textContent = content;

  headerNode.append(authorNode, timeNode);
  contentWrap.append(headerNode, textNode);
  block.append(avatarNode, contentWrap);
  return block;
}

function createTimeDivider(time) {
  const divider = document.createElement("div");
  divider.className = "time-divider";
  divider.textContent = formatTime(time);
  return divider;
}

function scrollToBottom(panel) {
  requestAnimationFrame(() => {
    panel.scrollTop = panel.scrollHeight;
  });
}

function toBubbleViewModel(message, content, index = 0, total = 1, time = Date.now()) {
  const suffix = total > 1 ? ` · ${index + 1}/${total}` : "";

  if (message.source === AgentId.USER) {
    return {
      author: "Me",
      role: "user",
      avatar: "M",
      time,
      content,
    };
  }

  if (message.source === AgentId.CODEX) {
    return {
      author: "Codex",
      role: "codex",
      avatar: "C",
      time,
      content,
    };
  }

  if (message.source === AgentId.COPILOT) {
    return {
      author: "Copilot",
      role: "copilot",
      avatar: "P",
      time,
      content,
    };
  }

  return {
    author: "Gateway",
    role: "system",
    avatar: "G",
    time,
    content,
  };
}

function splitMessageIntoChunks(content) {
  const chunks = String(content)
    .split(/\n\s*\n/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  return chunks.length > 0 ? chunks : [String(content).trim()];
}

function formatTime(timestamp) {
  if (!timestamp) return "刚刚";
  
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60 * 1000) return "刚刚";
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}分钟前`;
  
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  
  if (date.toDateString() === now.toDateString()) {
    return `${hours}:${minutes}`;
  }
  
  return `${date.getMonth() + 1}/${date.getDate()} ${hours}:${minutes}`;
}

function applyAgentStates(elements, run, isFailed) {
  if (isFailed) {
    elements.codexState.textContent = "Codex Failed";
    elements.copilotState.textContent = "Copilot Failed";
    return;
  }

  switch (run.currentStep) {
    case StepType.CODEX_DRAFT:
    case StepType.CODEX_REVISION:
      elements.codexState.textContent = "Codex Thinking";
      elements.copilotState.textContent = "Copilot Waiting";
      break;
    case StepType.COPILOT_REVIEW:
      elements.codexState.textContent = "Codex Sent";
      elements.copilotState.textContent = "Copilot Thinking";
      break;
    case StepType.SUMMARY:
      elements.codexState.textContent = "Codex Discussed";
      elements.copilotState.textContent = "Copilot Discussed";
      break;
    default:
      elements.codexState.textContent = "Codex Idle";
      elements.copilotState.textContent = "Copilot Idle";
      break;
  }
}

function summarizeProgress(run, messages) {
  const lastMessage = messages.at(-1);
  if (!lastMessage) {
    return "等待第一条消息";
  }

  return [
    `当前步骤: ${formatRunStatus(run.status)}`,
    `最新发言: ${formatSpeaker(lastMessage.source)}`,
    `最新消息: ${truncate(lastMessage.content, 220)}`,
  ].join("\n");
}

function formatSpeaker(source) {
  switch (source) {
    case AgentId.USER:
      return "Me";
    case AgentId.CODEX:
      return "Codex";
    case AgentId.COPILOT:
      return "Copilot";
    default:
      return "Gateway";
  }
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function formatRunStatus(status) {
  return status.replaceAll("_", " ");
}

function setTimeline(elements, mode) {
  const states = {
    idle: {
      dispatch: ["", "Waiting"],
      review: ["", "Waiting"],
      decision: ["", "Waiting"],
    },
    running: {
      dispatch: ["is-active", "Dispatching"],
      review: ["", "Waiting"],
      decision: ["", "Waiting"],
    },
    completed: {
      dispatch: ["is-done", "Dispatched"],
      review: ["is-done", "Discussed"],
      decision: ["is-done", "Completed"],
    },
    failed: {
      dispatch: ["is-done", "Dispatched"],
      review: ["is-active", "Failed"],
      decision: ["", "No decision"],
    },
  };

  const state = states[mode];
  for (const [key, [className, text]] of Object.entries(state)) {
    const item = elements.timeline[key];
    item.classList.remove("is-active", "is-done");
    if (className) {
      item.classList.add(className);
    }
    const statusEl = item.querySelector(".timeline-status");
    if (statusEl) {
      statusEl.textContent = text;
    }
  }
}