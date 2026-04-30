const AVATAR_COLORS = {
  me: "me",
  codex: "codex",
  copilot: "copilot",
  gateway: "gateway",
};

const AVATAR_TEXT = {
  me: "M",
  codex: "C",
  copilot: "P",
  gateway: "G",
};

const NAMES = {
  me: "Me",
  codex: "Codex",
  copilot: "Copilot",
  gateway: "Gateway",
};

export function renderSessionList(sessions, currentId) {
  const container = document.getElementById("session-list");
  container.innerHTML = "";

  const groups = sessions.filter(s => s.type === "group");
  const privates = sessions.filter(s => s.type === "private");

  if (groups.length > 0) {
    const header = document.createElement("div");
    header.className = "session-header";
    header.textContent = "群聊";
    container.appendChild(header);

    groups.forEach(session => {
      container.appendChild(createSessionItem(session, currentId));
    });
  }

  if (privates.length > 0) {
    const header = document.createElement("div");
    header.className = "session-header";
    header.textContent = "私聊";
    container.appendChild(header);

    privates.forEach(session => {
      container.appendChild(createSessionItem(session, currentId));
    });
  }
}

function createSessionItem(session, currentId) {
  const item = document.createElement("div");
  item.className = `session-item ${session.id === currentId ? "active" : ""}`;
  item.dataset.id = session.id;

  const memberKey = session.type === "private" ? session.agent : session.member;
  const avatarClass = session.type === "group" ? "group" : memberKey;
  const avatarText = session.type === "group" ? "群" : AVATAR_TEXT[memberKey];

  item.innerHTML = `
    <div class="session-avatar ${avatarClass}">${avatarText}</div>
    <div class="session-info">
      <div class="session-name">${session.name}</div>
      <div class="session-desc">${session.lastMessage || "暂无消息"}</div>
    </div>
    <div class="session-meta">
      <span class="session-time">${formatTime(session.lastTime)}</span>
      <button class="session-delete" title="删除">×</button>
    </div>
  `;

  return item;
}

export function renderMemberList(members) {
  const container = document.getElementById("member-list");
  container.innerHTML = "";

  const roles = {
    me: "用户",
    codex: "Primary builder",
    copilot: "Counterpoint reviewer",
    gateway: "Turn manager",
  };

  members.forEach(member => {
    const item = document.createElement("div");
    item.className = "member-item";
    item.dataset.id = member;

    item.innerHTML = `
      <div class="member-avatar ${AVATAR_COLORS[member]}">${AVATAR_TEXT[member]}</div>
      <div class="member-info">
        <div class="member-name">${NAMES[member]}</div>
        <div class="member-role">${roles[member] || ""}</div>
      </div>
    `;

    container.appendChild(item);
  });
}

export function renderMessages(messages) {
  const container = document.getElementById("chat-messages");
  container.innerHTML = "";

  if (!messages || messages.length === 0) {
    container.innerHTML = `
      <div class="message-wrapper">
        <div class="message-avatar gateway">G</div>
        <div class="message-content">
          <div class="message-author">Gateway</div>
          <div class="message-text">群聊已创建，发送话题开始讨论</div>
          <div class="message-time">刚刚</div>
        </div>
      </div>
    `;
    return;
  }

  let lastTime = null;

  messages.forEach(msg => {
    const msgTime = msg.time || msg.createdAt || Date.now();
    
    if (lastTime && msgTime - lastTime > 300000) {
      const divider = document.createElement("div");
      divider.className = "time-divider";
      divider.textContent = formatTime(lastTime);
      container.appendChild(divider);
    }
    lastTime = msgTime;

    container.appendChild(createMessageRow(msg, msgTime));
  });
}

function createMessageRow(msg, time) {
  const from = msg.from || (msg.source ? msg.source.toLowerCase() : "gateway");
  const content = msg.content || "";
  const isSelf = from === "me" || from === "user";

  const wrapper = document.createElement("div");
  wrapper.className = `message-wrapper ${isSelf ? "self" : ""}`;

  wrapper.innerHTML = `
    <div class="message-avatar ${AVATAR_COLORS[from] || "gateway"}">${AVATAR_TEXT[from] || "G"}</div>
    <div class="message-content">
      ${!isSelf ? `<div class="message-author">${NAMES[from] || from}</div>` : ""}
      <div class="message-text">${escapeHtml(content)}</div>
      <div class="message-time">${formatTime(time)}</div>
    </div>
  `;

  return wrapper;
}

export function renderHistory(snapshots) {
  const container = document.getElementById("history-list");
  container.innerHTML = "";

  if (!snapshots || snapshots.length === 0) {
    container.innerHTML = '<p class="empty-tip">暂无历史</p>';
    return;
  }

  snapshots.forEach(snap => {
    const item = document.createElement("div");
    item.className = "history-item";
    item.dataset.id = snap.run.id;

    const title = snap.task?.prompt || snap.run.id;
    const time = formatTime(snap.run.startedAt);

    item.innerHTML = `
      <div class="history-title">${truncate(title, 40)}</div>
      <div class="history-meta">${snap.run.status} · ${time}</div>
    `;

    container.appendChild(item);
  });
}

export function updateProgress(stage, state, text) {
  const item = document.getElementById(`progress-${stage}`);
  if (!item) return;

  const dot = item.querySelector(".progress-dot");
  const status = item.querySelector(".progress-status");

  dot.className = `progress-dot ${state}`;
  status.textContent = text || (state === "done" ? "完成" : state === "active" ? "进行中" : "等待");
}

export function scrollToBottom(container) {
  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}

function formatTime(timestamp) {
  if (!timestamp) return "刚刚";

  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;

  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");

  if (date.toDateString() === now.toDateString()) {
    return `${h}:${m}`;
  }

  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${month}/${day} ${h}:${m}`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function truncate(text, max) {
  if (!text || text.length <= max) return text || "";
  return text.slice(0, max) + "...";
}