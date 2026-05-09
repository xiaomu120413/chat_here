import test from "node:test";
import assert from "node:assert/strict";

import {
  AgentId,
  createInvocationRecord,
  createThread,
  createThreadMessage,
} from "../schema/index.js";
import { assembleContextPacket } from "../orchestrator/contextAssembler.js";
import { createGatewayHttpServer } from "../http/server.js";
import { createMemoryStore } from "../store/memoryStore.js";

const TOKEN = "context-token";

test("context packet keeps recent burst and injects summary questions", async () => {
  const snapshot = await buildLongSnapshot();
  const packet = assembleContextPacket(snapshot, { recentLimit: 3 });

  assert.equal(packet.recentMessages.length, 3);
  assert.deepEqual(
    packet.recentMessages.map((message) => message.id),
    ["msg_7", "msg_8", "msg_9"],
  );
  assert.equal(packet.summary, "已经决定 PC host gateway，手机走浏览器。");
  assert.deepEqual(packet.openQuestions, ["局域网 token 怎么展示？"]);
  assert.match(packet.prompt, /Summary:/);
  assert.match(packet.prompt, /Open questions:/);
});

test("context packet excludes outputs from failed or canceled invocations", async () => {
  const snapshot = await buildLongSnapshot();
  snapshot.invocations.push(
    createInvocationRecord({
      id: "inv_failed_context",
      threadId: snapshot.thread.id,
      agentId: AgentId.CODEX,
      status: "failed",
      outputMessageId: "msg_8",
      error: "bad output",
    }),
    createInvocationRecord({
      id: "inv_canceled_context",
      threadId: snapshot.thread.id,
      agentId: AgentId.COPILOT,
      status: "canceled",
      outputMessageId: "msg_9",
    }),
  );

  const packet = assembleContextPacket(snapshot, { recentLimit: 8 });

  assert.deepEqual(packet.excludedMessageIds, ["msg_8", "msg_9"]);
  assert.equal(packet.recentMessages.some((message) => message.id === "msg_8"), false);
  assert.equal(packet.recentMessages.some((message) => message.id === "msg_9"), false);
});

test("HTTP diagnostics exposes context packet for a thread", async () => {
  const store = createMemoryStore();
  const snapshot = await buildLongSnapshot(store);
  const server = createGatewayHttpServer({ store, token: TOKEN });
  const started = await server.start();

  try {
    const response = await fetch(
      `${started.url}/api/threads/${snapshot.thread.id}/context-packet?recentLimit=2`,
      {
        headers: { authorization: `Bearer ${TOKEN}` },
      },
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.contextPacket.recentMessages.length, 2);
    assert.equal(body.contextPacket.threadId, snapshot.thread.id);
  } finally {
    await server.stop();
  }
});

async function buildLongSnapshot(store = createMemoryStore()) {
  const thread = await store.saveThread(
    createThread({
      id: "thread_context",
      title: "Context packet",
      metadata: {
        summary: "已经决定 PC host gateway，手机走浏览器。",
        openQuestions: ["局域网 token 怎么展示？"],
      },
    }),
  );

  for (let index = 1; index <= 9; index += 1) {
    await store.appendThreadMessage(
      createThreadMessage({
        id: `msg_${index}`,
        threadId: thread.id,
        kind: index % 2 === 0 ? "agent" : "user",
        source:
          index % 2 === 0
            ? { type: "agent", id: AgentId.CODEX, name: "Codex" }
            : { type: "human", id: AgentId.USER, name: "Mu" },
        content: `message ${index}`,
      }),
    );
  }

  return store.getThreadSnapshot(thread.id);
}
