import { RunStatus, StepType } from "../schema/index.js";
import { GatewayEvent } from "./events.js";

export const TRANSITIONS = Object.freeze({
  [RunStatus.IDLE]: {},
  [RunStatus.QUEUED]: {
    [GatewayEvent.RUN_CREATED]: transitionDefinition(RunStatus.DISPATCHING, StepType.DISPATCH),
  },
  [RunStatus.DISPATCHING]: {
    [GatewayEvent.RUN_DISPATCHED]: transitionDefinition(RunStatus.AWAITING_CODEX, StepType.CODEX_DRAFT),
    [GatewayEvent.RUN_FAILED]: failureDefinition(),
    [GatewayEvent.RUN_CANCELLED]: cancelDefinition(),
  },
  [RunStatus.AWAITING_CODEX]: {
    [GatewayEvent.CODEX_DRAFT_RECEIVED]: transitionDefinition(
      RunStatus.AWAITING_COPILOT,
      StepType.COPILOT_REVIEW,
    ),
    [GatewayEvent.RUN_FAILED]: failureDefinition(),
    [GatewayEvent.RUN_CANCELLED]: cancelDefinition(),
  },
  [RunStatus.AWAITING_COPILOT]: {
    [GatewayEvent.COPILOT_REVIEW_RECEIVED]: transitionDefinition(
      RunStatus.REVISING,
      StepType.CODEX_REVISION,
    ),
    [GatewayEvent.RUN_FAILED]: failureDefinition(),
    [GatewayEvent.RUN_CANCELLED]: cancelDefinition(),
  },
  [RunStatus.REVISING]: {
    [GatewayEvent.CODEX_REVISION_RECEIVED]: transitionDefinition(
      RunStatus.SUMMARIZING,
      StepType.SUMMARY,
    ),
    [GatewayEvent.RUN_FAILED]: failureDefinition(),
    [GatewayEvent.RUN_CANCELLED]: cancelDefinition(),
  },
  [RunStatus.SUMMARIZING]: {
    [GatewayEvent.SUMMARY_GENERATED]: transitionDefinition(
      RunStatus.COMPLETED,
      StepType.SUMMARY,
      true,
    ),
    [GatewayEvent.RUN_FAILED]: failureDefinition(true),
  },
  [RunStatus.COMPLETED]: {},
  [RunStatus.FAILED]: {},
  [RunStatus.CANCELLED]: {},
});

export function transition(run, event) {
  if (!run || typeof run !== "object" || Array.isArray(run)) {
    throw new Error("run is required");
  }

  if (!event || typeof event !== "object" || typeof event.type !== "string") {
    throw new Error("event is required");
  }

  const definition = TRANSITIONS[run.status]?.[event.type];
  if (!definition) {
    throw new Error(`illegal transition from ${run.status} via ${event.type}`);
  }

  if (event.type === GatewayEvent.CODEX_REVISION_RECEIVED && event.payload.continueRun === true) {
    return {
      ...run,
      status: RunStatus.AWAITING_COPILOT,
      round: run.round + 1,
      currentStep: StepType.COPILOT_REVIEW,
      finishedAt: run.finishedAt ?? null,
      error: null,
    };
  }

  if (event.type === GatewayEvent.COPILOT_REVIEW_RECEIVED && event.payload.completeDiscussion === true) {
    return {
      ...run,
      status: RunStatus.SUMMARIZING,
      currentStep: StepType.SUMMARY,
      finishedAt: run.finishedAt ?? null,
      error: null,
    };
  }

  return {
    ...run,
    status: definition.status,
    currentStep: definition.currentStep,
    finishedAt: definition.finishRun ? new Date().toISOString() : run.finishedAt ?? null,
    error: event.type === GatewayEvent.RUN_FAILED ? event.payload.error : null,
  };
}

export function canTransition(status, eventType) {
  return Boolean(TRANSITIONS[status]?.[eventType]);
}

export function getAllowedEvents(status) {
  return Object.freeze(Object.keys(TRANSITIONS[status] ?? {}));
}

function transitionDefinition(status, currentStep, finishRun = false) {
  return Object.freeze({ status, currentStep, finishRun });
}

function failureDefinition(finishRun = true) {
  return transitionDefinition(RunStatus.FAILED, StepType.FAILURE, finishRun);
}

function cancelDefinition() {
  return transitionDefinition(RunStatus.CANCELLED, StepType.CANCEL, true);
}
