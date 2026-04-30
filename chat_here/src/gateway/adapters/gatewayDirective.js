import { AgentId } from "../schema/index.js";

const DIRECTIVE_PREFIX = "GATEWAY_NEXT:";

export function parseGatewayDirective(text, fallback = "either") {
  const raw = String(text ?? "").trim();
  if (!raw) {
    return { content: "", next: fallback };
  }

  const lines = raw.split(/\r?\n/);
  const lastLine = lines.at(-1)?.trim() ?? "";
  if (!lastLine.toUpperCase().startsWith(DIRECTIVE_PREFIX)) {
    return { content: raw, next: fallback };
  }

  const next = normalizeNextValue(lastLine.slice(DIRECTIVE_PREFIX.length).trim(), fallback);
  const content = lines.slice(0, -1).join("\n").trim();

  return {
    content: content || raw,
    next,
  };
}

export function getGatewayNextFromMessage(message, fallback = "either") {
  const marker = message.references.find((reference) => reference.startsWith("gateway.next:"));
  if (!marker) {
    return fallback;
  }

  return normalizeNextValue(marker.slice("gateway.next:".length), fallback);
}

export function normalizeNextValue(value, fallback = "either") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (
    normalized === AgentId.CODEX ||
    normalized === AgentId.COPILOT ||
    normalized === "summary" ||
    normalized === "either"
  ) {
    return normalized;
  }
  return fallback;
}
