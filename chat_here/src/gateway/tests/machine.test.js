import test from "node:test";
import assert from "node:assert/strict";

import { RunStatus, createRun } from "../schema/index.js";
import {
  GatewayEvent,
  createCodexDraftReceivedEvent,
  createCodexRevisionReceivedEvent,
  createCopilotReviewReceivedEvent,
  createRunCancelledEvent,
  createRunCreatedEvent,
  createRunDispatchedEvent,
  createRunFailedEvent,
  createSummaryGeneratedEvent,
} from "../state/events.js";
import { TRANSITIONS, canTransition, getAllowedEvents, transition } from "../state/machine.js";

test("state machine follows happy path", () => {
  let run = createRun({ taskId: "task_happy" });

  run = transition(run, createRunCreatedEvent({ runId: run.id }));
  assert.equal(run.status, RunStatus.DISPATCHING);

  run = transition(run, createRunDispatchedEvent({ runId: run.id }));
  assert.equal(run.status, RunStatus.AWAITING_CODEX);

  run = transition(
    run,
    createCodexDraftReceivedEvent({
      runId: run.id,
      messageId: "msg_1",
      source: "codex",
    }),
  );
  assert.equal(run.status, RunStatus.AWAITING_COPILOT);

  run = transition(
    run,
    createCopilotReviewReceivedEvent({
      runId: run.id,
      messageId: "msg_2",
      source: "copilot",
    }),
  );
  assert.equal(run.status, RunStatus.REVISING);

  run = transition(
    run,
    createCodexRevisionReceivedEvent({
      runId: run.id,
      messageId: "msg_3",
      source: "codex",
    }),
  );
  assert.equal(run.status, RunStatus.SUMMARIZING);

  run = transition(run, createSummaryGeneratedEvent({ runId: run.id, decisionId: "decision_1" }));
  assert.equal(run.status, RunStatus.COMPLETED);
  assert.notEqual(run.finishedAt, null);
});

test("state machine can continue after a Codex revision", () => {
  let run = createRun({ taskId: "task_continue" });
  run = transition(run, createRunCreatedEvent({ runId: run.id }));
  run = transition(run, createRunDispatchedEvent({ runId: run.id }));
  run = transition(
    run,
    createCodexDraftReceivedEvent({
      runId: run.id,
      messageId: "msg_1",
      source: "codex",
    }),
  );
  run = transition(
    run,
    createCopilotReviewReceivedEvent({
      runId: run.id,
      messageId: "msg_2",
      source: "copilot",
    }),
  );
  run = transition(
    run,
    createCodexRevisionReceivedEvent({
      runId: run.id,
      messageId: "msg_3",
      source: "codex",
      continueRun: true,
    }),
  );

  assert.equal(run.status, RunStatus.AWAITING_COPILOT);
  assert.equal(run.round, 2);
  assert.equal(run.currentStep, "copilot_review");
});

test("canTransition and allowed events reflect legal moves", () => {
  assert.equal(canTransition(RunStatus.AWAITING_CODEX, GatewayEvent.CODEX_DRAFT_RECEIVED), true);
  assert.equal(canTransition(RunStatus.AWAITING_CODEX, GatewayEvent.SUMMARY_GENERATED), false);
  assert.deepEqual(getAllowedEvents(RunStatus.QUEUED), [GatewayEvent.RUN_CREATED]);
});

test("failure transition captures error", () => {
  let run = createRun({ taskId: "task_fail" });
  run = transition(run, createRunCreatedEvent({ runId: run.id }));
  run = transition(run, createRunDispatchedEvent({ runId: run.id }));
  run = transition(run, createRunFailedEvent({ runId: run.id, error: "adapter timeout" }));

  assert.equal(run.status, RunStatus.FAILED);
  assert.equal(run.error, "adapter timeout");
  assert.notEqual(run.finishedAt, null);
});

test("cancel transition is supported from waiting states", () => {
  let run = createRun({ taskId: "task_cancel" });
  run = transition(run, createRunCreatedEvent({ runId: run.id }));
  run = transition(run, createRunDispatchedEvent({ runId: run.id }));
  run = transition(run, createRunCancelledEvent({ runId: run.id, reason: "user requested" }));

  assert.equal(run.status, RunStatus.CANCELLED);
  assert.notEqual(run.finishedAt, null);
});

test("terminal states reject new transitions", () => {
  const completed = createRun({
    taskId: "task_done",
    status: RunStatus.COMPLETED,
    finishedAt: new Date().toISOString(),
  });

  assert.throws(
    () => transition(completed, createRunCreatedEvent({ runId: completed.id })),
    /illegal transition/,
  );
});

test("idle state rejects work events", () => {
  const idle = createRun({
    taskId: "task_idle",
    status: RunStatus.IDLE,
  });

  assert.throws(
    () => transition(idle, createRunCreatedEvent({ runId: idle.id })),
    /illegal transition/,
  );
});

test("transition table has expected lifecycle anchors", () => {
  assert.equal(typeof TRANSITIONS[RunStatus.QUEUED][GatewayEvent.RUN_CREATED], "object");
  assert.equal(typeof TRANSITIONS[RunStatus.SUMMARIZING][GatewayEvent.SUMMARY_GENERATED], "object");
});
