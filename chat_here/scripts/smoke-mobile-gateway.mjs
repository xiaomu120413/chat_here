import assert from "node:assert/strict";

import { createGatewayHttpServer } from "../src/gateway/http/server.js";
import { createMemoryStore } from "../src/gateway/store/memoryStore.js";

const token = "mobile-smoke-token";
const server = createGatewayHttpServer({
  store: createMemoryStore(),
  token,
});

let started = null;
try {
  started = await server.start();
  const baseUrl = started.url;

  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).mobileReady, true);

  const unauthorized = await fetch(`${baseUrl}/api/threads`);
  assert.equal(unauthorized.status, 401);

  const created = await postJson(baseUrl, "/api/threads", token, {
    title: "Mobile smoke room",
    createdBy: { type: "human", id: "mobile-smoke", name: "Mobile Smoke" },
    metadata: { source: "smoke" },
  });
  assert.match(created.thread.id, /^thread_/);

  const sent = await postJson(baseUrl, `/api/threads/${created.thread.id}/messages`, token, {
    kind: "user",
    source: { type: "human", id: "mobile-smoke", name: "Mobile Smoke" },
    content: "mobile smoke message",
    dispatch: false,
  });
  assert.match(sent.message.id, /^msg_/);

  const snapshot = await getJson(baseUrl, `/api/threads/${created.thread.id}`, token);
  assert.equal(snapshot.thread.title, "Mobile smoke room");
  assert.equal(snapshot.messages.at(-1).content, "mobile smoke message");

  console.log(`mobile gateway smoke: PASS (${baseUrl})`);
} finally {
  await server.stop();
}

async function getJson(baseUrl, path, bearerToken) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  assert.ok(response.status >= 200 && response.status < 300, `GET ${path} failed with ${response.status}`);
  return response.json();
}

async function postJson(baseUrl, path, bearerToken, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  assert.ok(response.status >= 200 && response.status < 300, `POST ${path} failed with ${response.status}`);
  return response.json();
}
