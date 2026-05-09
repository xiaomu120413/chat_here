import test from "node:test";
import assert from "node:assert/strict";

import { createMemoryStore } from "../store/memoryStore.js";
import {
  assertAgentProvider,
  assertAuthProvider,
  assertConnectorSource,
  assertPolicyGate,
  assertSkillResolver,
  assertStorePort,
  createAllowAllPolicyGate,
  createEmptyConnectorSource,
  createNullSkillResolver,
  createStaticAuthProvider,
} from "../ports/index.js";

test("StorePort accepts current local store implementation", () => {
  const store = createMemoryStore();

  assert.equal(assertStorePort(store), store);
  assert.throws(() => assertStorePort({}), /StorePort.saveThread must be a function/);
});

test("AgentProvider requires id and invoke", () => {
  const provider = {
    id: "codex",
    async invoke() {
      return { content: "ok" };
    },
  };

  assert.equal(assertAgentProvider(provider), provider);
  assert.throws(() => assertAgentProvider({ id: "codex" }), /AgentProvider.invoke must be a function/);
});

test("default extension ports are replaceable no-op implementations", async () => {
  const policyGate = assertPolicyGate(createAllowAllPolicyGate());
  const connectorSource = assertConnectorSource(createEmptyConnectorSource());
  const skillResolver = assertSkillResolver(createNullSkillResolver());
  const authProvider = assertAuthProvider(
    createStaticAuthProvider({
      codex: { ready: true, agentId: "codex" },
    }),
  );

  assert.deepEqual(await policyGate.evaluate({}), { allowed: true, reason: "allow_all" });
  assert.deepEqual(await connectorSource.resolve({}), []);
  assert.deepEqual(await skillResolver.resolve({}), []);
  assert.deepEqual(await authProvider.getSession("codex"), { ready: true, agentId: "codex" });
  assert.deepEqual(await authProvider.getSession("copilot"), { ready: false, agentId: "copilot" });
});
