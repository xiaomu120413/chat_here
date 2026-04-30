import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createFileStore } from "../store/fileStore.js";
import { startRun } from "../orchestrator/index.js";
import { RunStatus } from "../schema/index.js";

test("file store persists and restores completed runs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gateway-store-"));
  const filePath = join(dir, "runs.json");
  const store = createFileStore(filePath);

  const result = await startRun("Persist this run.", { store });
  const restoredStore = createFileStore(filePath);
  const restored = await restoredStore.getRun(result.run.id);

  assert.equal(restored.run.status, RunStatus.COMPLETED);
  assert.equal(restored.task.prompt, "Persist this run.");
  assert.equal(restored.events.length, 5);
  assert.equal(restored.events[0].type, "RUN_CREATED");
  assert.equal(restored.messages.length, 3);
  assert.equal(restored.decision.id, result.decision.id);
});

test("file store lists runs newest first", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gateway-store-"));
  const store = createFileStore(join(dir, "runs.json"));

  const first = await startRun({ prompt: "First", createdAt: "2026-01-01T00:00:00.000Z" }, { store });
  const second = await startRun({ prompt: "Second", createdAt: "2026-01-02T00:00:00.000Z" }, { store });
  const runs = await store.listRuns();

  assert.equal(runs.length, 2);
  assert.deepEqual(
    runs.map((run) => run.id),
    [second.run.id, first.run.id],
  );
});
