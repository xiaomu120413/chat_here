import { createStoredEvent } from "./eventRecord.js";

export function createMemoryStore() {
  const tasks = new Map();
  const runs = new Map();
  const messagesByRun = new Map();
  const decisions = new Map();
  const eventsByRun = new Map();

  return {
    async saveTask(task) {
      tasks.set(task.id, task);
      return task;
    },

    async saveRun(run) {
      runs.set(run.id, run);
      return run;
    },

    async appendEvent(event) {
      const record = createStoredEvent(event);
      const events = eventsByRun.get(record.runId) ?? [];
      events.push(record);
      eventsByRun.set(record.runId, events);
      return record;
    },

    async appendMessage(message) {
      const messages = messagesByRun.get(message.runId) ?? [];
      messages.push(message);
      messagesByRun.set(message.runId, messages);
      return message;
    },

    async saveDecision(decision) {
      decisions.set(decision.runId, decision);
      return decision;
    },

    async getTask(taskId) {
      return tasks.get(taskId) ?? null;
    },

    async getRun(runId) {
      const run = runs.get(runId) ?? null;
      if (!run) {
        return null;
      }

      return {
        task: tasks.get(run.taskId) ?? null,
        run,
        events: [...(eventsByRun.get(runId) ?? [])],
        messages: [...(messagesByRun.get(runId) ?? [])],
        decision: decisions.get(runId) ?? null,
      };
    },

    async listRuns() {
      return [...runs.values()];
    },
  };
}
