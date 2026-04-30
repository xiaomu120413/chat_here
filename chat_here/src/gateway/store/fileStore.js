import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createStoredEvent } from "./eventRecord.js";

const EMPTY_DB = Object.freeze({
  tasks: {},
  runs: {},
  eventsByRun: {},
  messagesByRun: {},
  decisions: {},
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
  };
}
