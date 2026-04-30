import { AgentId, MessageKind, RunStatus } from "../gateway/schema/index.js";

export function renderEmpty(elements) {
  elements.statusText.textContent = "Idle";
  elements.roundBadge.textContent = "Round 0";
  elements.summaryText.textContent = "Gateway 状态和决策将在此显示";
  elements.codexState.textContent = "Codex Idle";
  elements.copilotState.textContent = "Copilot Idle";
  clearTimeline(elements);
  renderMessages(elements, [], null);
}

export function renderLoading(elements, prompt) {
  elements.statusText.textContent = "开始讨论";
  elements.roundBadge.textContent = "Round 1";
  elements.summaryText.textContent = `话题: ${prompt}`;
  elements.codexState.textContent = "Codex Thinking";
  elements.copilotState.textContent = "Copilot Waiting";
  renderMessages(elements, [
    {
      source: AgentId.USER,
      kind: MessageKind.TASK,
      round: 1,
      content: prompt,
      createdAt: Date.now(),
    },
  ], { round: 1, status: "RUNNING" });
}

export function renderMessages(elements, messages, run) {
  elements.chatPanel.innerHTML = "";

  if (!messages || messages.length === 0) {
    elements.chatPanel.innerHTML = `
      <div class="message-row">
        <div class="message-avatar gateway">G</div>
        <div class="message-body">
          <span class="message-author">Gateway</span>
          <div class="message-content">群组已创建，发送话题开始讨论</div>
        </div>
      </div>
    `;
    return;
  }

  let lastTime = null;
  const now = Date.now();

  for (const message of messages) {
    const msgTime = message.createdAt || now;
    
    if (lastTime && msgTime - lastTime > 300000) {
      const divider = document.createElement("div");
      divider.className = "time-divider";
      divider.textContent = formatTime(lastTime);
      elements.chatPanel.appendChild(divider);
    }
    lastTime = msgTime;

    elements.chatPanel.appendChild(createMessageRow(message, msgTime));
  }

  scrollToBottom(elements.chatPanel);
  
  if (run) {
    applyAgentStates(elements, run);
  }
}

export function renderSessionList(container, sessions, currentId) {
  container.innerHTML = "";

  const groupSessions = sessions.filter(s => s.type === "group");
  const privateSessions = sessions.filter(s => s.type === "private");

  if (groupSessions.length > 0) {
    const groupHeader = document.createElement("div");
    groupHeader.className = "session-group-title";
    groupHeader.textContent = "群聊";
    container.appendChild(groupHeader);

    for (const session of groupSessions) {
      container.appendChild(createSessionItem(session, currentId));
    }
  }

  if (privateSessions.length > 0) {
    const privateHeader = document.createElement("div");
    privateHeader.className = "session-group-title";
    privateHeader.textContent = "私聊";
    container.appendChild(privateHeader);

    for (const session of privateSessions) {
      container.appendChild(createSessionItem(session, currentId));
    }
  }

  if (sessions.length === 0) {
    container.innerHTML = '<p class="empty-text">暂无会话</p>';
  }
}

function createSessionItem(session, currentId) {
  const item = document.createElement("div");
  item.className = `session-item ${session.id === currentId ? "active" : ""}`;
  item.dataset.session = session.id;

  const avatarClass = session.type === "group" ? "group" : session.member;
  const avatarText = session.type === "group" ? "群" : session.member.charAt(0).toUpperCase();

  item.innerHTML = `
    <div class="session-avatar ${avatarClass}">${avatarText}</div>
    <div class="session-content">
      <span class="session-name">${session.name}</span>
      <span class="session-preview">${session.lastMessage || "暂无消息"}</span>
    </div>
    <div class="session-meta">
      <span class="session-time">${session.lastTime ? formatTime(session.lastTime) : ""}</span>
      <span class="session-unread ${session.unread > 0 ? "" : "hidden"}">${session.unread || 0}</span>
    </div>
  `;

  return item;
}

export function renderPrivateChat(elements, session) {
  elements.chatPanel.innerHTML = `
    <div class="message-row">
      <div class="message-avatar ${session.member}">${session.member.charAt(0).toUpperCase()}</div>
      <div class="message-body">
        <span class="message-author">${session.name}</span>
        <div class="message-content">私聊功能正在开发中...</div>
      </div>
    </div>
  `;
  
  elements.statusText.textContent = "私聊暂不可用";
}

