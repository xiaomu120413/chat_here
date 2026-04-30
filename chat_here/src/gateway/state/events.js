import { AgentId } from "../schema/index.js";

export const GatewayEvent = Object.freeze({
  RUN_CREATED: "RUN_CREATED",
  RUN_DISPATCHED: "RUN_DISPATCHED",
  CODEX_DRAFT_RECEIVED: "CODEX_DRAFT_RECEIVED",
  COPILOT_REVIEW_RECEIVED: "COPILOT_REVIEW_RECEIVED",
  CODEX_REVISION_RECEIVED: "CODEX_REVISION_RECEIVED",
  SUMMARY_GENERATED: "SUMMARY_GENERATED",
  RUN_FAILED: "RUN_FAILED",
  RUN_CANCELLED: "RUN_CANCELLED",
});

export function createRunCreatedEvent(payload) {
  assertPayload(payload, ["runId"]);
  return { type: GatewayEvent.RUN_CREATED, payload };
}

export function createRunDispatchedEvent(payload) {
  assertPayload(payload, ["runId"]);
  return { type: GatewayEvent.RUN_DISPATCHED, payload };
}

export function createCodexDraftReceivedEvent(payload) {
  assertMessagePayload(payload, AgentId.CODEX);
  return { type: GatewayEvent.CODEX_DRAFT_RECEIVED, payload };
}

export function createCopilotReviewReceivedEvent(payload) {
  assertMessagePayload(payload, AgentId.COPILOT);
  return { type: GatewayEvent.COPILOT_REVIEW_RECEIVED, payload };
}

export function createCodexRevisionReceivedEvent(payload) {
  assertMessagePayload(payload, AgentId.CODEX);
  return { type: GatewayEvent.CODEX_REVISION_RECEIVED, payload };
}

export function createSummaryGeneratedEvent(payload) {
  assertPayload(payload, ["runId", "decisionId"]);
  return { type: GatewayEvent.SUMMARY_GENERATED, payload };
}

export function createRunFailedEvent(payload) {
  assertPayload(payload, ["runId", "error"]);
  return { type: GatewayEvent.RUN_FAILED, payload };
}

export function createRunCancelledEvent(payload) {
  assertPayload(payload, ["runId", "reason"]);
  return { type: GatewayEvent.RUN_CANCELLED, payload };
}

function assertMessagePayload(payload, source) {
  assertPayload(payload, ["runId", "messageId", "source"]);
  if (payload.source !== source) {
    throw new Error(`event source must be ${source}`);
  }
}

function assertPayload(payload, keys) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("event payload must be an object");
  }

  for (const key of keys) {
    const value = payload[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`event payload requires ${key}`);
    }
  }
}
