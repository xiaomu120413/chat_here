import { AgentId, MessageKind, RunStatus, StepType } from "../gateway/schema/index.js";

export function renderEmpty(elements) {
  elements.statusText.textContent = "Idle";
  elements.roundBadge.textContent = "Round 0";
  elements.summaryText.textContent = "Gateway state and final decision will appear here after a run.";
  elements.codexState.textContent = "Codex Idle";
  elements.copilotState.textContent = "Copilot Idle";
  renderConversation(elements, []);
  renderEventLog(elements, []);
  setTimeline(elements, "idle");
}

export function renderLoading(elements, prompt) {
  elements.statusText.textContent = "Starting discussion";
  elements.roundBadge.textContent = "Round 1";
  elements.summaryText.textContent = `Task accepted: ${prompt}`;
  elements.codexState.textContent = "Codex Thinking";
  elements.copilotState.textContent = "Copilot Waiting";
  renderConversation(elements, [
    {
      source: AgentId.USER,
      kind: MessageKind.TASK,
      round: 1,
      content: prompt,
    },
  ]);
  renderEventLog(elements, []);
  setTimeline(elements, "running");
}

export function renderRun(elements, result) {
  const { run, messages, decision, error } = result;
  const isFailed = run.status === RunStatus.FAILED;
  const isCompleted = run.status === RunStatus.COMPLETED;
  const errorMessage = getErrorMessage(error, run.error ?? "No decision available.");

  if (isFailed) {
    elements.statusText.textContent = `Failed: ${errorMessage}`;
  } else if (isCompleted) {
    elements.statusText.textContent = `Completed: ${run.status}`;
  } else {
    elements.statusText.textContent = `Running: ${formatRunStatus(run.status)}`;
  }

  elements.roundBadge.textContent = `Round ${run.round}`;
  elements.summaryText.textContent = decision
    ? `${decision.summary}\n\n${decision.rationale}`
    : summarizeProgress(run, messages);

  applyAgentStates(elements, run, isFailed);
  renderConversation(elements, messages);
  renderEventLog(elements, result.events ?? []);

  setTimeline(elements, isFailed ? "failed" : isCompleted ? "completed" : "running");
}

export function renderHistory(elements, snapshots) {
  elements.historyCount.textContent = `${snapshots.length} saved`;
  elements.historyList.innerHTML = "";

  if (snapshots.length === 0) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "No saved runs yet.";
    elements.historyList.appendChild(empty);
    return;
  }

  for (const snapshot of snapshots) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-item";
    button.dataset.runId = snapshot.run.id;

    const title = document.createElement("span");
    title.className = "history-title";
    title.textContent = snapshot.task?.title ?? snapshot.task?.prompt ?? snapshot.run.id;

    const meta = document.createElement("span");
    meta.className = "history-meta";
    meta.textContent = `${snapshot.run.status} / ${new Date(snapshot.run.startedAt).toLocaleString()}`;

    button.append(title, meta);
    elements.historyList.appendChild(button);
  }
}

export function renderError(elements, error) {
  elements.statusText.textContent = "Failed";
  elements.summaryText.textContent = getErrorMessage(error);
  elements.codexState.textContent = "Codex Error";
  elements.copilotState.textContent = "Copilot Error";
  renderConversation(elements, []);
  renderEventLog(elements, []);
  setTimeline(elements, "failed");
}

export function getErrorMessage(error, fallback = "Unknown error") {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error?.message === "string" && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback ?? String(error);
}

function renderEventLog(elements, events) {
  elements.eventLog.innerHTML = "";

  if (events.length === 0) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "No events yet.";
    elements.eventLog.appendChild(empty);
    return;
  }

  for (const event of events) {
    const item = document.createElement("div");
    item.className = "event-log-item";

    const type = document.createElement("strong");
    type.textContent = event.type;

    const meta = document.createElement("span");
    meta.textContent = event.createdAt
      ? `${event.payload?.messageId ?? event.payload?.decisionId ?? event.runId} / ${new Date(event.createdAt).toLocaleTimeString()}`
      : event.payload?.messageId ?? event.payload?.decisionId ?? event.runId;

    item.append(type, meta);
    elements.eventLog.appendChild(item);
  }
}

function renderConversation(elements, messages) {
  elements.chatPanel.innerHTML = "";

  if (messages.length === 0) {
    elements.chatPanel.appendChild(
      createChatBubble({
        author: "Gateway",
        role: "system",
        meta: "Idle",
        content: "Group created. Send a topic to start the discussion.",
      }),
    );
    return;
  }

  for (const message of messages) {
    const chunks = splitMessageIntoChunks(message.content);
    for (const [index, chunk] of chunks.entries()) {
      elements.chatPanel.appendChild(
        createChatBubble(toBubbleViewModel(message, chunk, index, chunks.length)),
      );
    }
  }

  elements.chatPanel.scrollTop = elements.chatPanel.scrollHeight;
}

function createChatBubble({ author, role, meta, content }) {
  const block = document.createElement("div");
  block.className = `chat-bubble ${role}`;

  const metaNode = document.createElement("div");
  metaNode.className = "chat-meta";

  const authorNode = document.createElement("strong");
  authorNode.textContent = author;

  const detailNode = document.createElement("span");
  detailNode.textContent = meta;

  const contentNode = document.createElement("p");
  contentNode.textContent = content;

  metaNode.append(authorNode, detailNode);
  block.append(metaNode, contentNode);
  return block;
}

function toBubbleViewModel(message, content, index = 0, total = 1) {
  const suffix = total > 1 ? ` · ${index + 1}/${total}` : "";

  if (message.source === AgentId.USER) {
    return {
      author: "Me",
      role: "user",
      meta: `Round ${message.round}${suffix}`,
      content,
    };
  }

  if (message.source === AgentId.CODEX) {
    return {
      author: "Codex",
      role: "codex",
      meta: `Round ${message.round} · ${formatKind(message.kind)}${suffix}`,
      content,
    };
  }

  if (message.source === AgentId.COPILOT) {
    return {
      author: "Copilot",
      role: "copilot",
      meta: `Round ${message.round} · ${formatKind(message.kind)}${suffix}`,
      content,
    };
  }

  return {
    author: "Gateway",
    role: "system",
    meta: `Round ${message.round ?? 1} · ${formatKind(message.kind)}${suffix}`,
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

function formatKind(kind) {
  switch (kind) {
    case MessageKind.TASK:
      return "Topic";
    case MessageKind.DRAFT:
      return "Opening";
    case MessageKind.REVIEW:
      return "Reply";
    case MessageKind.REVISION:
      return "Reply";
    case MessageKind.ERROR:
      return "Error";
    default:
      return kind;
  }
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
    return "Waiting for the first message.";
  }

  return [
    `Current step: ${formatRunStatus(run.status)}.`,
    `Latest speaker: ${formatSpeaker(lastMessage.source)}.`,
    `Latest message: ${truncate(lastMessage.content, 220)}`,
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
    item.querySelector("p").textContent = text;
  }
}
