export function createGatewayApiClient(options) {
  const baseUrl = normalizeBaseUrl(options?.baseUrl);
  const token = options?.token ?? "";
  const fetchImpl = options?.fetchImpl ?? fetch;

  return {
    get baseUrl() {
      return baseUrl;
    },

    async health() {
      return requestJson(fetchImpl, baseUrl, "/api/health", { token });
    },

    async listThreads() {
      return requestJson(fetchImpl, baseUrl, "/api/threads", { token });
    },

    async createThread(input) {
      return requestJson(fetchImpl, baseUrl, "/api/threads", {
        token,
        method: "POST",
        body: input,
      });
    },

    async getThread(threadId) {
      assertNonEmptyString(threadId, "threadId");
      return requestJson(fetchImpl, baseUrl, `/api/threads/${encodeURIComponent(threadId)}`, { token });
    },

    async sendMessage(threadId, input) {
      assertNonEmptyString(threadId, "threadId");
      return requestJson(fetchImpl, baseUrl, `/api/threads/${encodeURIComponent(threadId)}/messages`, {
        token,
        method: "POST",
        body: input,
      });
    },
  };
}

export function createGatewayEventStream(options) {
  const baseUrl = normalizeBaseUrl(options?.baseUrl);
  const token = options?.token ?? "";
  const EventSourceImpl = options?.EventSourceImpl ?? globalThis.EventSource;
  if (typeof EventSourceImpl !== "function") {
    throw new Error("EventSource is not available");
  }

  const url = new URL(`${baseUrl}/api/stream`);
  if (token) {
    url.searchParams.set("token", token);
  }

  return new EventSourceImpl(url.toString());
}

async function requestJson(fetchImpl, baseUrl, path, options = {}) {
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `Gateway request failed with status ${response.status}`);
  }
  return payload;
}

function normalizeBaseUrl(baseUrl) {
  assertNonEmptyString(baseUrl, "baseUrl");
  return baseUrl.replace(/\/+$/, "");
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}
