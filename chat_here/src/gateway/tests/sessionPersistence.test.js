import test from "node:test";
import assert from "node:assert/strict";

import { restoreSessionState, serializeSessionState } from "../../ui/sessionPersistence.js";

const MEMBERS = Object.freeze([{ id: "me", name: "Me" }]);

test("session persistence preserves gateway mapping and mirrored ids", () => {
  const raw = serializeSessionState(
    [
      {
        id: "session_1",
        name: "Mobile room",
        members: MEMBERS,
        messages: [{ id: "m1", content: "hello" }],
        gatewayThreadId: "thread_1",
        gatewayMirroredMessageIds: new Set(["m1", "summary:1"]),
        run: { status: "dispatching" },
        activeRunId: "run_1",
      },
    ],
    "session_1",
  );

  const restored = restoreSessionState(raw, {
    members: MEMBERS,
    createFallbackSession: () => ({ id: "fallback", name: "Fallback" }),
  });

  assert.equal(restored.currentSessionId, "session_1");
  assert.equal(restored.sessions[0].gatewayThreadId, "thread_1");
  assert.deepEqual(Array.from(restored.sessions[0].gatewayMirroredMessageIds), ["m1", "summary:1"]);
  assert.equal(restored.sessions[0].run, null);
  assert.equal(restored.sessions[0].activeRunId, "");
  assert.equal(restored.sessions[0].members, MEMBERS);
});

test("session persistence falls back on invalid state", () => {
  const restored = restoreSessionState("{broken", {
    members: MEMBERS,
    createFallbackSession: () => ({ id: "fallback", name: "Fallback" }),
  });

  assert.equal(restored.currentSessionId, "fallback");
  assert.equal(restored.sessions[0].name, "Fallback");
});
