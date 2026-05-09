import test from "node:test";
import assert from "node:assert/strict";

import {
  canSendMobileMessage,
  chooseSelectedThreadId,
  compactText,
  filterThreads,
  getMobileSendDisabledReason,
  getThreadPreview,
} from "../../mobile/threadViewModel.js";

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

test("mobile composer exposes actionable disabled reasons", () => {
  assert.equal(getMobileSendDisabledReason({ connected: false }), "请先连接 Gateway");
  assert.equal(getMobileSendDisabledReason({ connected: true, selectedThreadId: "" }), "请先选择一个会话");
  assert.equal(
    getMobileSendDisabledReason({ connected: true, selectedThreadId: "thread_1", content: "   " }),
    "请输入消息内容",
  );
  assert.equal(
    getMobileSendDisabledReason({
      connected: true,
      selectedThreadId: "thread_1",
      content: "hello",
      sending: true,
    }),
    "消息正在发送中",
  );
  assert.equal(
    canSendMobileMessage({ connected: true, selectedThreadId: "thread_1", content: "hello" }),
    true,
  );
});
