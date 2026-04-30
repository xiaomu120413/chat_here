import test from "node:test";
import assert from "node:assert/strict";

import {
  AgentId,
  Capability,
  MessageKind,
  RunStatus,
  StepType,
  createAgentDescriptor,
  createDecision,
  createGatewayError,
  createMessage,
  createRun,
  createRunStep,
  createTask,
} from "../schema/index.js";

test("createTask returns normalized task", () => {
  const task = createTask({ prompt: "Build a dual agent gateway." });
  assert.equal(task.prompt, "Build a dual agent gateway.");
  assert.equal(task.requestedBy, AgentId.USER);
  assert.match(task.id, /^task_/);
});

test("createRun validates status and currentStep", () => {
  const run = createRun({ taskId: "task_1" });
  assert.equal(run.status, RunStatus.QUEUED);
  assert.equal(run.currentStep, StepType.DISPATCH);

  assert.throws(
    () => createRun({ taskId: "task_1", status: "broken" }),
    /run.status must be one of/,
  );
  assert.throws(
    () => createRun({ taskId: "task_1", currentStep: "broken_step" }),
    /run.currentStep must be one of/,
  );
});

test("createMessage requires valid source, target, content and references", () => {
  const message = createMessage({
    runId: "run_1",
    source: AgentId.CODEX,
    target: AgentId.GATEWAY,
    kind: MessageKind.DRAFT,
    goal: "draft a plan",
    content: "Initial proposal",
    references: ["task brief", "prior decision"],
  });

  assert.equal(message.kind, MessageKind.DRAFT);
  assert.equal(message.source, AgentId.CODEX);
  assert.equal(message.goal, "draft a plan");

  assert.throws(
    () =>
      createMessage({
        runId: "run_1",
        source: "ghost",
        target: AgentId.GATEWAY,
        kind: MessageKind.DRAFT,
        content: "x",
      }),
    /message.source must be one of/,
  );

  assert.throws(
    () =>
      createMessage({
        runId: "run_1",
        source: AgentId.CODEX,
        target: AgentId.GATEWAY,
        kind: MessageKind.DRAFT,
        content: "x",
        references: [""],
      }),
    /message.references\[0\] must be a non-empty string/,
  );
});

test("createDecision returns structured payload", () => {
  const decision = createDecision({
    runId: "run_1",
    summary: "Use a gateway-owned state machine.",
    openQuestions: ["Do we need multi-round?"],
    nextActions: ["Implement orchestrator"],
  });

  assert.equal(decision.runId, "run_1");
  assert.equal(decision.summary, "Use a gateway-owned state machine.");
  assert.equal(decision.openQuestions.length, 1);
  assert.equal(decision.createdAt.includes("T"), true);
});

test("createRunStep validates type and status", () => {
  const step = createRunStep({
    runId: "run_2",
    type: StepType.CODEX_DRAFT,
    status: "active",
  });

  assert.equal(step.type, StepType.CODEX_DRAFT);
  assert.equal(step.status, "active");
});

test("createAgentDescriptor normalizes capabilities", () => {
  const agent = createAgentDescriptor({
    id: AgentId.CODEX,
    name: "Codex",
    role: "drafting agent",
    capabilities: [Capability.READ_ONLY, Capability.PROPOSE_PATCH, Capability.READ_ONLY],
  });

  assert.deepEqual(agent.capabilities, [Capability.READ_ONLY, Capability.PROPOSE_PATCH]);
});

test("createGatewayError returns structured error", () => {
  const gatewayError = createGatewayError({
    code: "TIMEOUT",
    message: "adapter timed out",
    source: AgentId.COPILOT,
    retriable: true,
  });

  assert.equal(gatewayError.retriable, true);
  assert.equal(gatewayError.source, AgentId.COPILOT);
});

test("schema rejects invalid dates and round values", () => {
  assert.throws(
    () => createRun({ taskId: "task_3", startedAt: "not-a-date" }),
    /run.startedAt must be an ISO date string/,
  );
  assert.throws(
    () =>
      createMessage({
        runId: "run_3",
        source: AgentId.CODEX,
        target: AgentId.GATEWAY,
        kind: MessageKind.DRAFT,
        content: "bad round",
        round: 0,
      }),
    /message.round must be a positive integer/,
  );
});
