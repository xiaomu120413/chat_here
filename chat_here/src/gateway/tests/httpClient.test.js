import test from "node:test";
import assert from "node:assert/strict";

import { createGatewayApiClient, createGatewayEventStream } from "../http/client.js";
import { createGatewayHttpServer } from "../http/server.js";
import { createMemoryStore } from "../store/memoryStore.js";

const TOKEN = "client-token";

test("gateway API client reads health and thread snapshots", async () => {
  const server = createGatewayHttpServer({ store: createMemoryStore(), token: TOKEN });
  const started = await server.start();
  const client = createGatewayApiClient({ baseUrl: started.url, token: TOKEN });

  try {
    const health = await client.health();
    assert.equal(health.ok, true);

    const created = await client.createThread({ title: "Client room" });
    const listed = await client.listThreads();
    const snapshot = await client.getThread(created.thread.id);

    assert.deepEqual(listed.threads.map((thread) => thread.id), [created.thread.id]);
    assert.equal(snapshot.thread.title, "Client room");
  } finally {
    await server.stop();
  }
});

test("gateway API client sends messages with token auth", async () => {
  const server = createGatewayHttpServer({ store: createMemoryStore(), token: TOKEN });
  const started = await server.start();
  const client = createGatewayApiClient({ baseUrl: started.url, token: TOKEN });

  try {
    const created = await client.createThread({ title: "Send room" });
    const sent = await client.sendMessage(created.thread.id, {
      kind: "agent",
      source: { type: "agent", id: "codex", name: "Codex" },
      content: "@codex hello",
      dispatch: false,
    });

    assert.equal(sent.message.content, "@codex hello");
    assert.deepEqual(sent.message.source, { type: "agent", id: "codex", name: "Codex" });
    assert.equal(sent.dispatch, null);
  } finally {
    await server.stop();
  }
});

test("gateway API client surfaces server errors", async () => {
  const server = createGatewayHttpServer({ store: createMemoryStore(), token: TOKEN });
  const started = await server.start();
  const client = createGatewayApiClient({ baseUrl: started.url, token: "wrong" });

  try {
    await assert.rejects(() => client.listThreads(), /missing or invalid gateway token/);
  } finally {
    await server.stop();
  }
});

test("gateway API client passes an abort signal for request timeouts", async () => {
  let capturedSignal = null;
  const client = createGatewayApiClient({
    baseUrl: "http://127.0.0.1:17321",
    token: TOKEN,
    timeoutMs: 50,
    fetchImpl: async (_url, init) => {
      capturedSignal = init.signal;
      return {
        ok: true,
        async json() {
          return { threads: [] };
        },
      };
    },
  });

  await client.listThreads();

  assert.ok(capturedSignal instanceof AbortSignal);
  assert.equal(capturedSignal.aborted, false);
});

test("gateway API client normalizes aborts into timeout errors", async () => {
  const client = createGatewayApiClient({
    baseUrl: "http://127.0.0.1:17321",
    token: TOKEN,
    timeoutMs: 50,
    fetchImpl: async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    },
  });

  await assert.rejects(() => client.listThreads(), /Gateway request timed out/);
});

test("gateway event stream appends token as query param", () => {
  const created = [];
  class FakeEventSource {
    constructor(url) {
      this.url = url;
      created.push(url);
    }
  }

  const stream = createGatewayEventStream({
    baseUrl: "http://127.0.0.1:17321/",
    token: TOKEN,
    EventSourceImpl: FakeEventSource,
  });

  assert.equal(stream.url, created[0]);
  assert.equal(new URL(stream.url).searchParams.get("token"), TOKEN);
});
