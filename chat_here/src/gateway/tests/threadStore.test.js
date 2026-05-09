import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { AgentId, createInvocationRecord, createThread, createThreadMessage } from "../schema/index.js";
import { createFileStore } from "../store/fileStore.js";
import { createMemoryStore } from "../store/memoryStore.js";

const STORE_FACTORIES = [
  ["memory", async () => createMemoryStore()],
  [
    "file",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "gateway-thread-store-"));
      return createFileStore(join(dir, "threads.json"));
    },
  ],
];

for (const [label, createStore] of STORE_FACTORIES) {
  test(`${label} store creates thread snapshots without cross-thread leakage`, async () => {
    const store = await createStore();
    const first = await store.saveThread(
      createThread({
        id: "thread_first",
        title: "First discussion",
        createdAt: "2026-05-08T01:00:00.000Z",
      }),
    );
    const second = await store.saveThread(
      createThread({
        id: "thread_second",
        title: "Second discussion",
        createdAt: "2026-05-08T02:00:00.000Z",
      }),
    );

    await store.appendThreadMessage(
      createThreadMessage({
        id: "msg_first_user",
        threadId: first.id,
        kind: "user",
        source: { type: "human", id: "user" },
        content: "First message",
        createdAt: "2026-05-08T01:01:00.000Z",
      }),
    );
    await store.appendThreadMessage(
      createThreadMessage({
        id: "msg_second_user",
        threadId: second.id,
        kind: "user",
        source: { type: "human", id: "user" },
        content: "Second message",
        createdAt: "2026-05-08T02:01:00.000Z",
      }),
    );
    await store.appendThreadMessage(
      createThreadMessage({
        id: "msg_first_agent",
        threadId: first.id,
        kind: "agent",
        source: { type: "agent", id: "codex", name: "Codex" },
        targetAgents: ["copilot"],
        content: "First agent reply",
        createdAt: "2026-05-08T01:02:00.000Z",
      }),
    );

    const firstSnapshot = await store.getThreadSnapshot(first.id);
    const secondSnapshot = await store.getThreadSnapshot(second.id);

    assert.deepEqual(
      firstSnapshot.messages.map((message) => message.id),
      ["msg_first_user", "msg_first_agent"],
    );
    assert.deepEqual(
      secondSnapshot.messages.map((message) => message.id),
      ["msg_second_user"],
    );
  });

  test(`${label} store appends ordered thread events with stable cursors`, async () => {
    const store = await createStore();
    const thread = await store.saveThread(
      createThread({
        id: "thread_events",
        title: "Evented discussion",
        createdAt: "2026-05-08T03:00:00.000Z",
      }),
    );

    await store.appendThreadEvent({
      threadId: thread.id,
      type: "thread.created",
      payload: { threadId: thread.id },
      createdAt: "2026-05-08T03:00:00.000Z",
    });
    await store.appendThreadEvent({
      threadId: thread.id,
      type: "message.created",
      payload: { messageId: "msg_1" },
      createdAt: "2026-05-08T03:01:00.000Z",
    });

    const snapshot = await store.getThreadSnapshot(thread.id);

    assert.deepEqual(
      snapshot.events.map((event) => `${event.cursor}:${event.type}`),
      ["1:thread.created", "2:message.created"],
    );
  });

  test(`${label} store lists threads by latest activity`, async () => {
    const store = await createStore();
    const oldThread = await store.saveThread(
      createThread({
        id: "thread_old",
        title: "Old",
        createdAt: "2026-05-08T04:00:00.000Z",
      }),
    );
    const newThread = await store.saveThread(
      createThread({
        id: "thread_new",
        title: "New",
        createdAt: "2026-05-08T05:00:00.000Z",
      }),
    );

    await store.appendThreadMessage(
      createThreadMessage({
        id: "msg_old_late",
        threadId: oldThread.id,
        kind: "user",
        source: { type: "human", id: "user" },
        content: "Bump old thread",
        createdAt: "2026-05-08T06:00:00.000Z",
      }),
    );

    const threads = await store.listThreads();

    assert.deepEqual(
      threads.map((thread) => thread.id),
      [oldThread.id, newThread.id],
    );
  });

  test(`${label} store tracks invocation lifecycle inside thread snapshots`, async () => {
    const store = await createStore();
    const thread = await store.saveThread(
      createThread({
        id: "thread_invocations",
        title: "Invocation lifecycle",
        createdAt: "2026-05-08T07:00:00.000Z",
      }),
    );

    const queued = await store.saveInvocation(
      createInvocationRecord({
        id: "invocation_codex_1",
        threadId: thread.id,
        agentId: AgentId.CODEX,
        triggerMessageId: "msg_user",
        queuedAt: "2026-05-08T07:01:00.000Z",
      }),
    );
    assert.equal(queued.status, "queued");

    const running = await store.updateInvocation(queued.id, {
      status: "running",
      startedAt: "2026-05-08T07:02:00.000Z",
    });
    assert.equal(running.status, "running");

    const succeeded = await store.updateInvocation(queued.id, {
      status: "succeeded",
      outputMessageId: "msg_codex",
      finishedAt: "2026-05-08T07:03:00.000Z",
    });
    assert.equal(succeeded.status, "succeeded");
    assert.equal(succeeded.outputMessageId, "msg_codex");

    const snapshot = await store.getThreadSnapshot(thread.id);
    assert.deepEqual(
      snapshot.invocations.map((invocation) => `${invocation.agentId}:${invocation.status}`),
      ["codex:succeeded"],
    );
  });

  test(`${label} store records failed and retry invocation attempts without duplicating user messages`, async () => {
    const store = await createStore();
    const thread = await store.saveThread(
      createThread({
        id: "thread_retry",
        title: "Retry invocation",
        createdAt: "2026-05-08T08:00:00.000Z",
      }),
    );
    await store.appendThreadMessage(
      createThreadMessage({
        id: "msg_retry_user",
        threadId: thread.id,
        kind: "user",
        source: { type: "human", id: "user" },
        content: "Ask once",
        createdAt: "2026-05-08T08:01:00.000Z",
      }),
    );

    await store.saveInvocation(
      createInvocationRecord({
        id: "invocation_failed",
        threadId: thread.id,
        agentId: AgentId.COPILOT,
        triggerMessageId: "msg_retry_user",
        status: "failed",
        attempt: 1,
        error: "copilot failed",
        queuedAt: "2026-05-08T08:02:00.000Z",
        startedAt: "2026-05-08T08:02:10.000Z",
        finishedAt: "2026-05-08T08:03:00.000Z",
      }),
    );
    await store.saveInvocation(
      createInvocationRecord({
        id: "invocation_retry",
        threadId: thread.id,
        agentId: AgentId.COPILOT,
        triggerMessageId: "msg_retry_user",
        status: "queued",
        attempt: 2,
        queuedAt: "2026-05-08T08:04:00.000Z",
        metadata: { retryOf: "invocation_failed" },
      }),
    );

    const snapshot = await store.getThreadSnapshot(thread.id);
    assert.equal(snapshot.messages.length, 1);
    assert.deepEqual(
      snapshot.invocations.map((invocation) => `${invocation.id}:${invocation.attempt}:${invocation.status}`),
      ["invocation_failed:1:failed", "invocation_retry:2:queued"],
    );
  });
}
