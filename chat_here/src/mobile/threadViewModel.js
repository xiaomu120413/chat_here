export function chooseSelectedThreadId(threads, snapshots, currentThreadId = "") {
  if (!threads.length) {
    return "";
  }
  if (threads.some((thread) => thread.id === currentThreadId)) {
    return currentThreadId;
  }
  const firstWithMessages = threads.find((thread) => (snapshots.get(thread.id)?.messages ?? []).length > 0);
  return firstWithMessages?.id ?? threads[0].id;
}

export function filterThreads(threads, snapshots, query) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return threads;
  }
  return threads.filter((thread) => {
    const preview = getThreadPreview(thread, snapshots.get(thread.id), 200);
    return thread.title.toLowerCase().includes(normalizedQuery) || preview.toLowerCase().includes(normalizedQuery);
  });
}

export function getThreadPreview(_thread, snapshot, maxLength = 34) {
  const lastMessage = snapshot?.messages?.at(-1);
  return lastMessage ? compactText(lastMessage.content, maxLength) : "暂无消息";
}

export function compactText(value, maxLength) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function canSendMobileMessage(input) {
  return !getMobileSendDisabledReason(input);
}

export function getMobileSendDisabledReason(input) {
  if (input?.sending) {
    return "消息正在发送中";
  }
  if (!input?.connected) {
    return "请先连接 Gateway";
  }
  if (!input?.selectedThreadId) {
    return "请先选择一个会话";
  }
  if (!String(input?.content ?? "").trim()) {
    return "请输入消息内容";
  }
  return "";
}

export function getMobileConnectionLabel(input) {
  if (!input?.connected) {
    return "离线";
  }
  return input?.liveConnected ? "实时" : "在线";
}
