import { AgentId } from "../schema/index.js";
import { parseGatewayDirective } from "../adapters/gatewayDirective.js";
import { extractResponseText } from "../adapters/openAITransport.js";
import { createTauriCodexTransport } from "../adapters/tauriCodexTransport.js";
import { createTauriCopilotTransport } from "../adapters/tauriCopilotTransport.js";

export function createCodexCliAgentProvider(options = {}) {
  return createCliAgentProvider({
    id: AgentId.CODEX,
    name: "Codex",
    model: options.model,
    transport: options.transport ?? createTauriCodexTransport(options),
  });
}

export function createCopilotCliAgentProvider(options = {}) {
  return createCliAgentProvider({
    id: AgentId.COPILOT,
    name: "Copilot",
    model: options.model,
    transport: options.transport ?? createTauriCopilotTransport(options),
  });
}

export function createCliAgentProvider({ id, name, model, transport }) {
  if (!transport || typeof transport.createResponse !== "function") {
    throw new Error("CLI agent provider requires a transport");
  }
  if (typeof model !== "string" || model.trim().length === 0) {
    throw new Error("CLI agent provider requires a model");
  }

  return {
    id,
    name,
    async invoke({ contextPacket, invocation }) {
      const response = await transport.createResponse({
        model,
        input: buildProviderInput({ id, name, contextPacket, invocation }),
      });
      const parsed = parseGatewayDirective(extractResponseText(response));
      return {
        content: parsed.content,
        gatewayNext: parsed.next,
      };
    },
  };
}

function buildProviderInput({ id, name, contextPacket, invocation }) {
  return [
    {
      role: "system",
      content: [
        `You are ${name} in a live multi-agent engineering group chat.`,
        "Return only your next chat message.",
        "Be concise, natural, and technically specific.",
        "End with one control line: GATEWAY_NEXT: codex, copilot, either, or summary.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Agent: ${id}`,
        `Invocation: ${invocation?.id ?? "unknown"}`,
        "",
        contextPacket?.prompt ?? "No context packet was provided.",
      ].join("\n"),
    },
  ];
}
