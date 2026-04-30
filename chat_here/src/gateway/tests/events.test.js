import test from "node:test";
import assert from "node:assert/strict";

import { AgentId } from "../schema/index.js";
import {
  GatewayEvent,
  createCodexDraftReceivedEvent,
  createRunCancelledEvent,
  createRunDispatchedEvent,
  createRunFailedEvent,
} from "../state/events.js";

test("createRunDispatchedEvent emits structured event", () => {
  const event = createRunDispatchedEvent({ runId: "run_1" });
  assert.equal(event.type, GatewayEvent.RUN_DISPATCHED);
  assert.equal(event.payload.runId, "run_1");
});

test("message event enforces source", () => {
  assert.throws(
    () =>
      createCodexDraftReceivedEvent({
        runId: "run_2",
        messageId: "msg_1",
        source: AgentId.COPILOT,
      }),
    /event source must be codex/,
  );
});

test("failed and cancelled events require non-empty payload fields", () => {
  const failed = createRunFailedEvent({ runId: "run_3", error: "timeout" });
  const cancelled = createRunCancelledEvent({ runId: "run_4", reason: "user requested" });

  assert.equal(failed.type, GatewayEvent.RUN_FAILED);
  assert.equal(cancelled.type, GatewayEvent.RUN_CANCELLED);

  assert.throws(() => createRunFailedEvent({ runId: "run_3", error: "" }), /event payload requires error/);
});
