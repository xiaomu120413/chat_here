import { createStoredEvent } from "./eventRecord.js";
import { createGatewayEventRecord, createInvocationRecord } from "../schema/index.js";

const DEFAULT_KEY = "gateway-store";

const EMPTY_DB = Object.freeze({
  tasks: {},
  runs: {},
  eventsByRun: {},
  messagesByRun: {},
  decisions: {},
  threads: {},
  threadMessagesByThread: {},
  threadEventsByThread: {},
  invocations: {},
});

export function createLocalStorageStore(key = DEFAULT_KEY) {
  return {
    async saveTask(task) {
      const db = readDb(key);
      db.tasks[task.id] = task;
      writeDb(key, db);
      return task;
    },

    async saveRun(run) {
      const db = readDb(key);
      db.runs[run.id] = run;
      writeDb(key, db);
      return run;
    },

    async appendEvent(event) {
      const db = readDb(key);
      const record = createStoredEvent(event);
      db.eventsByRun[record.runId] = db.eventsByRun[record.runId] ?? [];
      db.eventsByRun[record.runId].push(record);
      writeDb(key, db);
      return record;
    },

    async appendMessage(message) {
      const db = readDb(key);
      db.messagesByRun[message.runId] = db.messagesByRun[message.runId] ?? [];
      db.messagesByRun[message.runId].push(message);
      writeDb(key, db);
      return message;
    },

    async saveDecision(decision) {
      const db = readDb(key);
      db.decisions[decision.runId] = decision;
      writeDb(key, db);
      return decision;
    },

    async saveThread(thread) {
      const db = readDb(key);
      db.threads[thread.id] = thread;
      writeDb(key, db);
      return thread;
    },

    async appendThreadMessage(message) {
      const db = readDb(key);
      db.threadMessagesByThread[message.threadId] = db.threadMessagesByThread[message.threadId] ?? [];
      db.threadMessagesByThread[message.threadId].push(message);
      touchThread(db, message.threadId, message.createdAt);
      writeDb(key, db);
      return message;
    },

    async appendThreadEvent(event) {
      const db = readDb(key);
      const events = db.threadEventsByThread[event.threadId] ?? [];
      const record = createGatewayEventRecord({
        ...event,
        cursor: event.cursor ?? events.length + 1,
      });
      events.push(record);
      db.threadEventsByThread[record.threadId] = events;
      writeDb(key, db);
      return record;
    },

    async saveInvocation(invocation) {
      const db = readDb(key);
      const record = createInvocationRecord(invocation);
      db.invocations[record.id] = record;
      writeDb(key, db);
      return record;
    },

    async updateInvocation(invocationId, updates) {
      const db = readDb(key);
      const current = db.invocations[invocationId];
      if (!current) {
        throw new Error(`invocation not found: ${invocationId}`);
      }

      const next = createInvocationRecord({
        ...current,
        ...updates,
        id: current.id,
        threadId: current.threadId,
        agentId: updates.agentId ?? current.agentId,
        queuedAt: current.queuedAt,
      });
      db.invocations[invocationId] = next;
      writeDb(key, db);
      return next;
    },

    async getTask(taskId) {
      return readDb(key).tasks[taskId] ?? null;
    },

    async getRun(runId) {
      const db = readDb(key);
      const run = db.runs[runId] ?? null;
      if (!run) {
        return null;
      }

      return {
        task: db.tasks[run.taskId] ?? null,
        run,
        events: db.eventsByRun[runId] ?? [],
        messages: db.messagesByRun[runId] ?? [],
        decision: db.decisions[runId] ?? null,
      };
    },

    async listRuns() {
      const db = readDb(key);
      return Object.values(db.runs).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    },

    async getThread(threadId) {
      return readDb(key).threads[threadId] ?? null;
    },

    async listThreads() {
      const db = readDb(key);
      return Object.values(db.threads).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async getThreadSnapshot(threadId) {
      const db = readDb(key);
      const thread = db.threads[threadId] ?? null;
      if (!thread) {
        return null;
      }

      return {
        thread,
        messages: db.threadMessagesByThread[threadId] ?? [],
        events: db.threadEventsByThread[threadId] ?? [],
        invocations: Object.values(db.invocations)
          .filter((invocation) => invocation.threadId === threadId)
          .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt)),
      };
    },

    async getInvocation(invocationId) {
      return readDb(key).invocations[invocationId] ?? null;
    },

    async listThreadInvocations(threadId) {
      const db = readDb(key);
      return Object.values(db.invocations)
        .filter((invocation) => invocation.threadId === threadId)
        .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
    },
  };
}

function readDb(key) {
  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return structuredClone(EMPTY_DB);
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      tasks: parsed.tasks ?? {},
      runs: parsed.runs ?? {},
      eventsByRun: parsed.eventsByRun ?? {},
      messagesByRun: parsed.messagesByRun ?? {},
      decisions: parsed.decisions ?? {},
      threads: parsed.threads ?? {},
      threadMessagesByThread: parsed.threadMessagesByThread ?? {},
      threadEventsByThread: parsed.threadEventsByThread ?? {},
      invocations: parsed.invocations ?? {},
    };
  } catch {
    return structuredClone(EMPTY_DB);
  }
}

function writeDb(key, db) {
  window.localStorage.setItem(key, JSON.stringify(db));
}

function touchThread(db, threadId, updatedAt) {
  const thread = db.threads[threadId];
  if (!thread) {
    return;
  }

  db.threads[threadId] = {
    ...thread,
    updatedAt,
  };
}
