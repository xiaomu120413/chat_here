import { AgentId, createGatewayEventRecord, createInvocationRecord, createThreadMessage } from "../schema/index.js";
import { assembleContextPacket } from "./contextAssembler.js";
import { createInvocationQueue, createSessionMutex } from "./invocationQueue.js";
import { routeMessage } from "./mentionRouter.js";

export function createThreadDiscussionRuntime(options) {
  if (!options?.store) {
    throw new Error("thread runtime requires a store");
  }
  const store = options.store;
  const providers = options.providers ?? {};
  const queue = options.queue ?? createInvocationQueue();
  const mutex = options.mutex ?? createSessionMutex();
  const eventBus = options.eventBus ?? null;
  const maxDepth = options.maxDepth ?? 4;
  const autoContinue = Boolean(options.autoContinue);
  const maxAutoTurns = normalizePositiveInteger(options.maxAutoTurns ?? maxDepth * 2, "maxAutoTurns");
  let autoTurns = 0;

  return {
    async handleUserMessage(message) {
      const routing = routeMessage(
        {
          content: message.content,
          a2a: message.a2a,
        },
        { maxDepth },
      );

      await appendEvent(store, eventBus, {
        threadId: message.threadId,
        type: "routing.decided",
        payload: {
          messageId: message.id,
          mode: routing.mode,
          targetAgents: routing.targetAgents,
          reason: routing.reason,
        },
      });

      if (routing.mode === "stop") {
        return { routing, invocations: [] };
      }

      const invocations = await enqueueRouting(message, routing);

      await drainThread(message.threadId);
      return { routing, invocations };
    },

    async drainThread(threadId) {
      return drainThread(threadId);
    },
  };

  async function drainThread(threadId) {
    const completed = [];
    let entry = queue.dequeueNext({ threadId });
    while (entry) {
      completed.push(await executeEntry(entry));
      entry = queue.dequeueNext({ threadId });
    }
    return completed;
  }

  async function executeEntry(entry) {
    const threadLock = `thread:${entry.threadId}`;
    const agentLock = `agent:${entry.agentId}`;
    if (!mutex.acquire(threadLock, entry.id)) {
      queue.fail(entry.id, "thread is already running");
      return null;
    }
    if (!mutex.acquire(agentLock, entry.id)) {
      mutex.release(threadLock, entry.id);
      queue.fail(entry.id, "agent session is already running");
      return null;
    }

    try {
      const running = await store.updateInvocation(entry.invocationId, {
        status: "running",
        startedAt: new Date().toISOString(),
      });
      await appendEvent(store, eventBus, {
        threadId: entry.threadId,
        type: "invocation.running",
        payload: { invocationId: running.id, agentId: running.agentId },
      });

      const provider = providers[entry.agentId];
      if (!provider || typeof provider.invoke !== "function") {
        throw new Error(`missing provider for ${entry.agentId}`);
      }

      const snapshot = await store.getThreadSnapshot(entry.threadId);
      const contextPacket = assembleContextPacket(snapshot);
      const output = await provider.invoke({
        agentId: entry.agentId,
        invocation: running,
        contextPacket,
        snapshot,
      });
      const normalizedOutput = normalizeProviderOutput(output);
      const message = await store.appendThreadMessage(
        createThreadMessage({
          threadId: entry.threadId,
          kind: "agent",
          source: { type: "agent", id: entry.agentId, name: provider.name ?? entry.agentId },
          targetAgents: [],
          content: normalizedOutput.content,
          metadata: { invocationId: running.id, gatewayNext: normalizedOutput.gatewayNext },
          a2a: { depth: (snapshot.messages.at(-1)?.a2a?.depth ?? 0) + 1 },
        }),
      );
      await appendEvent(store, eventBus, {
        threadId: entry.threadId,
        type: "message.created",
        payload: { messageId: message.id, source: message.source, invocationId: running.id },
      });

      const succeeded = await store.updateInvocation(entry.invocationId, {
        status: "succeeded",
        outputMessageId: message.id,
        finishedAt: new Date().toISOString(),
      });
      queue.complete(entry.id);
      await appendEvent(store, eventBus, {
        threadId: entry.threadId,
        type: "invocation.succeeded",
        payload: { invocationId: succeeded.id, outputMessageId: message.id },
      });

      if (autoContinue && autoTurns < maxAutoTurns) {
        await enqueueContinuation(message);
      }

      return succeeded;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = await store.updateInvocation(entry.invocationId, {
        status: "failed",
        error: message,
        finishedAt: new Date().toISOString(),
      });
      queue.fail(entry.id, message);
      await appendEvent(store, eventBus, {
        threadId: entry.threadId,
        type: "invocation.failed",
        payload: { invocationId: failed.id, error: message },
      });
      return failed;
    } finally {
      mutex.release(agentLock, entry.id);
      mutex.release(threadLock, entry.id);
    }
  }

  async function enqueueRouting(message, routing) {
    const invocations = [];
    for (const agentId of routing.targetAgents) {
      const invocation = await store.saveInvocation(
        createInvocationRecord({
          threadId: message.threadId,
          agentId,
          triggerMessageId: message.id,
          reason: routing.reason,
          metadata: { routing },
        }),
      );
      invocations.push(invocation);
      queue.enqueue({
        threadId: message.threadId,
        invocationId: invocation.id,
        agentId,
        priority: routing.mode === "single" ? 1 : 0,
      });
      await appendEvent(store, eventBus, {
        threadId: message.threadId,
        type: "invocation.queued",
        payload: { invocationId: invocation.id, agentId },
      });
    }
    return invocations;
  }

  async function enqueueContinuation(message) {
    autoTurns += 1;
    const routing = routeMessage(
      {
        content: message.content,
        a2a: message.a2a,
        gatewayHint: message.metadata?.gatewayNext,
      },
      { maxDepth },
    );
    const normalizedRouting = normalizeAgentContinuation(message, routing);
    await appendEvent(store, eventBus, {
      threadId: message.threadId,
      type: "routing.decided",
      payload: {
        messageId: message.id,
        mode: normalizedRouting.mode,
        targetAgents: normalizedRouting.targetAgents,
        reason: normalizedRouting.reason,
      },
    });

    if (normalizedRouting.mode === "stop") {
      return [];
    }

    return enqueueRouting(message, normalizedRouting);
  }
}

async function appendEvent(store, eventBus, input) {
  const event = await store.appendThreadEvent(createGatewayEventRecord(input));
  eventBus?.publish(event);
  return event;
}

function normalizeProviderOutput(output) {
  if (typeof output === "string" && output.trim()) {
    return { content: output.trim(), gatewayNext: "" };
  }
  if (output && typeof output === "object" && typeof output.content === "string" && output.content.trim()) {
    return {
      content: output.content.trim(),
      gatewayNext: typeof output.gatewayNext === "string" ? output.gatewayNext.trim() : "",
    };
  }
  throw new Error("provider output must include non-empty content");
}

function normalizeAgentContinuation(message, routing) {
  if (routing.mode === "discussion" && routing.gatewayHint === "either") {
    const currentAgent = message.source?.id;
    const nextAgent = currentAgent === AgentId.CODEX ? AgentId.COPILOT : AgentId.CODEX;
    return {
      ...routing,
      mode: "single",
      targetAgents: [nextAgent],
      reason: "Agent message had no explicit next speaker; continuing with the other agent.",
    };
  }
  return routing;
}

function normalizePositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return number;
}
