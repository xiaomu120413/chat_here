import test from "node:test";
import assert from "node:assert/strict";

import { createTauriOpenAIHealthClient, normalizeHealthResult } from "../adapters/tauriOpenAIHealth.js";

test("tauri OpenAI health client invokes backend command", async () => {
  const client = createTauriOpenAIHealthClient({
    invokeImpl: async (command) => {
      assert.equal(command, "openai_health");
      return {
        provider: "tauri_openai",
        ready: true,
        message: "OPENAI_API_KEY is set",
        agents: {
          codex: { ready: true, message: "codex ready" },
          copilot: { ready: true, message: "copilot ready" },
        },
      };
    },
  });

  assert.deepEqual(await client.check(), {
    provider: "tauri_openai",
    ready: true,
    message: "OPENAI_API_KEY is set",
    agents: {
      codex: { ready: true, message: "codex ready" },
      copilot: { ready: true, message: "copilot ready" },
    },
  });
});

test("normalizeHealthResult rejects invalid payloads", () => {
  assert.deepEqual(normalizeHealthResult(null), {
    provider: "tauri_openai",
    ready: false,
    message: "Provider health check returned an invalid payload",
    agents: {
      codex: { ready: false, message: "codex auth status is unavailable" },
      copilot: { ready: false, message: "copilot auth status is unavailable" },
    },
  });
});

test("normalizeHealthResult normalizes missing fields", () => {
  assert.deepEqual(normalizeHealthResult({ ready: false }), {
    provider: "tauri_openai",
    ready: false,
    message: "",
    agents: {
      codex: { ready: false, message: "codex auth status is unavailable" },
      copilot: { ready: false, message: "copilot auth status is unavailable" },
    },
  });
});

test("normalizeHealthResult preserves per-agent auth status", () => {
  assert.deepEqual(
    normalizeHealthResult({
      provider: "tauri_openai",
      ready: false,
      message: "partial",
      agents: {
        codex: { ready: true, message: "codex ready" },
        copilot: { ready: false, message: "copilot missing" },
      },
    }),
    {
      provider: "tauri_openai",
      ready: false,
      message: "partial",
      agents: {
        codex: { ready: true, message: "codex ready" },
        copilot: { ready: false, message: "copilot missing" },
      },
    },
  );
});
