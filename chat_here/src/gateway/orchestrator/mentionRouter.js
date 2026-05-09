import { AgentId } from "../schema/index.js";
import { parseGatewayDirective } from "../adapters/gatewayDirective.js";

const KNOWN_MENTIONS = Object.freeze({
  "@codex": AgentId.CODEX,
  "@copilot": AgentId.COPILOT,
  "@all": "all",
});

export function routeMessage(input, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("routing input must be an object");
  }

  const content = normalizeContent(input.content);
  const maxDepth = normalizeDepthLimit(options.maxDepth ?? 4, "maxDepth");
  const depth = normalizeDepth(input.a2a?.depth ?? input.depth ?? 0);
  const mentions = parseMentions(content);
  const gatewayHint = normalizeGatewayHint(input.gatewayHint ?? getGatewayNextFromContent(content));

  if (depth >= maxDepth) {
    return createDecision({
      mode: "stop",
      targetAgents: [],
      reason: `A2A depth limit reached (${depth}/${maxDepth}).`,
      mentions,
      gatewayHint,
      depth,
      maxDepth,
    });
  }

  if (mentions.explicit.includes("@all")) {
    return createDecision({
      mode: "discussion",
      targetAgents: [AgentId.CODEX, AgentId.COPILOT],
      reason: "Explicit @all mention routes to a multi-agent discussion.",
      mentions,
      gatewayHint,
      depth,
      maxDepth,
    });
  }

  const explicitAgents = mentions.explicit
    .map((mention) => KNOWN_MENTIONS[mention])
    .filter((agent) => agent === AgentId.CODEX || agent === AgentId.COPILOT);

  if (explicitAgents.length > 0) {
    return createDecision({
      mode: explicitAgents.length === 1 ? "single" : "discussion",
      targetAgents: [...new Set(explicitAgents)],
      reason: `Explicit mention routes to ${[...new Set(explicitAgents)].join(", ")}.`,
      mentions,
      gatewayHint,
      depth,
      maxDepth,
    });
  }

  if (gatewayHint === AgentId.CODEX || gatewayHint === AgentId.COPILOT) {
    return createDecision({
      mode: "single",
      targetAgents: [gatewayHint],
      reason: `No explicit mention; GATEWAY_NEXT hint suggests ${gatewayHint}.`,
      mentions,
      gatewayHint,
      depth,
      maxDepth,
    });
  }

  if (gatewayHint === "summary") {
    return createDecision({
      mode: "stop",
      targetAgents: [],
      reason: "No explicit mention; GATEWAY_NEXT requests summary.",
      mentions,
      gatewayHint,
      depth,
      maxDepth,
    });
  }

  return createDecision({
    mode: "discussion",
    targetAgents: [AgentId.CODEX, AgentId.COPILOT],
    reason: "No explicit mention; default route starts a Codex and Copilot discussion.",
    mentions,
    gatewayHint,
    depth,
    maxDepth,
  });
}

export function parseMentions(content) {
  const text = normalizeContent(content);
  const found = text.match(/@[a-zA-Z][\w-]*/g) ?? [];
  const normalized = found.map((mention) => mention.toLowerCase());
  const explicit = normalized.filter((mention) => Object.hasOwn(KNOWN_MENTIONS, mention));
  const unknown = normalized.filter((mention) => !Object.hasOwn(KNOWN_MENTIONS, mention));

  return {
    explicit: [...new Set(explicit)],
    unknown: [...new Set(unknown)],
  };
}

function createDecision(input) {
  return {
    mode: input.mode,
    targetAgents: input.targetAgents,
    reason: input.reason,
    mentions: input.mentions,
    gatewayHint: input.gatewayHint,
    depth: input.depth,
    maxDepth: input.maxDepth,
  };
}

function normalizeContent(content) {
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("routing content must be a non-empty string");
  }
  return content.trim();
}

function normalizeDepth(value) {
  const depth = Number(value);
  if (!Number.isInteger(depth) || depth < 0) {
    throw new Error("routing depth must be a non-negative integer");
  }
  return depth;
}

function normalizeDepthLimit(value, label) {
  const depth = Number(value);
  if (!Number.isInteger(depth) || depth < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return depth;
}

function normalizeGatewayHint(value) {
  if (value === AgentId.CODEX || value === AgentId.COPILOT || value === "summary" || value === "either") {
    return value;
  }
  return "either";
}

function getGatewayNextFromContent(content) {
  return parseGatewayDirective(content, "either").next;
}
