const DEFAULT_RECENT_LIMIT = 8;

export function assembleContextPacket(snapshot, options = {}) {
  if (!snapshot?.thread) {
    throw new Error("context snapshot requires a thread");
  }

  const recentLimit = normalizeRecentLimit(options.recentLimit ?? DEFAULT_RECENT_LIMIT);
  const excludedMessageIds = collectExcludedMessageIds(snapshot.invocations ?? []);
  const contextMessages = (snapshot.messages ?? [])
    .filter((message) => !excludedMessageIds.has(message.id))
    .slice(-recentLimit);
  const metadata = snapshot.thread.metadata ?? {};
  const openQuestions = normalizeStringArray(
    options.openQuestions ?? metadata.openQuestions ?? [],
    "openQuestions",
  );
  const summary = normalizeOptionalString(options.summary ?? metadata.summary ?? "");

  return {
    threadId: snapshot.thread.id,
    title: snapshot.thread.title,
    summary,
    openQuestions,
    recentLimit,
    recentMessages: contextMessages.map(toContextMessage),
    excludedMessageIds: [...excludedMessageIds],
    prompt: buildPrompt({
      thread: snapshot.thread,
      summary,
      openQuestions,
      messages: contextMessages,
    }),
  };
}

function toContextMessage(message) {
  return {
    id: message.id,
    kind: message.kind,
    source: message.source,
    targetAgents: message.targetAgents ?? [],
    content: message.content,
    createdAt: message.createdAt,
  };
}

function collectExcludedMessageIds(invocations) {
  const excluded = new Set();
  for (const invocation of invocations) {
    if (
      (invocation.status === "failed" || invocation.status === "canceled") &&
      typeof invocation.outputMessageId === "string" &&
      invocation.outputMessageId.trim()
    ) {
      excluded.add(invocation.outputMessageId);
    }
  }
  return excluded;
}

function buildPrompt({ thread, summary, openQuestions, messages }) {
  const sections = [`Thread: ${thread.title}`];
  if (summary) {
    sections.push(`Summary:\n${summary}`);
  }
  if (openQuestions.length > 0) {
    sections.push(`Open questions:\n${openQuestions.map((question) => `- ${question}`).join("\n")}`);
  }
  sections.push(
    `Recent messages:\n${messages
      .map((message) => {
        const source = message.source?.name || message.source?.id || "unknown";
        return `${source}: ${message.content}`;
      })
      .join("\n")}`,
  );
  return sections.join("\n\n");
}

function normalizeRecentLimit(value) {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("recentLimit must be an integer between 1 and 50");
  }
  return limit;
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

function normalizeOptionalString(value) {
  return typeof value === "string" ? value.trim() : "";
}
