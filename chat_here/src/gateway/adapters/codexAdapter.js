import { AgentId, MessageKind, createMessage } from "../schema/index.js";
import { createOpenAIResponsesTransport, extractResponseText } from "./openAITransport.js";
import { parseGatewayDirective } from "./gatewayDirective.js";

export function createCodexAdapter(config, options = {}) {
  const transport = options.transport ?? createOpenAIResponsesTransport(options);

  return {
    async draft(context) {
      return createCodexMessage({
        context,
        config,
        transport,
        kind: MessageKind.DRAFT,
        goal: "Join the discussion with an opinionated first reply.",
        instruction:
          "Reply as Codex in a live technical discussion. Be direct and opinionated. Propose a concrete direction, but keep it conversational rather than templated. If useful, send 1 to 3 short chat-style paragraphs separated by blank lines. End with a final control line exactly like `GATEWAY_NEXT: codex`, `GATEWAY_NEXT: copilot`, `GATEWAY_NEXT: either`, or `GATEWAY_NEXT: summary`.",
      });
    },

    async review(context) {
      return createCodexMessage({
        context,
        config,
        transport,
        kind: MessageKind.REVIEW,
        goal: "Review the current plan.",
        instruction: "Review the current plan for missing tests, state management risks, and integration gaps.",
      });
    },

    async revise(context) {
      return createCodexMessage({
        context,
        config,
        transport,
        kind: MessageKind.REVISION,
        goal: "Respond to Copilot in the discussion.",
        instruction:
          "Respond directly to Copilot's latest turn. Push back where needed, concede when the criticism is strong, and introduce the next useful idea or question. If helpful, send 1 to 3 short chat-style paragraphs separated by blank lines. Do not summarize the thread. End with a final control line exactly like `GATEWAY_NEXT: codex`, `GATEWAY_NEXT: copilot`, `GATEWAY_NEXT: either`, or `GATEWAY_NEXT: summary`.",
      });
    },
  };
}

async function createCodexMessage({ context, config, transport, kind, goal, instruction }) {
  const response = await transport.createResponse({
    agent: AgentId.CODEX,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    input: buildInput({ context, instruction }),
  });
  const parsed = parseGatewayDirective(extractResponseText(response));

  return createMessage({
    runId: context.run.id,
    round: context.run.round,
    source: AgentId.CODEX,
    target: AgentId.GATEWAY,
    kind,
    goal,
    content: parsed.content,
    references: ["task.prompt", "gateway.messages", `gateway.next:${parsed.next}`],
  });
}

function buildInput({ context, instruction }) {
  const priorMessages = context.messages
    .map((message) => `${message.source}/${message.kind}: ${message.content}`)
    .join("\n");

  return [
    {
      role: "system",
      content:
        "You are Codex in a two-agent engineering discussion. Return only your next chat message. Sound natural, concise, and technically opinionated. No markdown preamble.",
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
