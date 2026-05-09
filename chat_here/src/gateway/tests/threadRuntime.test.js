import test from "node:test";
import assert from "node:assert/strict";

import { createThread, createThreadMessage } from "../schema/index.js";
import { createThreadDiscussionRuntime } from "../orchestrator/threadRuntime.js";
import { createGatewayHttpServer } from "../http/server.js";
import { createMemoryStore } from "../store/memoryStore.js";

const TOKEN = "runtime-token";

test("thread runtime routes @codex and records invocation lifecycle", async () => {
  const store = createMemoryStore();
  const thread = await store.saveThread(createThread({ id: "thread_runtime_codex", title: "Runtime" }));
  const userMessage = await store.appendThreadMessage(
    createThreadMessage({
      id: "msg_user_codex",
      threadId: thread.id,
      kind: "user",
      source: { type: "human", id: "user" },
      content: "@codex 给一个方案",
    }),
  );
  const runtime = createThreadDiscussionRuntime({
    store,
    providers: {
      codex: {
        name: "Codex",
        async invoke() {
          return "Codex response";
        },
      },
    },
  });

  const result = await runtime.handleUserMessage(userMessage);
  const snapshot = await store.getThreadSnapshot(thread.id);

  assert.deepEqual(result.routing.targetAgents, ["codex"]);
  assert.deepEqual(
    snapshot.invocations.map((invocation) => `${invocation.agentId}:${invocation.status}`),
    ["codex:succeeded"],
  );
  assert.equal(snapshot.messages.at(-1).content, "Codex response");
});

test("thread runtime routes @all through both providers sequentially", async () => {
  const store = createMemoryStore();
  const thread = await store.saveThread(createThread({ id: "thread_runtime_all", title: "Runtime all" }));
  const userMessage = await store.appendThreadMessage(
    createThreadMessage({
      id: "msg_user_all",
      threadId: thread.id,
      kind: "user",
      source: { type: "human", id: "user" },
      content: "@all 自由讨论",
    }),
  );
  const runtime = createThreadDiscussionRuntime({
    store,
    providers: {
      codex: {
        name: "Codex",
        async invoke() {
          return "Codex says yes";
        },
      },
      copilot: {
        name: "Copilot",
        async invoke() {
          return "Copilot challenges";
        },
      },
    },
  });

  await runtime.handleUserMessage(userMessage);
  const snapshot = await store.getThreadSnapshot(thread.id);

  assert.deepEqual(
    snapshot.messages.map((message) => message.content),
    ["@all 自由讨论", "Codex says yes", "Copilot challenges"],
  );
  assert.deepEqual(
    snapshot.events.map((event) => event.type),
    [
      "routing.decided",
      "invocation.queued",
      "invocation.queued",
      "invocation.running",
      "message.created",
      "invocation.succeeded",
      "invocation.running",
      "message.created",
      "invocation.succeeded",
    ],
  );
});

test("thread runtime records failed invocation without creating agent message", async () => {
  const store = createMemoryStore();
  const thread = await store.saveThread(createThread({ id: "thread_runtime_fail", title: "Runtime fail" }));
  const userMessage = await store.appendThreadMessage(
    createThreadMessage({
      id: "msg_user_fail",
      threadId: thread.id,
      kind: "user",
      source: { type: "human", id: "user" },
      content: "@copilot 试一下",
    }),
  );
  const runtime = createThreadDiscussionRuntime({
    store,
    providers: {
      copilot: {
        async invoke() {
          throw new Error("copilot unavailable");
        },
      },
    },
  });

  await runtime.handleUserMessage(userMessage);
  const snapshot = await store.getThreadSnapshot(thread.id);

  assert.equal(snapshot.messages.length, 1);
  assert.equal(snapshot.invocations[0].status, "failed");
  assert.equal(snapshot.invocations[0].error, "copilot unavailable");
});

test("HTTP message endpoint can dispatch through thread runtime", async () => {
  const store = createMemoryStore();
  const thread = await store.saveThread(createThread({ id: "thread_runtime_http", title: "Runtime HTTP" }));
  const runtime = createThreadDiscussionRuntime({
    store,
    providers: {
      codex: {
        name: "Codex",
        async invoke({ contextPacket }) {
          assert.equal(contextPacket.threadId, thread.id);
          return { content: "HTTP Codex response" };
        },
      },
    },
  });
  const server = createGatewayHttpServer({ store, token: TOKEN, runtime });
  const started = await server.start();

  try {
    const response = await fetch(`${started.url}/api/threads/${thread.id}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ content: "@codex 通过 API 调度" }),
    });
    const body = await response.json();
    const snapshot = await store.getThreadSnapshot(thread.id);

    assert.equal(response.status, 201);
    assert.deepEqual(body.dispatch.routing.targetAgents, ["codex"]);
    assert.equal(snapshot.messages.at(-1).content, "HTTP Codex response");
  } finally {
    await server.stop();
  }
});

test("thread runtime can continue discussion from agent gateway hints", async () => {
  const store = createMemoryStore();
  const thread = await store.saveThread(createThread({ id: "thread_runtime_continue", title: "Continue" }));
  const userMessage = await store.appendThreadMessage(
    createThreadMessage({
      id: "msg_user_continue",
      threadId: thread.id,
      kind: "user",
      source: { type: "human", id: "user" },
      content: "@codex 开始自由讨论",
    }),
  );
  const runtime = createThreadDiscussionRuntime({
    store,
    autoContinue: true,
    maxAutoTurns: 3,
    providers: {
      codex: {
        name: "Codex",
        async invoke() {
          return { content: "先让 Gateway 常驻。", gatewayNext: "copilot" };
        },
      },
      copilot: {
        name: "Copilot",
        async invoke() {
          return { content: "同意，但下一步应该收束。", gatewayNext: "summary" };
        },
      },
    },
  });

  await runtime.handleUserMessage(userMessage);
  const snapshot = await store.getThreadSnapshot(thread.id);

  assert.deepEqual(
    snapshot.messages.map((message) => `${message.source.id}:${message.content}`),
    [
      "user:@codex 开始自由讨论",
      "codex:先让 Gateway 常驻。",
      "copilot:同意，但下一步应该收束。",
    ],
  );
  assert.deepEqual(
    snapshot.invocations.map((invocation) => `${invocation.agentId}:${invocation.status}`),
    ["codex:succeeded", "copilot:succeeded"],
  );
  assert.equal(snapshot.events.at(-1).payload.mode, "stop");
});

test("thread runtime auto continuation chooses the other agent for either", async () => {
  const store = createMemoryStore();
  const thread = await store.saveThread(createThread({ id: "thread_runtime_either", title: "Either" }));
  const userMessage = await store.appendThreadMessage(
    createThreadMessage({
      id: "msg_user_either",
      threadId: thread.id,
      kind: "user",
      source: { type: "human", id: "user" },
      content: "@codex 开始",
    }),
  );
  const runtime = createThreadDiscussionRuntime({
    store,
    autoContinue: true,
    maxAutoTurns: 1,
    providers: {
      codex: {
        name: "Codex",
        async invoke() {
          return { content: "我先说一个方向。", gatewayNext: "either" };
        },
      },
      copilot: {
        name: "Copilot",
        async invoke() {
          return { content: "我补一个风险。", gatewayNext: "summary" };
        },
      },
    },
  });

  await runtime.handleUserMessage(userMessage);
  const snapshot = await store.getThreadSnapshot(thread.id);

  assert.deepEqual(
    snapshot.invocations.map((invocation) => invocation.agentId),
    ["codex", "copilot"],
  );
});
