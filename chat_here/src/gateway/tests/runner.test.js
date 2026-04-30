import test from "node:test";
import assert from "node:assert/strict";

import { runAdapterStep, createCancelToken } from "../orchestrator/runner.js";

test("runAdapterStep retries failed operations", async () => {
  let attempts = 0;

  const result = await runAdapterStep(
    "test.retry",
    async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("temporary failure");
      }
      return "ok";
    },
    { retries: 1, timeoutMs: 100 },
  );

  assert.equal(result, "ok");
  assert.equal(attempts, 2);
});

test("runAdapterStep times out slow operations", async () => {
  await assert.rejects(
    () =>
      runAdapterStep(
        "test.timeout",
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve("late"), 50);
          }),
        { timeoutMs: 5 },
      ),
    /test.timeout timed out after 5ms/,
  );
});

test("runAdapterStep rejects cancelled operations before execution", async () => {
  const cancelToken = createCancelToken();
  cancelToken.cancel("user requested");

  await assert.rejects(
    () => runAdapterStep("test.cancel", async () => "never", { cancelToken }),
    /test.cancel cancelled: user requested/,
  );
});
