import { AgentId, MessageKind, createMessage } from "../schema/index.js";
import { parseGatewayDirective } from "./gatewayDirective.js";

export function createMockCodexAdapter(options = {}) {
  const behavior = options.behavior ?? {};

  return {
    async draft(context) {
      await maybeDelay(behavior.draftDelayMs);
      maybeFail(behavior.draftError);

      const parsed = parseGatewayDirective(
        behavior.draftContent ??
          `我倾向先把网关做成状态明确的对话编排器，先保证 "${context.task.prompt}" 这条链路稳定，再扩展复杂能力。\n\nGATEWAY_NEXT: copilot`,
      );
      return createMessage({
        runId: context.run.id,
        round: context.run.round,
        source: AgentId.CODEX,
        target: AgentId.GATEWAY,
        kind: MessageKind.DRAFT,
        goal: "Open the discussion with a concrete position.",
        content: parsed.content,
        references: ["task.prompt", `gateway.next:${parsed.next}`],
      });
    },

    async review(context) {
      await maybeDelay(behavior.reviewDelayMs);
      maybeFail(behavior.reviewError);

      return createMessage({
        runId: context.run.id,
        round: context.run.round,
        source: AgentId.CODEX,
        target: AgentId.GATEWAY,
        kind: MessageKind.REVIEW,
        goal: "Review the current plan.",
        content: behavior.reviewContent ?? "Codex self-review: keep the gateway state machine deterministic.",
        references: ["messages"],
      });
    },

    async revise(context) {
      await maybeDelay(behavior.reviseDelayMs);
      maybeFail(behavior.reviseError);

      const parsed = parseGatewayDirective(
        behavior.reviseContent ??
          "我同意把失败处理和持久化前置，但不该把流程做得太重，先保留确定性的轮转，再把真正的自由对话做进消息层。\n\nGATEWAY_NEXT: copilot",
      );
      return createMessage({
        runId: context.run.id,
        round: context.run.round,
        source: AgentId.CODEX,
        target: AgentId.GATEWAY,
        kind: MessageKind.REVISION,
        goal: "Respond to Copilot in the discussion.",
        content: parsed.content,
        references: ["copilot.review", `gateway.next:${parsed.next}`],
      });
    },
  };
}

async function maybeDelay(ms = 0) {
  if (ms > 0) {
    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}

function maybeFail(error) {
  if (error) {
    throw new Error(error);
  }
}
