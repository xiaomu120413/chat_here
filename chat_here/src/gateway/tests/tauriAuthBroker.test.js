import test from "node:test";
import assert from "node:assert/strict";

import { AuthAgent, createTauriAuthBroker } from "../auth/tauriAuthBroker.js";

test("tauri auth broker starts Codex auth through backend command", async () => {
  const broker = createTauriAuthBroker({
    invokeImpl: async (command, payload) => {
      assert.equal(command, "start_agent_auth");
      assert.deepEqual(payload, { request: { agent: AuthAgent.CODEX } });
      return {
        agent: AuthAgent.CODEX,
        started: true,
        message: "started codex login",
      };
    },
  });

  assert.deepEqual(await broker.start(AuthAgent.CODEX), {
    agent: AuthAgent.CODEX,
    started: true,
    message: "started codex login",
  });
});
