const RUN_STATUS_VALUES = [
  "idle",
  "queued",
  "dispatching",
  "awaiting_codex",
  "awaiting_copilot",
  "revising",
  "summarizing",
  "completed",
  "failed",
  "cancelled",
];

const STEP_TYPE_VALUES = [
  "dispatch",
  "codex_draft",
  "copilot_review",
  "codex_revision",
  "summary",
  "failure",
  "cancel",
];

const AGENT_ID_VALUES = ["user", "gateway", "codex", "copilot"];
const MESSAGE_KIND_VALUES = ["task", "draft", "review", "revision", "summary", "error"];
const CAPABILITY_VALUES = ["read_only", "propose_patch", "execute_command", "apply_change"];

export const RunStatus = createEnum(RUN_STATUS_VALUES);
export const StepType = createEnum(STEP_TYPE_VALUES);
export const AgentId = createEnum(AGENT_ID_VALUES);
export const MessageKind = createEnum(MESSAGE_KIND_VALUES);
export const Capability = createEnum(CAPABILITY_VALUES);

export function createTask(input) {
  assertObject(input, "task input");
  assertNonEmptyString(input.prompt, "task.prompt");

  return {
    id: input.id ?? createId("task"),
    title: input.title?.trim() || deriveTitle(input.prompt),
    prompt: input.prompt.trim(),
    requestedBy: input.requestedBy ?? AgentId.USER,
    createdAt: ensureIso(input.createdAt, "task.createdAt"),
  };
}

export function createRun(input) {
  assertObject(input, "run input");
  assertNonEmptyString(input.taskId, "run.taskId");
  assertEnum(input.status ?? RunStatus.QUEUED, RUN_STATUS_VALUES, "run.status");
  assertEnum(input.currentStep ?? StepType.DISPATCH, STEP_TYPE_VALUES, "run.currentStep");
  assertPositiveInteger(input.round ?? 1, "run.round");

  return {
    id: input.id ?? createId("run"),
    taskId: input.taskId,
    status: input.status ?? RunStatus.QUEUED,
    round: input.round ?? 1,
    currentStep: input.currentStep ?? StepType.DISPATCH,
    startedAt: ensureIso(input.startedAt, "run.startedAt"),
    finishedAt: input.finishedAt ? ensureIso(input.finishedAt, "run.finishedAt") : null,
    error: input.error ?? null,
  };
}

export function createRunStep(input) {
  assertObject(input, "runStep input");
  assertNonEmptyString(input.runId, "runStep.runId");
  assertEnum(input.type, STEP_TYPE_VALUES, "runStep.type");
  assertEnum(input.status, ["pending", "active", "completed", "failed", "cancelled"], "runStep.status");

  return {
    id: input.id ?? createId("step"),
    runId: input.runId,
    type: input.type,
    status: input.status,
    startedAt: ensureIso(input.startedAt, "runStep.startedAt"),
    finishedAt: input.finishedAt ? ensureIso(input.finishedAt, "runStep.finishedAt") : null,
    detail: input.detail?.trim() ?? "",
  };
}

export function createMessage(input) {
  assertObject(input, "message input");
  assertNonEmptyString(input.runId, "message.runId");
  assertEnum(input.source, AGENT_ID_VALUES, "message.source");
  assertEnum(input.target, AGENT_ID_VALUES, "message.target");
  assertEnum(input.kind, MESSAGE_KIND_VALUES, "message.kind");
  assertNonEmptyString(input.content, "message.content");

  return {
    id: input.id ?? createId("msg"),
    runId: input.runId,
    round: assertPositiveInteger(input.round ?? 1, "message.round"),
    source: input.source,
    target: input.target,
    kind: input.kind,
    goal: input.goal?.trim() ?? "",
    content: input.content.trim(),
    references: normalizeStringArray(input.references ?? [], "message.references"),
    createdAt: ensureIso(input.createdAt, "message.createdAt"),
  };
}

