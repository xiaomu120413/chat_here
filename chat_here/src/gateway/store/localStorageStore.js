import { createStoredEvent } from "./eventRecord.js";

const DEFAULT_KEY = "gateway-store";

const EMPTY_DB = Object.freeze({
  tasks: {},
  runs: {},
  eventsByRun: {},
  messagesByRun: {},
  decisions: {},
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
    };
  } catch {
    return structuredClone(EMPTY_DB);
  }
}

function writeDb(key, db) {
  window.localStorage.setItem(key, JSON.stringify(db));
}
