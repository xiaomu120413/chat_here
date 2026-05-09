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

    async summarize(context) {
      const response = await transport.createResponse({
        agent: AgentId.CODEX,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        input: buildSummaryInput({ context }),
      });

      return parseDecisionPayload(extractResponseText(response));
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

function buildSummaryInput({ context }) {
  const transcript = context.messages
    .map((message) => `${message.source}/${message.kind}/round-${message.round}: ${message.content}`)
    .join("\n");

  return [
    {
      role: "system",
      content:
        "You are Codex summarizing a completed multi-agent engineering discussion. Return strict JSON only with keys: summary, rationale, open_questions, next_actions.",
    },
    {
      role: "user",
      content: [
        "Summarize the discussion as strict JSON.",
        "Requirements:",
        '- "summary" must be one short paragraph.',
        '- "rationale" must mention the strongest agreed direction and the main tradeoff.',
        '- "open_questions" must be an array of strings.',
        '- "next_actions" must be an array of strings.',
        "",
        `Task: ${context.task.prompt}`,
        "",
        transcript ? `Transcript:\n${transcript}` : "Transcript: none",
      ].join("\n"),
    },
  ];
}

function parseDecisionPayload(text) {
  const raw = String(text ?? "").trim();
  const candidate = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new Error("Codex summary was not valid JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Codex summary payload must be an object");
  }

  const summary = normalizeDecisionText(parsed.summary, "summary");
  const rationale = normalizeDecisionText(parsed.rationale, "rationale");

  return {
    summary,
    rationale,
    openQuestions: normalizeStringList(parsed.open_questions),
    nextActions: normalizeStringList(parsed.next_actions),
  };
}

function normalizeDecisionText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Codex summary payload requires non-empty ${label}`);
  }
  return value.trim();
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}
