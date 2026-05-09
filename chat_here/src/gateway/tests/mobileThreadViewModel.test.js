import test from "node:test";
import assert from "node:assert/strict";

import { chooseSelectedThreadId, compactText, filterThreads, getThreadPreview } from "../../mobile/threadViewModel.js";

test("mobile thread view model chooses the first thread with messages", () => {
  const threads = [
    { id: "empty", title: "Empty room" },
    { id: "active", title: "Active room" },
  ];
  const snapshots = new Map([
    ["empty", { messages: [] }],
    ["active", { messages: [{ content: "hello" }] }],
  ]);

  assert.equal(chooseSelectedThreadId(threads, snapshots), "active");
  assert.equal(chooseSelectedThreadId(threads, snapshots, "empty"), "empty");
});

test("mobile thread view model filters by title and latest message preview", () => {
  const threads = [
    { id: "gateway", title: "Gateway design" },
    { id: "agent", title: "Agent room" },
  ];
  const snapshots = new Map([
    ["gateway", { messages: [{ content: "SSE is live" }] }],
    ["agent", { messages: [{ content: "Codex and Copilot are discussing" }] }],
  ]);

  assert.deepEqual(filterThreads(threads, snapshots, "sse").map((thread) => thread.id), ["gateway"]);
  assert.deepEqual(filterThreads(threads, snapshots, "copilot").map((thread) => thread.id), ["agent"]);
  assert.equal(getThreadPreview(threads[0], snapshots.get("gateway")), "SSE is live");
});

test("mobile thread preview compacts whitespace and truncates text", () => {
  assert.equal(compactText("hello\n  gateway", 20), "hello gateway");
  assert.equal(compactText("123456789", 6), "12345…");
});
