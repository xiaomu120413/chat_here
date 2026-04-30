import test from "node:test";
import assert from "node:assert/strict";

import { ProviderId, createProviderConfig } from "../adapters/config.js";

test("provider config defaults both agents to mock", () => {
  const config = createProviderConfig();
  assert.equal(config.codex.provider, ProviderId.MOCK);
  assert.equal(config.copilot.provider, ProviderId.MOCK);
});

test("provider config validates OpenAI settings", () => {
  const config = createProviderConfig({
    codex: {
      provider: ProviderId.OPENAI,
      apiKey: "test-key",
      model: "gpt-test",
      baseUrl: "https://api.openai.com/v1/",
    },
  });

  assert.equal(config.codex.provider, ProviderId.OPENAI);
  assert.equal(config.codex.baseUrl, "https://api.openai.com/v1");
  assert.equal(config.codex.model, "gpt-test");
});

test("provider config rejects missing OpenAI api key", () => {
  assert.throws(
    () => createProviderConfig({ codex: { provider: ProviderId.OPENAI } }),
    /openai provider requires apiKey/,
  );
});

test("provider config allows tauri OpenAI without frontend api key", () => {
  const config = createProviderConfig({
    codex: {
      provider: ProviderId.TAURI_OPENAI,
      model: "gpt-test",
    },
    copilot: {
      provider: ProviderId.TAURI_OPENAI,
      model: "gpt-test-reviewer",
    },
  });

  assert.equal(config.codex.provider, ProviderId.TAURI_OPENAI);
  assert.equal(config.codex.model, "gpt-test");
  assert.equal("apiKey" in config.codex, false);
  assert.equal(config.copilot.provider, ProviderId.TAURI_OPENAI);
  assert.equal(config.copilot.model, "gpt-test-reviewer");
  assert.equal("apiKey" in config.copilot, false);
});
