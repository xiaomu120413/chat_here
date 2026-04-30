export const AdapterStep = Object.freeze({
  DRAFT: "draft",
  REVIEW: "review",
  REVISE: "revise",
});

export function assertAdapter(adapter, label) {
  if (!adapter || typeof adapter !== "object") {
    throw new Error(`${label} adapter must be an object`);
  }

  for (const method of Object.values(AdapterStep)) {
    if (typeof adapter[method] !== "function") {
      throw new Error(`${label} adapter must implement ${method}()`);
    }
  }
}

export function createAdapterContext(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("adapter context input must be an object");
  }

  return {
    task: input.task,
    run: input.run,
    messages: input.messages ?? [],
    decision: input.decision ?? null,
  };
}
