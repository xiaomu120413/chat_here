import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createStoredEvent } from "./eventRecord.js";
import { createGatewayEventRecord, createInvocationRecord } from "../schema/index.js";

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

export function createFileStore(filePath) {
  if (typeof filePath !== "string" || filePath.trim().length === 0) {
    throw new Error("fileStore requires a file path");
  }

  return {
    async saveTask(task) {
      const db = await readDb(filePath);
      db.tasks[task.id] = task;
      await writeDb(filePath, db);
      return task;
    },

    async saveRun(run) {
      const db = await readDb(filePath);
      db.runs[run.id] = run;
      await writeDb(filePath, db);
      return run;
    },

    async appendEvent(event) {
      const db = await readDb(filePath);
      const record = createStoredEvent(event);
      db.eventsByRun[record.runId] = db.eventsByRun[record.runId] ?? [];
      db.eventsByRun[record.runId].push(record);
      await writeDb(filePath, db);
      return record;
    },

    async appendMessage(message) {
      const db = await readDb(filePath);
      db.messagesByRun[message.runId] = db.messagesByRun[message.runId] ?? [];
      db.messagesByRun[message.runId].push(message);
      await writeDb(filePath, db);
      return message;
    },

    async saveDecision(decision) {
      const db = await readDb(filePath);
      db.decisions[decision.runId] = decision;
      await writeDb(filePath, db);
      return decision;
    },

    async saveThread(thread) {
      const db = await readDb(filePath);
      db.threads[thread.id] = thread;
      await writeDb(filePath, db);
      return thread;
    },

    async appendThreadMessage(message) {
      const db = await readDb(filePath);
      db.threadMessagesByThread[message.threadId] = db.threadMessagesByThread[message.threadId] ?? [];
      db.threadMessagesByThread[message.threadId].push(message);
      touchThread(db, message.threadId, message.createdAt);
      await writeDb(filePath, db);
      return message;
    },

    async appendThreadEvent(event) {
      const db = await readDb(filePath);
      const events = db.threadEventsByThread[event.threadId] ?? [];
      const record = createGatewayEventRecord({
        ...event,
        cursor: event.cursor ?? events.length + 1,
      });
      events.push(record);
      db.threadEventsByThread[record.threadId] = events;
      await writeDb(filePath, db);
      return record;
    },

    async saveInvocation(invocation) {
      const db = await readDb(filePath);
      const record = createInvocationRecord(invocation);
      db.invocations[record.id] = record;
      await writeDb(filePath, db);
      return record;
    },

    async updateInvocation(invocationId, updates) {
      const db = await readDb(filePath);
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
      await writeDb(filePath, db);
      return next;
    },

    async getTask(taskId) {
      const db = await readDb(filePath);
      return db.tasks[taskId] ?? null;
    },

    async getRun(runId) {
      const db = await readDb(filePath);
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
      const db = await readDb(filePath);
      return Object.values(db.runs).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    },

    async getThread(threadId) {
      const db = await readDb(filePath);
      return db.threads[threadId] ?? null;
    },

    async listThreads() {
      const db = await readDb(filePath);
      return Object.values(db.threads).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async getThreadSnapshot(threadId) {
      const db = await readDb(filePath);
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
      const db = await readDb(filePath);
      return db.invocations[invocationId] ?? null;
    },

    async listThreadInvocations(threadId) {
      const db = await readDb(filePath);
      return Object.values(db.invocations)
        .filter((invocation) => invocation.threadId === threadId)
        .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
    },
  };
}

async function readDb(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeDb(parsed);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return structuredClone(EMPTY_DB);
    }
    throw new Error(`failed to read file store: ${error.message}`);
  }
}

async function writeDb(filePath, db) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(normalizeDb(db), null, 2)}\n`, "utf8");
}

function normalizeDb(db) {
  return {
    tasks: db?.tasks ?? {},
    runs: db?.runs ?? {},
    eventsByRun: db?.eventsByRun ?? {},
    messagesByRun: db?.messagesByRun ?? {},
    decisions: db?.decisions ?? {},
    threads: db?.threads ?? {},
    threadMessagesByThread: db?.threadMessagesByThread ?? {},
    threadEventsByThread: db?.threadEventsByThread ?? {},
    invocations: db?.invocations ?? {},
  };
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
