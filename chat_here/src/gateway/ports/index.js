export function assertStorePort(store) {
  assertMethods(store, "StorePort", [
    "saveThread",
    "getThread",
    "listThreads",
    "getThreadSnapshot",
    "appendThreadMessage",
    "appendThreadEvent",
    "saveInvocation",
    "updateInvocation",
    "getInvocation",
    "listThreadInvocations",
  ]);
  return store;
}

export function assertAgentProvider(provider) {
  assertMethods(provider, "AgentProvider", ["invoke"]);
  if (typeof provider.id !== "string" || provider.id.trim().length === 0) {
    throw new Error("AgentProvider.id must be a non-empty string");
  }
  return provider;
}

export function createAllowAllPolicyGate() {
  return {
    async evaluate() {
      return {
        allowed: true,
        reason: "allow_all",
      };
    },
  };
}

export function createEmptyConnectorSource() {
  return {
    async resolve() {
      return [];
    },
  };
}

export function createNullSkillResolver() {
  return {
    async resolve() {
      return [];
    },
  };
}

export function createStaticAuthProvider(session = {}) {
  return {
    async getSession(agentId) {
      return session[agentId] ?? { ready: false, agentId };
    },
  };
}

export function assertPolicyGate(policyGate) {
  assertMethods(policyGate, "PolicyGate", ["evaluate"]);
  return policyGate;
}

export function assertConnectorSource(connectorSource) {
  assertMethods(connectorSource, "ConnectorSource", ["resolve"]);
  return connectorSource;
}

export function assertSkillResolver(skillResolver) {
  assertMethods(skillResolver, "SkillResolver", ["resolve"]);
  return skillResolver;
}

export function assertAuthProvider(authProvider) {
  assertMethods(authProvider, "AuthProvider", ["getSession"]);
  return authProvider;
}

function assertMethods(value, label, methods) {
  if (!value || typeof value !== "object") {
    throw new Error(`${label} must be an object`);
  }
  for (const method of methods) {
    if (typeof value[method] !== "function") {
      throw new Error(`${label}.${method} must be a function`);
    }
  }
}