export function createDecision(input) {
  assertObject(input, "decision input");
  assertNonEmptyString(input.runId, "decision.runId");
  assertNonEmptyString(input.summary, "decision.summary");

  return {
    id: input.id ?? createId("decision"),
    runId: input.runId,
    summary: input.summary.trim(),
    rationale: input.rationale?.trim() ?? "",
    openQuestions: normalizeStringArray(input.openQuestions ?? [], "decision.openQuestions"),
    nextActions: normalizeStringArray(input.nextActions ?? [], "decision.nextActions"),
    createdAt: ensureIso(input.createdAt, "decision.createdAt"),
  };
}

export function createArtifact(input) {
  assertObject(input, "artifact input");
  assertNonEmptyString(input.runId, "artifact.runId");
  assertNonEmptyString(input.type, "artifact.type");
  assertNonEmptyString(input.title, "artifact.title");
  assertNonEmptyString(input.content, "artifact.content");
  assertEnum(input.source, AGENT_ID_VALUES, "artifact.source");

  return {
    id: input.id ?? createId("artifact"),
    runId: input.runId,
    type: input.type.trim(),
    title: input.title.trim(),
    content: input.content.trim(),
    source: input.source,
    createdAt: ensureIso(input.createdAt, "artifact.createdAt"),
  };
}

export function createAgentDescriptor(input) {
  assertObject(input, "agentDescriptor input");
  assertEnum(input.id, AGENT_ID_VALUES.filter((value) => value !== AgentId.USER), "agentDescriptor.id");
  assertNonEmptyString(input.name, "agentDescriptor.name");
  assertNonEmptyString(input.role, "agentDescriptor.role");

  return {
    id: input.id,
    name: input.name.trim(),
    role: input.role.trim(),
    capabilities: normalizeCapabilityArray(input.capabilities ?? [Capability.READ_ONLY]),
  };
}

export function createGatewayError(input) {
  assertObject(input, "gatewayError input");
  assertNonEmptyString(input.code, "gatewayError.code");
  assertNonEmptyString(input.message, "gatewayError.message");
  assertEnum(input.source, AGENT_ID_VALUES, "gatewayError.source");

  return {
    code: input.code.trim(),
    message: input.message.trim(),
    retriable: Boolean(input.retriable),
    source: input.source,
    details: input.details ?? {},
  };
}

export function createReference(input) {
  assertObject(input, "reference input");
  assertNonEmptyString(input.label, "reference.label");
  assertNonEmptyString(input.value, "reference.value");

  return {
    label: input.label.trim(),
    value: input.value.trim(),
  };
}

function normalizeCapabilityArray(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("agentDescriptor.capabilities must be a non-empty array");
  }

  for (const value of values) {
    assertEnum(value, CAPABILITY_VALUES, "agentDescriptor.capabilities");
  }

  return [...new Set(values)];
}

function normalizeStringArray(values, label) {
  if (!Array.isArray(values)) {
    throw new Error(`${label} must be an array`);
  }

  return values.map((value, index) => {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`${label}[${index}] must be a non-empty string`);
    }
    return value.trim();
  });
}

function ensureIso(value, label) {
  const candidate = value ?? nowIso();
  if (typeof candidate !== "string" || Number.isNaN(Date.parse(candidate))) {
    throw new Error(`${label} must be an ISO date string`);
  }
  return candidate;
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function assertEnum(value, allowedValues, label) {
  if (!allowedValues.includes(value)) {
    throw new Error(`${label} must be one of: ${allowedValues.join(", ")}`);
  }
}

function deriveTitle(prompt) {
  return prompt.trim().slice(0, 48) || "Untitled Task";
}

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createEnum(values) {
  return Object.freeze(values.reduce((acc, value) => ({ ...acc, [toEnumKey(value)]: value }), {}));
}

function toEnumKey(value) {
  return value.toUpperCase().replaceAll("-", "_");
}
