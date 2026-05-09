import { createStoredEvent } from "./eventRecord.js";
import { createGatewayEventRecord, createInvocationRecord } from "../schema/index.js";

export function createMemoryStore() {
  const tasks = new Map();
  const runs = new Map();
  const messagesByRun = new Map();
  const decisions = new Map();
  const eventsByRun = new Map();
  const threads = new Map();
  const threadMessages = new Map();
  const threadEvents = new Map();
  const invocations = new Map();

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

    async saveThread(thread) {
      threads.set(thread.id, thread);
      return thread;
    },

    async appendThreadMessage(message) {
      const messages = threadMessages.get(message.threadId) ?? [];
      messages.push(message);
      threadMessages.set(message.threadId, messages);
      touchThread(threads, message.threadId, message.createdAt);
      return message;
    },

    async appendThreadEvent(event) {
      const events = threadEvents.get(event.threadId) ?? [];
      const record = createGatewayEventRecord({
        ...event,
        cursor: event.cursor ?? events.length + 1,
      });
      events.push(record);
      threadEvents.set(record.threadId, events);
      return record;
    },

    async saveInvocation(invocation) {
      const record = createInvocationRecord(invocation);
      invocations.set(record.id, record);
      return record;
    },

    async updateInvocation(invocationId, updates) {
      const current = invocations.get(invocationId);
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
      invocations.set(invocationId, next);
      return next;
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

    async getThread(threadId) {
      return threads.get(threadId) ?? null;
    },

    async listThreads() {
      return [...threads.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async getThreadSnapshot(threadId) {
      const thread = threads.get(threadId) ?? null;
      if (!thread) {
        return null;
      }

      return {
        thread,
        messages: [...(threadMessages.get(threadId) ?? [])],
        events: [...(threadEvents.get(threadId) ?? [])],
        invocations: [...invocations.values()].filter((invocation) => invocation.threadId === threadId),
      };
    },

    async getInvocation(invocationId) {
      return invocations.get(invocationId) ?? null;
    },

    async listThreadInvocations(threadId) {
      return [...invocations.values()]
        .filter((invocation) => invocation.threadId === threadId)
        .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
    },
  };
}

function touchThread(threads, threadId, updatedAt) {
  const thread = threads.get(threadId);
  if (!thread) {
    return;
  }

  threads.set(threadId, {
    ...thread,
    updatedAt,
  });
}
