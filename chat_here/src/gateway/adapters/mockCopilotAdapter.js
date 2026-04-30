import { AgentId, MessageKind, createMessage } from "../schema/index.js";
import { parseGatewayDirective } from "./gatewayDirective.js";

export function createMockCopilotAdapter(options = {}) {
  const behavior = options.behavior ?? {};

  return {
    async draft(context) {
      await maybeDelay(behavior.draftDelayMs);
      maybeFail(behavior.draftError);

      return createMessage({
        runId: context.run.id,
        round: context.run.round,
        source: AgentId.COPILOT,
        target: AgentId.GATEWAY,
        kind: MessageKind.DRAFT,
        goal: "Create an alternate draft.",
        content: behavior.draftContent ?? `Copilot draft: validate edge cases for "${context.task.prompt}".`,
        references: ["task.prompt"],
      });
    },

    async review(context) {
      await maybeDelay(behavior.reviewDelayMs);
      maybeFail(behavior.reviewError);

      const parsed = parseGatewayDirective(
        behavior.reviewContent ??
          "你的方向可以，但如果没有明确的失败恢复、状态持久化和契约测试，这个对话网关一上真实 CLI 就会很脆。\n\nGATEWAY_NEXT: codex",
      );
      return createMessage({
        runId: context.run.id,
        round: context.run.round,
        source: AgentId.COPILOT,
        target: AgentId.GATEWAY,
        kind: MessageKind.REVIEW,
        goal: "Respond to Codex in the discussion.",
        content: parsed.content,
        references: ["codex.draft", `gateway.next:${parsed.next}`],
      });
    },

    async revise(context) {
      await maybeDelay(behavior.reviseDelayMs);
      maybeFail(behavior.reviseError);

      return createMessage({
        runId: context.run.id,
        round: context.run.round,
        source: AgentId.COPILOT,
        target: AgentId.GATEWAY,
        kind: MessageKind.REVISION,
        goal: "Revise Copilot review.",
        content: behavior.reviseContent ?? "Copilot revision: keep review outputs short and actionable.",
        references: ["messages"],
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
