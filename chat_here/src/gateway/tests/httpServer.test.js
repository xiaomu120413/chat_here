import test from "node:test";
import assert from "node:assert/strict";

import { AgentId, createInvocationRecord, createThread } from "../schema/index.js";
import { createGatewayHttpServer } from "../http/server.js";
import { createMemoryStore } from "../store/memoryStore.js";

const TOKEN = "test-token";

test("gateway HTTP API protects thread endpoints with token auth", async () => {
  const fixture = await startFixture();
  try {
    const unauthorized = await fetch(`${fixture.url}/api/threads`);
    assert.equal(unauthorized.status, 401);

    const authorized = await fixture.fetchJson("/api/threads");
    assert.equal(authorized.status, 200);
    assert.deepEqual(authorized.body.threads, []);
  } finally {
    await fixture.stop();
  }
});

test("gateway HTTP API creates and reads thread snapshots", async () => {
  const fixture = await startFixture();
  try {
    const created = await fixture.fetchJson("/api/threads", {
      method: "POST",
      body: { title: "Mobile-ready room" },
    });

    assert.equal(created.status, 201);
    assert.equal(created.body.thread.title, "Mobile-ready room");
    assert.equal(created.body.event.type, "thread.created");

    const listed = await fixture.fetchJson("/api/threads");
    assert.deepEqual(
      listed.body.threads.map((thread) => thread.id),
      [created.body.thread.id],
    );

    const snapshot = await fixture.fetchJson(`/api/threads/${created.body.thread.id}`);
    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.body.thread.id, created.body.thread.id);
    assert.equal(snapshot.body.events.length, 1);
  } finally {
    await fixture.stop();
  }
});

test("gateway HTTP API appends messages and events to one thread", async () => {
  const fixture = await startFixture();
  try {
    const created = await fixture.fetchJson("/api/threads", {
      method: "POST",
      body: { title: "Message room" },
    });
    const threadId = created.body.thread.id;

    const message = await fixture.fetchJson(`/api/threads/${threadId}/messages`, {
      method: "POST",
      body: {
        content: "@all 讨论一下手机接入",
        targetAgents: ["codex", "copilot"],
      },
    });

    assert.equal(message.status, 201);
    assert.equal(message.body.message.threadId, threadId);
    assert.equal(message.body.event.type, "message.created");

    const events = await fixture.fetchJson(`/api/threads/${threadId}/events`);
    assert.deepEqual(
      events.body.events.map((event) => event.type),
      ["thread.created", "message.created"],
    );
  } finally {
    await fixture.stop();
  }
});

test("gateway HTTP API retries failed invocation and cancels queued invocation", async () => {
  const store = createMemoryStore();
  const thread = await store.saveThread(
    createThread({
      id: "thread_invocation_api",
      title: "Invocation API",
    }),
  );
  const failed = await store.saveInvocation(
    createInvocationRecord({
      id: "inv_failed",
      threadId: thread.id,
      agentId: AgentId.CODEX,
      status: "failed",
      triggerMessageId: "msg_user",
      error: "codex failed",
      finishedAt: "2026-05-08T09:00:00.000Z",
    }),
  );
  const queued = await store.saveInvocation(
    createInvocationRecord({
      id: "inv_queued",
      threadId: thread.id,
      agentId: AgentId.COPILOT,
      status: "queued",
    }),
  );

  const fixture = await startFixture(store);
  try {
    const retry = await fixture.fetchJson(`/api/invocations/${failed.id}/retry`, { method: "POST" });
    assert.equal(retry.status, 201);
    assert.equal(retry.body.invocation.attempt, 2);
    assert.equal(retry.body.invocation.metadata.retryOf, failed.id);

    const cancel = await fixture.fetchJson(`/api/invocations/${queued.id}/cancel`, { method: "POST" });
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.invocation.status, "canceled");
  } finally {
    await fixture.stop();
  }
});

async function startFixture(store = createMemoryStore()) {
  const server = createGatewayHttpServer({ store, token: TOKEN });
  const started = await server.start();

  return {
    url: started.url,
    stop: () => server.stop(),
    async fetchJson(path, options = {}) {
      const response = await fetch(`${started.url}${path}`, {
        method: options.method ?? "GET",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      return {
        status: response.status,
        body: await response.json(),
      };
    },
  };
}
