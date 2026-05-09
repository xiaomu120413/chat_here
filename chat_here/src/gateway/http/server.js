import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";

import { createGatewayEventBus, formatSseEvent } from "./eventBus.js";
import { assembleContextPacket } from "../orchestrator/contextAssembler.js";
import {
  AgentId,
  InvocationStatus,
  MessageSourceType,
  ThreadMessageKind,
  createInvocationRecord,
  createThread,
  createThreadMessage,
} from "../schema/index.js";

export function createGatewayHttpServer(options) {
  if (!options?.store) {
    throw new Error("gateway HTTP server requires a store");
  }
  const token = normalizeToken(options.token);
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const store = options.store;
  const eventBus = options.eventBus ?? createGatewayEventBus();
  const runtime = options.runtime ?? null;

  const server = createServer(async (request, response) => {
    try {
      await handleRequest({ request, response, store, token, eventBus, runtime });
    } catch (error) {
      writeJson(response, 500, {
        error: {
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  });

  return {
    async start() {
      const listenPort = port === 0 ? await findAvailableSafePort() : port;
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(listenPort, host, resolve);
      });
      const address = server.address();
      return {
        host,
        port: typeof address === "object" && address ? address.port : listenPort,
        url: `http://${host}:${typeof address === "object" && address ? address.port : listenPort}`,
      };
    },

    async stop() {
      if (!server.listening) {
        return;
      }
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },

    raw: server,
    eventBus,
  };
}

async function findAvailableSafePort() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = 20_000 + Math.floor(Math.random() * 30_000);
    if (await canBindPort(port)) {
      return port;
    }
  }
  throw new Error("failed to find an available gateway test port");
}

async function canBindPort(port) {
  return new Promise((resolve) => {
    const probe = createTcpServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => {
      probe.close(() => resolve(true));
    });
  });
}

