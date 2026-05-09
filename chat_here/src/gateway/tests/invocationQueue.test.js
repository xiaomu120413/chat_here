import test from "node:test";
import assert from "node:assert/strict";

import { createInvocationQueue, createSessionMutex } from "../orchestrator/invocationQueue.js";

test("invocation queue processes same-thread entries in order", () => {
  const queue = createInvocationQueue();
  queue.enqueue({ id: "entry_1", threadId: "thread_1", invocationId: "inv_1", agentId: "codex" });
  queue.enqueue({ id: "entry_2", threadId: "thread_1", invocationId: "inv_2", agentId: "copilot" });
  queue.enqueue({ id: "entry_other", threadId: "thread_2", invocationId: "inv_3", agentId: "codex" });

  const first = queue.dequeueNext({ threadId: "thread_1" });
  assert.equal(first.id, "entry_1");
  assert.equal(first.status, "running");

  const second = queue.dequeueNext({ threadId: "thread_1" });
  assert.equal(second.id, "entry_2");
  assert.equal(second.status, "running");

  assert.equal(queue.dequeueNext({ threadId: "thread_1" }), null);
});

test("invocation queue honors priority for future dequeue", () => {
  const queue = createInvocationQueue();
  queue.enqueue({ id: "low", threadId: "thread_1", priority: 0 });
  queue.enqueue({ id: "high", threadId: "thread_1", priority: 10 });
  queue.enqueue({ id: "medium", threadId: "thread_1", priority: 5 });

  assert.equal(queue.dequeueNext({ threadId: "thread_1" }).id, "high");
  assert.equal(queue.dequeueNext({ threadId: "thread_1" }).id, "medium");
  assert.equal(queue.dequeueNext({ threadId: "thread_1" }).id, "low");
});

test("invocation queue can cancel queued entries", () => {
  const queue = createInvocationQueue();
  queue.enqueue({ id: "cancel_me", threadId: "thread_1" });
  queue.enqueue({ id: "run_me", threadId: "thread_1" });

  const canceled = queue.cancel("cancel_me", "user cancelled");
  assert.equal(canceled.status, "canceled");
  assert.equal(canceled.error, "user cancelled");

  assert.equal(queue.dequeueNext({ threadId: "thread_1" }).id, "run_me");
});

test("invocation queue records success and failure", () => {
  const queue = createInvocationQueue();
  queue.enqueue({ id: "success", threadId: "thread_1" });
  queue.enqueue({ id: "failure", threadId: "thread_1" });

  queue.dequeueNext({ threadId: "thread_1" });
  const succeeded = queue.complete("success");
  assert.equal(succeeded.status, "succeeded");

  queue.dequeueNext({ threadId: "thread_1" });
  const failed = queue.fail("failure", { message: "adapter failed" });
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "adapter failed");
});

test("session mutex prevents concurrent work for one key", () => {
  const mutex = createSessionMutex();

  assert.equal(mutex.acquire("thread:thread_1", "entry_1"), true);
  assert.equal(mutex.acquire("thread:thread_1", "entry_2"), false);
  assert.equal(mutex.isLocked("thread:thread_1"), true);
  assert.equal(mutex.holder("thread:thread_1"), "entry_1");
  assert.equal(mutex.release("thread:thread_1", "entry_2"), false);
  assert.equal(mutex.release("thread:thread_1", "entry_1"), true);
  assert.equal(mutex.acquire("thread:thread_1", "entry_2"), true);
});

test("session mutex allows independent agent sessions", () => {
  const mutex = createSessionMutex();

  assert.equal(mutex.acquire("agent:codex", "inv_1"), true);
  assert.equal(mutex.acquire("agent:copilot", "inv_2"), true);
  assert.equal(mutex.acquire("agent:codex", "inv_3"), false);
});
