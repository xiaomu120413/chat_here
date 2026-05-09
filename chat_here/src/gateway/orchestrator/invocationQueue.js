const QUEUE_STATUS = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELED: "canceled",
});

export function createInvocationQueue() {
  const entries = [];
  let sequence = 0;

  return {
    enqueue(input) {
      assertEntryInput(input);
      const entry = {
        id: input.id ?? createId("queue"),
        threadId: input.threadId,
        invocationId: input.invocationId ?? null,
        agentId: input.agentId ?? null,
        priority: normalizePriority(input.priority),
        status: QUEUE_STATUS.QUEUED,
        createdAt: input.createdAt ?? new Date().toISOString(),
        startedAt: null,
        finishedAt: null,
        error: null,
        payload: structuredClone(input.payload ?? {}),
        sequence: sequence,
      };
      sequence += 1;
      entries.push(entry);
      return { ...entry };
    },

    dequeueNext(filter = {}) {
      const entry = selectNext(entries, filter);
      if (!entry) {
        return null;
      }

      entry.status = QUEUE_STATUS.RUNNING;
      entry.startedAt = new Date().toISOString();
      return { ...entry };
    },

    complete(entryId) {
      return finish(entries, entryId, QUEUE_STATUS.SUCCEEDED);
    },

    fail(entryId, error) {
      return finish(entries, entryId, QUEUE_STATUS.FAILED, normalizeError(error));
    },

    cancel(entryId, reason = "cancelled") {
      const entry = findEntry(entries, entryId);
      if (entry.status === QUEUE_STATUS.SUCCEEDED || entry.status === QUEUE_STATUS.FAILED) {
        return { ...entry };
      }

      entry.status = QUEUE_STATUS.CANCELED;
      entry.error = String(reason || "cancelled");
      entry.finishedAt = new Date().toISOString();
      return { ...entry };
    },

    list(filter = {}) {
      return entries
        .filter((entry) => matchesFilter(entry, filter))
        .map((entry) => ({ ...entry }));
    },

    get(entryId) {
      const entry = entries.find((candidate) => candidate.id === entryId);
      return entry ? { ...entry } : null;
    },
  };
}

export function createSessionMutex() {
  const holders = new Map();

  return {
    acquire(key, holderId) {
      assertNonEmptyString(key, "mutex key");
      assertNonEmptyString(holderId, "mutex holderId");
      if (holders.has(key)) {
        return false;
      }
      holders.set(key, holderId);
      return true;
    },

    release(key, holderId) {
      assertNonEmptyString(key, "mutex key");
      if (!holders.has(key)) {
        return true;
      }
      if (holderId && holders.get(key) !== holderId) {
        return false;
      }
      holders.delete(key);
      return true;
    },

    isLocked(key) {
      return holders.has(key);
    },

    holder(key) {
      return holders.get(key) ?? null;
    },
  };
}

function selectNext(entries, filter) {
  return entries
    .filter((entry) => entry.status === QUEUE_STATUS.QUEUED)
    .filter((entry) => matchesFilter(entry, filter))
    .sort((a, b) => b.priority - a.priority || a.sequence - b.sequence)[0] ?? null;
}

function finish(entries, entryId, status, error = null) {
  const entry = findEntry(entries, entryId);
  if (entry.status === QUEUE_STATUS.CANCELED) {
    return { ...entry };
  }

  entry.status = status;
  entry.error = error;
  entry.finishedAt = new Date().toISOString();
  return { ...entry };
}

function findEntry(entries, entryId) {
  const entry = entries.find((candidate) => candidate.id === entryId);
  if (!entry) {
    throw new Error(`queue entry not found: ${entryId}`);
  }
  return entry;
}

function matchesFilter(entry, filter) {
  if (filter.threadId && entry.threadId !== filter.threadId) {
    return false;
  }
  if (filter.agentId && entry.agentId !== filter.agentId) {
    return false;
  }
  if (filter.status && entry.status !== filter.status) {
    return false;
  }
  return true;
}

function assertEntryInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("queue entry input must be an object");
  }
  assertNonEmptyString(input.threadId, "queueEntry.threadId");
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function normalizePriority(value) {
  const priority = value ?? 0;
  if (!Number.isInteger(priority)) {
    throw new Error("queueEntry.priority must be an integer");
  }
  return priority;
}

function normalizeError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === "object" && typeof error.message === "string") {
    return error.message;
  }
  return error ? String(error) : null;
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
