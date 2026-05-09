import test from "node:test";
import assert from "node:assert/strict";

import { parseMentions, routeMessage } from "../orchestrator/mentionRouter.js";

test("mention router routes @codex to Codex only", () => {
  const decision = routeMessage({ content: "@codex 先给一个实现方案" });

  assert.equal(decision.mode, "single");
  assert.deepEqual(decision.targetAgents, ["codex"]);
  assert.match(decision.reason, /Explicit mention/);
});

test("mention router routes @copilot to Copilot only", () => {
  const decision = routeMessage({ content: "@copilot 挑战一下这个方案" });

  assert.equal(decision.mode, "single");
  assert.deepEqual(decision.targetAgents, ["copilot"]);
});

test("mention router routes @all to discussion", () => {
  const decision = routeMessage({ content: "@all 自由讨论这个架构" });

  assert.equal(decision.mode, "discussion");
  assert.deepEqual(decision.targetAgents, ["codex", "copilot"]);
});

test("mention router preserves unknown mentions without crashing", () => {
  const mentions = parseMentions("@designer @codex 看一下");
  const decision = routeMessage({ content: "@designer 看一下" });

  assert.deepEqual(mentions.unknown, ["@designer"]);
  assert.equal(decision.mode, "discussion");
  assert.deepEqual(decision.mentions.unknown, ["@designer"]);
});

test("mention router uses GATEWAY_NEXT as a hint when no explicit mention exists", () => {
  const decision = routeMessage({
    content: "我补充一点。\n\nGATEWAY_NEXT: copilot",
  });

  assert.equal(decision.mode, "single");
  assert.equal(decision.gatewayHint, "copilot");
  assert.deepEqual(decision.targetAgents, ["copilot"]);
});

test("mention router lets explicit mention override GATEWAY_NEXT hint", () => {
  const decision = routeMessage({
    content: "@codex 继续。\n\nGATEWAY_NEXT: copilot",
  });

  assert.equal(decision.mode, "single");
  assert.equal(decision.gatewayHint, "copilot");
  assert.deepEqual(decision.targetAgents, ["codex"]);
});

test("mention router stops at A2A depth limit", () => {
  const decision = routeMessage(
    {
      content: "@all 继续",
      a2a: { depth: 4 },
    },
    { maxDepth: 4 },
  );

  assert.equal(decision.mode, "stop");
  assert.deepEqual(decision.targetAgents, []);
  assert.match(decision.reason, /depth limit/);
});

test("mention router treats GATEWAY_NEXT summary as stop", () => {
  const decision = routeMessage({
    content: "这个阶段可以收束。\n\nGATEWAY_NEXT: summary",
  });

  assert.equal(decision.mode, "stop");
  assert.deepEqual(decision.targetAgents, []);
  assert.equal(decision.gatewayHint, "summary");
});
