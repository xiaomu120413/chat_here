export function createStoredEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("event record requires an event object");
  }

  const runId = event.payload?.runId;
  if (typeof runId !== "string" || runId.trim().length === 0) {
    throw new Error("event record requires payload.runId");
  }

  return {
    id: event.id ?? createId("event"),
    runId,
    type: event.type,
    payload: event.payload,
    createdAt: event.createdAt ?? new Date().toISOString(),
  };
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
