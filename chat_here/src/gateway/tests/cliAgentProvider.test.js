import test from "node:test";
import assert from "node:assert/strict";

import { createCliAgentProvider, createCodexCliAgentProvider } from "../providers/cliAgentProvider.js";

test("CLI agent provider invokes transport with context packet", async () => {
  const calls = [];
  const provider = createCliAgentProvider({
    id: "codex",
    name: "Codex",
    model: "gpt-5.4",
    transport: {
      async createResponse(request) {
        calls.push(request);
        return { output_text: "先保持 Gateway 常驻，然后再接 UI。\n\nGATEWAY_NEXT: copilot" };
      },
    },
  });

  const result = await provider.invoke({
    invocation: { id: "inv_1" },
    contextPacket: {
      prompt: "Thread: Gateway\nRecent messages:\nuser: 继续",
    },
  });

  assert.equal(provider.id, "codex");
  assert.equal(result.content, "先保持 Gateway 常驻，然后再接 UI。");
  assert.equal(result.gatewayNext, "copilot");
  assert.equal(calls[0].model, "gpt-5.4");
  assert.match(calls[0].input[1].content, /Thread: Gateway/);
});

test("Codex CLI provider requires a model", () => {
  assert.throws(() => createCodexCliAgentProvider({ transport: { async createResponse() {} } }), /requires a model/);
});
