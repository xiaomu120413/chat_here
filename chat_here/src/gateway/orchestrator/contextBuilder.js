import { createAdapterContext } from "../adapters/types.js";

export function buildDraftContext({ task, run, messages }) {
  return createAdapterContext({ task, run, messages });
}

export function buildReviewContext({ task, run, messages }) {
  return createAdapterContext({ task, run, messages });
}

export function buildRevisionContext({ task, run, messages }) {
  return createAdapterContext({ task, run, messages });
}
