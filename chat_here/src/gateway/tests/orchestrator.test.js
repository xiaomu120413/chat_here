import test from "node:test";
import assert from "node:assert/strict";

import { createMockCodexAdapter } from "../adapters/mockCodexAdapter.js";
import { createMockCopilotAdapter } from "../adapters/mockCopilotAdapter.js";
import { AgentId, MessageKind, RunStatus } from "../schema/index.js";
import { createMemoryStore } from "../store/memoryStore.js";
import { startRun } from "../orchestrator/index.js";
import { createCancelToken } from "../orchestrator/runner.js";
import { GatewayEvent } from "../state/events.js";

test("startRun completes one mock orchestration round", async () => {
  const store = createMemoryStore();
  const result = await startRun("Design a Codex and Copilot gateway.", { store });

  assert.equal(result.run.status, RunStatus.COMPLETED);
  assert.equal(result.events.length, 5);
  assert.equal(result.messages.length, 3);
  assert.equal(result.messages[0].source, AgentId.USER);
  assert.equal(result.messages[0].kind, MessageKind.TASK);
  assert.equal(result.messages[1].source, AgentId.CODEX);
  assert.equal(result.messages[1].kind, MessageKind.DRAFT);
  assert.equal(result.messages[2].source, AgentId.COPILOT);
  assert.equal(result.messages[2].kind, MessageKind.REVIEW);
  assert.equal(result.decision.summary, "Single-round discussion completed.");

  const persisted = await store.getRun(result.run.id);
  assert.equal(persisted.run.status, RunStatus.COMPLETED);
  assert.deepEqual(
    persisted.events.map((event) => event.type),
    [
      GatewayEvent.RUN_CREATED,
      GatewayEvent.RUN_DISPATCHED,
      GatewayEvent.CODEX_DRAFT_RECEIVED,
      GatewayEvent.COPILOT_REVIEW_RECEIVED,
      GatewayEvent.SUMMARY_GENERATED,
    ],
  );
  assert.equal(persisted.messages.length, 3);
  assert.equal(persisted.decision.id, result.decision.id);
});

test("startRun can complete multiple review rounds", async () => {
  const store = createMemoryStore();
  const result = await startRun("Run two discussion rounds.", {
    store,
    maxRounds: 2,
  });

  assert.equal(result.run.status, RunStatus.COMPLETED);
  assert.equal(result.run.round, 2);
  assert.equal(result.events.length, 7);
  assert.equal(result.messages.length, 5);
  assert.deepEqual(
    result.messages.map((message) => `${message.source}:${message.kind}:r${message.round}`),
    [
      "user:task:r1",
      "codex:draft:r1",
      "copilot:review:r1",
      "codex:revision:r1",
      "copilot:review:r2",
    ],
  );
  assert.equal(result.decision.summary, "Gateway discussion completed after 2 rounds.");

  const persisted = await store.getRun(result.run.id);
  assert.equal(persisted.messages.length, 5);
  assert.equal(persisted.events.length, 7);
  assert.equal(persisted.events[4].payload.continueRun, true);
  assert.equal(persisted.run.round, 2);
});

test("startRun rejects invalid maxRounds", async () => {
  await assert.rejects(
    () =>
      startRun("Invalid rounds.", {
        maxRounds: 0,
      }),
    /maxRounds must be an integer between 1 and 5/,
  );
});

test("startRun captures Codex draft failure as failed run", async () => {
  const result = await startRun("Trigger a Codex failure.", {
    codex: createMockCodexAdapter({ behavior: { draftError: "codex unavailable" } }),
    copilot: createMockCopilotAdapter(),
  });

  assert.equal(result.run.status, RunStatus.FAILED);
  assert.equal(result.error.code, "ORCHESTRATOR_STEP_FAILED");
  assert.equal(result.error.message, "codex unavailable");
  assert.equal(result.messages.at(-1).kind, MessageKind.ERROR);
  assert.equal(result.decision, null);
});

