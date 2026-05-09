import test from "node:test";
import assert from "node:assert/strict";

import { createGatewayEventBus, formatSseEvent } from "../http/eventBus.js";
import { createGatewayHttpServer } from "../http/server.js";
import { createMemoryStore } from "../store/memoryStore.js";

const TOKEN = "stream-token";

test("event bus formats SSE events with cursor id", () => {
  const bus = createGatewayEventBus();
  const received = [];
  const unsubscribe = bus.subscribe((event) => received.push(event));

  const envelope = bus.publish({
    id: "event_1",
    threadId: "thread_1",
    cursor: 2,
    type: "message.created",
    payload: { messageId: "msg_1" },
  });
  unsubscribe();

  assert.equal(envelope.id, "thread_1:2");
  assert.equal(received.length, 1);
  assert.match(formatSseEvent(envelope), /event: message\.created/);
});

test("gateway HTTP SSE stream receives message events", async () => {
  const server = createGatewayHttpServer({ store: createMemoryStore(), token: TOKEN });
  const started = await server.start();
  const abort = new AbortController();

  try {
    const streamResponse = await fetch(`${started.url}/api/stream`, {
      headers: { authorization: `Bearer ${TOKEN}` },
      signal: abort.signal,
    });
    assert.equal(streamResponse.status, 200);

    const reader = streamResponse.body.getReader();
    const decoder = new TextDecoder();

    const connectedChunk = decoder.decode((await reader.read()).value);
    assert.match(connectedChunk, /event: gateway\.connected/);

    const created = await postJson(started.url, "/api/threads", { title: "Stream room" });
    await postJson(started.url, `/api/threads/${created.thread.id}/messages`, {
      content: "实时看到这条消息",
    });

    const eventText = await readUntil(reader, decoder, "event: message.created");
    assert.match(eventText, /id: .*:2/);
    assert.match(eventText, /"type":"message.created"/);
  } finally {
    abort.abort();
    await server.stop();
  }
});

async function postJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  assert.ok(response.status < 300, `unexpected status ${response.status}`);
  return response.json();
}

async function readUntil(reader, decoder, needle) {
  let text = "";
  for (let index = 0; index < 8; index += 1) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    text += decoder.decode(chunk.value, { stream: true });
    if (text.includes(needle)) {
      return text;
    }
  }
  throw new Error(`SSE event not received: ${needle}`);
}