export function renderHistory(elements, snapshots) {
  elements.historyList.innerHTML = "";

  if (!snapshots || snapshots.length === 0) {
    elements.historyList.innerHTML = '<p class="empty-text">暂无历史</p>';
    return;
  }

  for (const snapshot of snapshots) {
    const item = document.createElement("div");
    item.className = "history-item";
    item.dataset.runId = snapshot.run.id;

    const title = snapshot.task?.prompt || snapshot.run.id;
    const status = snapshot.run.status;
    const time = formatTime(snapshot.run.startedAt);

    item.innerHTML = `
      <span class="history-item-title">${truncate(title, 30)}</span>
      <span class="history-item-meta">${status} · ${time}</span>
    `;

    elements.historyList.appendChild(item);
  }
}

export function renderError(elements, error) {
  elements.statusText.textContent = "失败";
  elements.summaryText.textContent = getErrorMessage(error);
  elements.codexState.textContent = "Codex Error";
  elements.copilotState.textContent = "Copilot Error";
  clearTimeline(elements);
  
  elements.chatPanel.innerHTML = `
    <div class="message-row">
      <div class="message-avatar gateway">G</div>
      <div class="message-body">
        <span class="message-author">Gateway</span>
        <div class="message-content">发生错误: ${getErrorMessage(error)}</div>
      </div>
    </div>
  `;
}

function createMessageRow(message, time) {
  const row = document.createElement("div");
  const isSelf = message.source === AgentId.USER;
  row.className = `message-row ${isSelf ? "self" : ""}`;

  let avatarClass = "";
  let avatarText = "";
  let author = "";

  switch (message.source) {
    case AgentId.USER:
      avatarClass = "me";
      avatarText = "M";
      author = "Me";
      break;
    case AgentId.CODEX:
      avatarClass = "codex";
      avatarText = "C";
      author = "Codex";
      break;
    case AgentId.COPILOT:
      avatarClass = "copilot";
      avatarText = "P";
      author = "Copilot";
      break;
    default:
      avatarClass = "gateway";
      avatarText = "G";
      author = "Gateway";
  }

  const avatar = isSelf ? "" : `<div class="message-avatar ${avatarClass}">${avatarText}</div>`;
  const authorEl = isSelf ? "" : `<span class="message-author">${author}</span>`;

  row.innerHTML = `
    ${avatar}
    <div class="message-body">
      ${authorEl}
      <div class="message-content">${escapeHtml(message.content)}</div>
      <span class="message-time">${formatTime(time)}</span>
    </div>
  `;

  return row;
}

function scrollToBottom(panel) {
  requestAnimationFrame(() => {
    panel.scrollTop = panel.scrollHeight;
  });
}

function formatTime(timestamp) {
  if (!timestamp) return "刚刚";

  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;

  const hour = date.getHours().toString().padStart(2, "0");
  const minute = date.getMinutes().toString().padStart(2, "0");

  if (date.toDateString() === now.toDateString()) {
    return `${hour}:${minute}`;
  }

  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${month}/${day} ${hour}:${minute}`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function truncate(text, max) {
  if (!text || text.length <= max) return text || "";
  return text.slice(0, max - 1) + "...";
}

function applyAgentStates(elements, run) {
  const status = run?.status || "";
  const isFailed = status === RunStatus.FAILED;

  if (isFailed) {
    elements.codexState.textContent = "Codex Failed";
    elements.copilotState.textContent = "Copilot Failed";
    return;
  }

  if (status.includes("CODEX")) {
    elements.codexState.textContent = "Codex Thinking";
    elements.copilotState.textContent = "Copilot Waiting";
  } else if (status.includes("COPILOT")) {
    elements.codexState.textContent = "Codex Done";
    elements.copilotState.textContent = "Copilot Thinking";
  } else if (status === RunStatus.COMPLETED) {
    elements.codexState.textContent = "Codex Done";
    elements.copilotState.textContent = "Copilot Done";
  } else {
    elements.codexState.textContent = "Codex Idle";
    elements.copilotState.textContent = "Copilot Idle";
  }
}

function clearTimeline(elements) {
  elements.timeline.dispatch.classList.remove("active", "done");
  elements.timeline.review.classList.remove("active", "done");
  elements.timeline.decision.classList.remove("active", "done");
}

export function getErrorMessage(error, fallback = "未知错误") {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error?.message === "string" && error.message.trim()) return error.message;
  return fallback;
}