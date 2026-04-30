import test from "node:test";
import assert from "node:assert/strict";

import { createCodexAdapter } from "../adapters/codexAdapter.js";
import { createCopilotAdapter } from "../adapters/copilotAdapter.js";
import { extractResponseText } from "../adapters/openAITransport.js";
import { ProviderId, createProviderConfig } from "../adapters/config.js";
import { AgentId, MessageKind, createRun, createTask } from "../schema/index.js";
import { startRun } from "../orchestrator/index.js";
import { createAdapters } from "../adapters/factory.js";

test("extractResponseText reads output_text", () => {
  assert.equal(extractResponseText({ output_text: " adapter output " }), "adapter output");
});

test("extractResponseText reads nested response output", () => {
  const text = extractResponseText({
    output: [
      {
        content: [{ text: "first" }, { text: "second" }],
      },
    ],
  });

  assert.equal(text, "first\n\nsecond");
});

test("codex adapter creates gateway message from transport response", async () => {
  const config = createProviderConfig({
    codex: {
      provider: ProviderId.OPENAI,
      apiKey: "test-key",
      model: "gpt-test",
    },
  }).codex;

  const adapter = createCodexAdapter(config, {
    transport: {
          async createResponse(request) {
            assert.equal(request.agent, AgentId.CODEX);
            assert.equal(request.model, "gpt-test");
            assert.equal(request.apiKey, "test-key");
        return { output_text: "Draft from OpenAI transport." };
      },
    },
  });

  const task = createTask({ prompt: "Build provider config." });
  const run = createRun({ taskId: task.id });
  const message = await adapter.draft({ task, run, messages: [] });

  assert.equal(message.source, AgentId.CODEX);
  assert.equal(message.kind, MessageKind.DRAFT);
  assert.equal(message.content, "Draft from OpenAI transport.");
});

test("orchestrator can use OpenAI-backed Codex through provider config", async () => {
  const result = await startRun("Use provider config.", {
    providers: {
      codex: {
        provider: ProviderId.OPENAI,
        apiKey: "test-key",
        model: "gpt-test",
      },
    },
    adapterOptions: {
      codex: {
        transport: {
          async createResponse() {
            return { output_text: "Provider configured Codex output." };
          },
        },
      },
    },
  });

  assert.equal(result.run.status, "completed");
  assert.equal(result.messages[0].content, "Use provider config.");
  assert.equal(result.messages[1].content, "Provider configured Codex output.");
  assert.equal(
    result.messages[2].content,
    "你的方向可以，但如果没有明确的失败恢复、状态持久化和契约测试，这个对话网关一上真实 CLI 就会很脆。",
  );
});

test("orchestrator can use OpenAI-backed Codex and Copilot through provider config", async () => {
  const result = await startRun("Use provider config for both agents.", {
    providers: {
      codex: {
        provider: ProviderId.OPENAI,
        apiKey: "codex-key",
        model: "codex-model",
      },
      copilot: {
        provider: ProviderId.OPENAI,
        apiKey: "copilot-key",
        model: "copilot-model",
      },
    },
    adapterOptions: {
      codex: {
        transport: {
          async createResponse(request) {
            assert.equal(request.agent, AgentId.CODEX);
            assert.equal(request.model, "codex-model");
            return { output_text: "Codex model output." };
          },
        },
      },
      copilot: {
        transport: {
          async createResponse(request) {
            assert.equal(request.agent, AgentId.COPILOT);
            assert.equal(request.model, "copilot-model");
            return { output_text: "Copilot model output." };
          },
        },
      },
    },
  });

  assert.equal(result.run.status, "completed");
  assert.equal(result.messages[0].content, "Use provider config for both agents.");
  assert.equal(result.messages[1].content, "Codex model output.");
  assert.equal(result.messages[2].content, "Copilot model output.");
});

test("factory can create Tauri OpenAI-backed Codex without frontend api key", async () => {
  const adapters = createAdapters(
    {
      codex: {
        provider: ProviderId.TAURI_OPENAI,
        model: "gpt-test",
      },
    },
    {
      codex: {
        invokeImpl: async (command, payload) => {
          assert.equal(command, "openai_response");
          assert.equal(payload.request.agent, AgentId.CODEX);
          assert.equal(payload.request.model, "gpt-test");
          assert.equal("apiKey" in payload.request, false);
          return { output_text: "Tauri backend response." };
        },
      },
    },
  );

  const task = createTask({ prompt: "Use Tauri provider." });
  const run = createRun({ taskId: task.id });
  const message = await adapters.codex.draft({ task, run, messages: [] });

  assert.equal(message.content, "Tauri backend response.");
});

test("factory can create Tauri Codex CLI-backed Codex without frontend api key", async () => {
  const adapters = createAdapters(
    {
      codex: {
        provider: ProviderId.TAURI_CODEX,
        model: "gpt-5.5",
      },
    },
    {
      codex: {
        invokeImpl: async (command, payload) => {
          assert.equal(command, "codex_exec_response");
          assert.equal(payload.request.model, "gpt-5.5");
          assert.equal("apiKey" in payload.request, false);
          return { output_text: "Codex CLI response." };
        },
      },
    },
  );

  const task = createTask({ prompt: "Use Codex CLI provider." });
  const run = createRun({ taskId: task.id });
  const message = await adapters.codex.draft({ task, run, messages: [] });

  assert.equal(message.content, "Codex CLI response.");
});

test("copilot adapter creates gateway review from transport response", async () => {
  const config = createProviderConfig({
    copilot: {
      provider: ProviderId.OPENAI,
      apiKey: "test-key",
      model: "copilot-test",
    },
  }).copilot;

  const adapter = createCopilotAdapter(config, {
    transport: {
      async createResponse(request) {
        assert.equal(request.agent, AgentId.COPILOT);
        assert.equal(request.model, "copilot-test");
        assert.equal(request.apiKey, "test-key");
        return { output_text: "Review from Copilot transport." };
      },
    },
  });

  const task = createTask({ prompt: "Review provider config." });
  const run = createRun({ taskId: task.id });
  const message = await adapter.review({ task, run, messages: [] });

  assert.equal(message.source, AgentId.COPILOT);
  assert.equal(message.kind, MessageKind.REVIEW);
  assert.equal(message.content, "Review from Copilot transport.");
});

test("factory can create Tauri Copilot CLI-backed Copilot without frontend api key", async () => {
  const adapters = createAdapters(
    {
      copilot: {
        provider: ProviderId.TAURI_COPILOT,
        model: "copilot-test",
      },
    },
    {
      copilot: {
        invokeImpl: async (command, payload) => {
          assert.equal(command, "copilot_exec_response");
          assert.equal(payload.request.model, "copilot-test");
          assert.equal("apiKey" in payload.request, false);
          return { output_text: "Tauri Copilot backend response." };
        },
      },
    },
  );

  const task = createTask({ prompt: "Use Tauri Copilot provider." });
  const run = createRun({ taskId: task.id });
  const message = await adapters.copilot.review({ task, run, messages: [] });

  assert.equal(message.source, AgentId.COPILOT);
  assert.equal(message.content, "Tauri Copilot backend response.");
});
