import { assertAdapter } from "../adapters/types.js";
import { createAdapters } from "../adapters/factory.js";
import { getGatewayNextFromMessage } from "../adapters/gatewayDirective.js";
import {
  AgentId,
  RunStatus,
  StepType,
  createDecision,
  createGatewayError,
  createMessage,
  createRun,
  createTask,
} from "../schema/index.js";
import { createMemoryStore } from "../store/memoryStore.js";
import {
  createCodexDraftReceivedEvent,
  createCodexRevisionReceivedEvent,
  createCopilotReviewReceivedEvent,
  createRunCreatedEvent,
  createRunDispatchedEvent,
  createRunFailedEvent,
  createSummaryGeneratedEvent,
} from "../state/events.js";
import { buildDraftContext, buildReviewContext, buildRevisionContext } from "./contextBuilder.js";
import { runAdapterStep } from "./runner.js";

export async function startRun(taskInput, deps = {}) {
  const store = deps.store ?? createMemoryStore();
  const maxRounds = normalizeMaxRounds(deps.maxRounds ?? 1);
  const adapters = deps.codex && deps.copilot
    ? { codex: deps.codex, copilot: deps.copilot }
    : createAdapters(deps.providers ?? {}, deps.adapterOptions ?? {});
  const codex = adapters.codex;
  const copilot = adapters.copilot;
  const maxAgentTurns = Math.max(2, maxRounds * 2);
  const defaultStepTimeoutMs = usesCliProviders(adapters.config) ? 120_000 : 30_000;
  const runnerOptions = {
    timeoutMs: deps.stepTimeoutMs ?? defaultStepTimeoutMs,
    retries: deps.retries ?? 0,
    cancelToken: deps.cancelToken ?? null,
  };

  assertAdapter(codex, "codex");
  assertAdapter(copilot, "copilot");

  const task = createTask(normalizeTaskInput(taskInput));
  let run = createRun({ taskId: task.id });
  const messages = [];

  await store.saveTask(task);
  await store.saveRun(run);
  messages.push(
    await store.appendMessage(
      createMessage({
        runId: run.id,
        round: 1,
        source: AgentId.USER,
        target: AgentId.GATEWAY,
        kind: "task",
        goal: "Start a multi-agent discussion.",
        content: task.prompt,
        references: ["task.prompt"],
      }),
    ),
  );
  await emitProgress(store, deps, { task, run, messages, decision: null, error: null });

  try {
    await appendEvent(store, createRunCreatedEvent({ runId: run.id }));
    run = await saveRunState(store, run, {
      status: RunStatus.DISPATCHING,
      currentStep: StepType.DISPATCH,
    });
    await emitProgress(store, deps, { task, run, messages, decision: null, error: null });

    await appendEvent(store, createRunDispatchedEvent({ runId: run.id }));
    run = await prepareRunForTurn(store, run, {
      speaker: AgentId.CODEX,
      method: "draft",
      round: 1,
    });
    await emitProgress(store, deps, { task, run, messages, decision: null, error: null });

    let turn = { speaker: AgentId.CODEX, method: "draft", round: 1, consecutive: 0 };
    let agentTurns = 0;

    while (agentTurns < maxAgentTurns) {
      const message = await executeTurn({ task, run, messages, turn, codex, copilot, runnerOptions });
      messages.push(await store.appendMessage(message));
      agentTurns += 1;

      await appendEvent(store, createMessageEvent(run.id, message, turn, agentTurns < maxAgentTurns));
      await emitProgress(store, deps, { task, run, messages, decision: null, error: null });

      const nextTurn = selectNextTurn({ turn, message, agentTurns, maxAgentTurns });
      if (!nextTurn) {
        break;
      }

      run = await prepareRunForTurn(store, run, nextTurn);
      turn = nextTurn;
      await emitProgress(store, deps, { task, run, messages, decision: null, error: null });
    }

    run = await saveRunState(store, run, {
      status: RunStatus.SUMMARIZING,
      currentStep: StepType.SUMMARY,
    });
    const decision = buildSummaryDecision({ run, messages, maxRounds });
    await store.saveDecision(decision);
    await appendEvent(store, createSummaryGeneratedEvent({ runId: run.id, decisionId: decision.id }));
    run = await saveRunState(store, run, {
      status: RunStatus.COMPLETED,
      currentStep: StepType.SUMMARY,
      finishedAt: new Date().toISOString(),
    });
    await emitProgress(store, deps, { task, run, messages, decision, error: null });

    return withStoredEvents(store, { task, run, messages, decision });
  } catch (error) {
    const gatewayError = createGatewayError({
      code: "ORCHESTRATOR_STEP_FAILED",
      message: error instanceof Error ? error.message : String(error),
      source: AgentId.GATEWAY,
      retriable: false,
    });

    const errorMessage = createMessage({
      runId: run.id,
      round: run.round,
      source: AgentId.GATEWAY,
      target: AgentId.USER,
      kind: "error",
      goal: "Report orchestrator failure.",
      content: gatewayError.message,
      references: [run.currentStep],
    });

    messages.push(await store.appendMessage(errorMessage));

    if (run.status !== RunStatus.FAILED) {
      await appendEvent(store, createRunFailedEvent({ runId: run.id, error: gatewayError.message }));
      run = await saveRunState(store, run, {
        status: RunStatus.FAILED,
        currentStep: StepType.FAILURE,
        error: gatewayError.message,
        finishedAt: new Date().toISOString(),
      });
    }

    await emitProgress(store, deps, {
      task,
      run,
      messages,
      decision: null,
      error: gatewayError,
    });

    return withStoredEvents(store, { task, run, messages, decision: null, error: gatewayError });
  }
}

