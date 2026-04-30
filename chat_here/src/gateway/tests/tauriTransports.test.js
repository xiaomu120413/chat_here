import test from "node:test";
import assert from "node:assert/strict";

import { createTauriOpenAIResponsesTransport, normalizeInvokeError } from "../adapters/tauriOpenAITransport.js";
import { createTauriCodexTransport } from "../adapters/tauriCodexTransport.js";
import { createTauriCopilotTransport } from "../adapters/tauriCopilotTransport.js";

test("normalizeInvokeError preserves Error instances", () => {
  const error = new Error("boom");
  assert.equal(normalizeInvokeError(error), error);
});

test("tauri OpenAI transport normalizes backend object errors", async () => {
  const transport = createTauriOpenAIResponsesTransport({
    invokeImpl: async () => {
      throw { message: "backend exploded" };
    },
  });

  await assert.rejects(
    () => transport.createResponse({ agent: "codex", baseUrl: "https://example.com", model: "gpt-test", input: "hello" }),
    /backend exploded/,
  );
});

test("tauri Codex transport normalizes backend object errors", async () => {
  const transport = createTauriCodexTransport({
    invokeImpl: async () => {
      throw { message: "codex failed" };
    },
  });

  await assert.rejects(() => transport.createResponse({ model: "gpt-5.4", input: "hello" }), /codex failed/);
});

test("tauri Copilot transport normalizes backend object errors", async () => {
  const transport = createTauriCopilotTransport({
    invokeImpl: async () => {
      throw { message: "copilot failed" };
    },
  });

  await assert.rejects(() => transport.createResponse({ model: "gpt-5.4-mini", input: "hello" }), /copilot failed/);
});