test("startRun captures Copilot review failure after Codex draft", async () => {
  const result = await startRun("Trigger a Copilot failure.", {
    codex: createMockCodexAdapter(),
    copilot: createMockCopilotAdapter({ behavior: { reviewError: "copilot timeout" } }),
  });

  assert.equal(result.run.status, RunStatus.FAILED);
  assert.equal(result.messages[1].source, AgentId.CODEX);
  assert.equal(result.messages[1].kind, MessageKind.DRAFT);
  assert.equal(result.messages.at(-1).kind, MessageKind.ERROR);
  assert.equal(result.error.message, "copilot timeout");
});

test("memory store lists saved runs", async () => {
  const store = createMemoryStore();
  const first = await startRun("First run", { store });
  const second = await startRun("Second run", { store });
  const runs = await store.listRuns();

  assert.equal(runs.length, 2);
  assert.deepEqual(
    runs.map((run) => run.id),
    [first.run.id, second.run.id],
  );
});

test("startRun retries transient adapter failures", async () => {
  let attempts = 0;
  const codex = createMockCodexAdapter({
    behavior: {
      get draftError() {
        attempts += 1;
        return attempts === 1 ? "temporary codex failure" : "";
      },
    },
  });

  const result = await startRun("Retry transient Codex failure.", {
    codex,
    copilot: createMockCopilotAdapter(),
    retries: 1,
    stepTimeoutMs: 100,
  });

  assert.equal(result.run.status, RunStatus.COMPLETED);
  assert.equal(attempts, 2);
});

test("startRun fails when an adapter step times out", async () => {
  const result = await startRun("Timeout Copilot.", {
    codex: createMockCodexAdapter(),
    copilot: createMockCopilotAdapter({ behavior: { reviewDelayMs: 50 } }),
    stepTimeoutMs: 5,
  });

  assert.equal(result.run.status, RunStatus.FAILED);
  assert.match(result.error.message, /copilot.review timed out after 5ms/);
});

test("startRun respects a pre-cancelled token", async () => {
  const cancelToken = createCancelToken();
  cancelToken.cancel("user requested");

  const result = await startRun("Cancelled run.", {
    cancelToken,
  });

  assert.equal(result.run.status, RunStatus.FAILED);
  assert.match(result.error.message, /codex.draft cancelled: user requested/);
});

test("startRun emits progress updates while the discussion is running", async () => {
  const updates = [];

  const result = await startRun("Observe progress updates.", {
    onUpdate(snapshot) {
      updates.push({
        status: snapshot.run.status,
        messages: snapshot.messages.length,
      });
    },
  });

  assert.equal(result.run.status, RunStatus.COMPLETED);
  assert.ok(updates.length >= 4);
  assert.equal(updates[0].messages, 1);
  assert.ok(updates.some((update) => update.messages >= 2));
  assert.equal(updates.at(-1).status, RunStatus.COMPLETED);
});

test("startRun can honor a same-speaker follow-up before handing off", async () => {
  const result = await startRun("Allow Codex to continue once.", {
    codex: createMockCodexAdapter({
      behavior: {
        draftContent: "先把真实 provider 打通，这样后面的状态设计不会脱离实际。\n\nGATEWAY_NEXT: codex",
        reviseContent: "我再补一句，provider 适配层必须先把返回格式统一，不然后面实时渲染都是假象。\n\nGATEWAY_NEXT: copilot",
      },
    }),
    copilot: createMockCopilotAdapter({
      behavior: {
        reviewContent: "同意先打通 provider，不过状态事件也要同步抽象，否则 UI 还是只能整包刷新。\n\nGATEWAY_NEXT: summary",
      },
    }),
    maxRounds: 2,
  });

  assert.equal(result.run.status, RunStatus.COMPLETED);
  assert.deepEqual(
    result.messages.map((message) => `${message.source}:${message.kind}:r${message.round}`),
    [
      "user:task:r1",
      "codex:draft:r1",
      "codex:revision:r1",
      "copilot:review:r1",
    ],
  );
});
