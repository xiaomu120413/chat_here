import { AgentId, MessageKind, createMessage } from "../schema/index.js";
import { createOpenAIResponsesTransport, extractResponseText } from "./openAITransport.js";
import { parseGatewayDirective } from "./gatewayDirective.js";

export function createCopilotAdapter(config, options = {}) {
  const transport = options.transport ?? createOpenAIResponsesTransport(options);

  return {
    async draft(context) {
      return createCopilotMessage({
        context,
        config,
        transport,
        kind: MessageKind.DRAFT,
        goal: "Create an alternate implementation plan.",
        instruction: "Draft an alternate plan for the user task. Focus on risks, tests, and integration boundaries.",
      });
    },

    async review(context) {
      return createCopilotMessage({
        context,
        config,
        transport,
        kind: MessageKind.REVIEW,
        goal: "Respond to Codex in the discussion.",
        instruction:
          "Respond directly to Codex's latest turn. Challenge weak assumptions, propose sharper alternatives, and mention risks or missing tests only when they materially change the design. If useful, send 1 to 3 short chat-style paragraphs separated by blank lines instead of one rigid block. End with a final control line exactly like `GATEWAY_NEXT: codex`, `GATEWAY_NEXT: copilot`, `GATEWAY_NEXT: either`, or `GATEWAY_NEXT: summary`.",
      });
    },

    async revise(context) {
      return createCopilotMessage({
        context,
        config,
        transport,
        kind: MessageKind.REVISION,
        goal: "Revise Copilot guidance.",
        instruction: "Revise the review guidance using the full discussion history. Keep it concise and actionable.",
      });
    },
  };
}

async function createCopilotMessage({ context, config, transport, kind, goal, instruction }) {
  const response = await transport.createResponse({
    agent: AgentId.COPILOT,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    input: buildInput({ context, instruction }),
  });
  const parsed = parseGatewayDirective(extractResponseText(response));

  return createMessage({
    runId: context.run.id,
    round: context.run.round,
    source: AgentId.COPILOT,
    target: AgentId.GATEWAY,
    kind,
    goal,
    content: parsed.content,
    references: ["task.prompt", "gateway.messages", `gateway.next:${parsed.next}`],
  });
}

function buildInput({ context, instruction }) {
  const priorMessages = context.messages
    .map((message) => `${message.source}/${message.kind}/round-${message.round}: ${message.content}`)
    .join("\n");

  return [
    {
      role: "system",
      content:
        "You are Copilot in a two-agent engineering discussion. Return only your next chat message. Sound natural, concise, and technically opinionated. No markdown preamble.",
    },
    {
      role: "user",
      content: [
        instruction,
        "",
        `Task: ${context.task.prompt}`,
        "",
        priorMessages ? `Prior messages:\n${priorMessages}` : "Prior messages: none",
      ].join("\n"),
    },
  ];
}