async function emitProgress(store, deps, result) {
  if (typeof deps.onUpdate !== "function") {
    return;
  }

  deps.onUpdate(await withStoredEvents(store, result));
}

async function withStoredEvents(store, result) {
  const snapshot = await store.getRun(result.run.id);
  return {
    ...result,
    events: snapshot?.events ?? [],
  };
}

async function appendEvent(store, event) {
  if (typeof store.appendEvent === "function") {
    await store.appendEvent(event);
  }
}

async function saveRunState(store, run, updates) {
  const nextRun = {
    ...run,
    ...updates,
    finishedAt: updates.finishedAt ?? run.finishedAt ?? null,
    error: updates.error ?? null,
  };
  await store.saveRun(nextRun);
  return nextRun;
}

async function prepareRunForTurn(store, run, turn) {
  return saveRunState(store, run, {
    round: turn.round,
    status: turn.speaker === AgentId.CODEX ? RunStatus.AWAITING_CODEX : RunStatus.AWAITING_COPILOT,
    currentStep:
      turn.speaker === AgentId.CODEX
        ? turn.method === "draft"
          ? StepType.CODEX_DRAFT
          : StepType.CODEX_REVISION
        : StepType.COPILOT_REVIEW,
  });
}

async function executeTurn({ task, run, messages, turn, codex, copilot, runnerOptions }) {
  if (turn.speaker === AgentId.CODEX) {
    const label = turn.method === "draft" ? "codex.draft" : "codex.revise";
    const action =
      turn.method === "draft"
        ? () => codex.draft(buildDraftContext({ task, run, messages }))
        : () => codex.revise(buildRevisionContext({ task, run, messages }));
    return runAdapterStep(label, action, runnerOptions);
  }

  return runAdapterStep(
    "copilot.review",
    () => copilot.review(buildReviewContext({ task, run, messages })),
    runnerOptions,
  );
}

function createMessageEvent(runId, message, turn, canContinue) {
  if (message.source === AgentId.CODEX && turn.method === "draft") {
    return createCodexDraftReceivedEvent({
      runId,
      messageId: message.id,
      source: AgentId.CODEX,
      continueRun: canContinue,
    });
  }

  if (message.source === AgentId.CODEX) {
    return createCodexRevisionReceivedEvent({
      runId,
      messageId: message.id,
      source: AgentId.CODEX,
      continueRun: canContinue,
    });
  }

  return createCopilotReviewReceivedEvent({
    runId,
    messageId: message.id,
    source: AgentId.COPILOT,
    completeDiscussion: !canContinue,
  });
}

function selectNextTurn({ turn, message, agentTurns, maxAgentTurns }) {
  if (agentTurns >= maxAgentTurns) {
    return null;
  }

  const requested = getGatewayNextFromMessage(message, "either");
  if (requested === "summary" && agentTurns >= 2) {
    return null;
  }

  let nextSpeaker = requested;
  if (requested === "either") {
    nextSpeaker = turn.speaker === AgentId.CODEX ? AgentId.COPILOT : AgentId.CODEX;
  }

  if (nextSpeaker === turn.speaker && turn.consecutive >= 1) {
    nextSpeaker = turn.speaker === AgentId.CODEX ? AgentId.COPILOT : AgentId.CODEX;
  }

  const nextRound =
    turn.speaker === AgentId.COPILOT && nextSpeaker === AgentId.CODEX ? turn.round + 1 : turn.round;

  return {
    speaker: nextSpeaker,
    method: nextSpeaker === AgentId.CODEX ? "revise" : "review",
    round: nextRound,
    consecutive: nextSpeaker === turn.speaker ? turn.consecutive + 1 : 0,
  };
}

function buildSummaryDecision({ run, messages, maxRounds }) {
  const draft = messages.find((message) => message.source === AgentId.CODEX && message.kind === "draft");
  const reviews = messages.filter((message) => message.source === AgentId.COPILOT && message.kind === "review");
  const revisions = messages.filter((message) => message.source === AgentId.CODEX && message.kind === "revision");
  const latestReview = reviews.at(-1);
  const latestRevision = revisions.at(-1);

  return createDecision({
    runId: run.id,
    summary:
      maxRounds === 1
        ? "Single-round discussion completed."
        : `Gateway discussion completed after ${run.round} rounds.`,
    rationale: [
      draft ? `Codex opening: ${draft.content}` : "Codex opening missing.",
      latestReview ? `Copilot latest response: ${latestReview.content}` : "Copilot response missing.",
      latestRevision ? `Codex latest response: ${latestRevision.content}` : "Codex follow-up missing.",
      `Rounds requested: ${maxRounds}. Copilot turns: ${reviews.length}. Codex turns: ${1 + revisions.length}.`,
    ].join("\n"),
    openQuestions: [],
    nextActions: ["Promote agreed points into an execution plan", "Tune round limit per task complexity"],
  });
}

function normalizeTaskInput(taskInput) {
  if (typeof taskInput === "string") {
    return { prompt: taskInput };
  }

  if (!taskInput || typeof taskInput !== "object" || Array.isArray(taskInput)) {
    throw new Error("task input must be a string or object");
  }

  return taskInput;
}

function normalizeMaxRounds(value) {
  const rounds = Number(value);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 5) {
    throw new Error("maxRounds must be an integer between 1 and 5");
  }
  return rounds;
}

function usesCliProviders(config) {
  return (
    config?.codex?.provider === "tauri_codex" ||
    config?.copilot?.provider === "tauri_copilot"
  );
}