async function handleRequest({ request, response, store, token, eventBus, runtime }) {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.method === "OPTIONS") {
    writeOptions(response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    writeJson(response, 200, { ok: true, service: "gateway", mobileReady: true });
    return;
  }

  if (!isAuthorized(request, url, token)) {
    writeJson(response, 401, {
      error: {
        code: "UNAUTHORIZED",
        message: "missing or invalid gateway token",
      },
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/stream") {
    openSseStream({ request, response, eventBus });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/threads") {
    writeJson(response, 200, { threads: await store.listThreads() });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/threads") {
    const body = await readJson(request);
    const thread = await store.saveThread(
      createThread({
        title: body.title ?? "New discussion",
        createdBy: body.createdBy ?? { type: MessageSourceType.HUMAN, id: AgentId.USER },
        metadata: body.metadata ?? {},
      }),
    );
    const event = await store.appendThreadEvent({
      threadId: thread.id,
      type: "thread.created",
      payload: { threadId: thread.id },
    });
    eventBus.publish(event);
    writeJson(response, 201, { thread, event });
    return;
  }

  const threadMatch = matchPath(url.pathname, /^\/api\/threads\/([^/]+)$/);
  if (request.method === "GET" && threadMatch) {
    const snapshot = await store.getThreadSnapshot(threadMatch[0]);
    if (!snapshot) {
      writeJson(response, 404, notFound("thread"));
      return;
    }
    writeJson(response, 200, snapshot);
    return;
  }

  const threadMessagesMatch = matchPath(url.pathname, /^\/api\/threads\/([^/]+)\/messages$/);
  if (request.method === "POST" && threadMessagesMatch) {
    const threadId = threadMessagesMatch[0];
    if (!(await store.getThread(threadId))) {
      writeJson(response, 404, notFound("thread"));
      return;
    }

    const body = await readJson(request);
    const message = await store.appendThreadMessage(
      createThreadMessage({
        threadId,
        kind: body.kind ?? ThreadMessageKind.USER,
        source: body.source ?? { type: MessageSourceType.HUMAN, id: AgentId.USER },
        targetAgents: body.targetAgents ?? [],
        replyTo: body.replyTo ?? null,
        content: body.content,
        metadata: body.metadata ?? {},
        a2a: body.a2a ?? {},
      }),
    );
    const event = await store.appendThreadEvent({
      threadId,
      type: "message.created",
      payload: { messageId: message.id, source: message.source },
    });
    eventBus.publish(event);
    let dispatch = null;
    if (runtime && message.kind === ThreadMessageKind.USER && body.dispatch !== false) {
      dispatch = await runtime.handleUserMessage(message);
    }
    writeJson(response, 201, { message, event, dispatch });
    return;
  }

  const threadEventsMatch = matchPath(url.pathname, /^\/api\/threads\/([^/]+)\/events$/);
  if (request.method === "GET" && threadEventsMatch) {
    const snapshot = await store.getThreadSnapshot(threadEventsMatch[0]);
    if (!snapshot) {
      writeJson(response, 404, notFound("thread"));
      return;
    }
    writeJson(response, 200, { events: snapshot.events });
    return;
  }

  const contextPacketMatch = matchPath(url.pathname, /^\/api\/threads\/([^/]+)\/context-packet$/);
  if (request.method === "GET" && contextPacketMatch) {
    const snapshot = await store.getThreadSnapshot(contextPacketMatch[0]);
    if (!snapshot) {
      writeJson(response, 404, notFound("thread"));
      return;
    }
    const recentLimit = url.searchParams.has("recentLimit")
      ? Number(url.searchParams.get("recentLimit"))
      : undefined;
    writeJson(response, 200, {
      contextPacket: assembleContextPacket(snapshot, { recentLimit }),
    });
    return;
  }

  const retryMatch = matchPath(url.pathname, /^\/api\/invocations\/([^/]+)\/retry$/);
  if (request.method === "POST" && retryMatch) {
    const current = await store.getInvocation(retryMatch[0]);
    if (!current) {
      writeJson(response, 404, notFound("invocation"));
      return;
    }
    if (current.status !== InvocationStatus.FAILED) {
      writeJson(response, 409, {
        error: {
          code: "INVOCATION_NOT_RETRYABLE",
          message: "only failed invocations can be retried",
        },
      });
      return;
    }

    const retry = await store.saveInvocation(
      createInvocationRecord({
        threadId: current.threadId,
        agentId: current.agentId,
        triggerMessageId: current.triggerMessageId,
        attempt: current.attempt + 1,
        metadata: { retryOf: current.id },
      }),
    );
    const event = await store.appendThreadEvent({
      threadId: current.threadId,
      type: "invocation.retry_queued",
      payload: { invocationId: retry.id, retryOf: current.id },
    });
    eventBus.publish(event);
    writeJson(response, 201, { invocation: retry, event });
    return;
  }

  const cancelMatch = matchPath(url.pathname, /^\/api\/invocations\/([^/]+)\/cancel$/);
  if (request.method === "POST" && cancelMatch) {
    const current = await store.getInvocation(cancelMatch[0]);
    if (!current) {
      writeJson(response, 404, notFound("invocation"));
      return;
    }
    const invocation = await store.updateInvocation(current.id, {
      status: InvocationStatus.CANCELED,
      finishedAt: new Date().toISOString(),
      error: "cancelled",
    });
    const event = await store.appendThreadEvent({
      threadId: invocation.threadId,
      type: "invocation.canceled",
      payload: { invocationId: invocation.id },
    });
    eventBus.publish(event);
    writeJson(response, 200, { invocation, event });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/diagnostics/self-test") {
    writeJson(response, 200, {
      ok: true,
      checks: {
        http: "pass",
        cliSmoke: "run smoke:cli on the PC host",
      },
    });
    return;
  }

  writeJson(response, 404, notFound("route"));
}

function openSseStream({ request, response, eventBus }) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  response.write(formatSseEvent({ id: "connected", type: "gateway.connected", data: { ok: true } }));

  const unsubscribe = eventBus.subscribe((event) => {
    response.write(formatSseEvent(event));
  });

  request.on("close", () => {
    unsubscribe();
  });
}

function normalizeToken(token) {
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new Error("gateway HTTP server requires a non-empty token");
  }
  return token.trim();
}

function isAuthorized(request, url, token) {
  const header = request.headers.authorization ?? "";
  if (header === `Bearer ${token}`) {
    return true;
  }
  return url.searchParams.get("token") === token;
}

function matchPath(pathname, pattern) {
  const match = pathname.match(pattern);
  return match ? match.slice(1).map(decodeURIComponent) : null;
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("request body must be valid JSON");
  }
}

function writeJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function writeOptions(response) {
  response.writeHead(204, {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "cache-control": "no-store",
  });
  response.end();
}

function notFound(resource) {
  return {
    error: {
      code: "NOT_FOUND",
      message: `${resource} not found`,
    },
  };
}
