# RFC: Clowder-lite PC First, Mobile Ready Gateway

## Status

Draft

## Owner

`chat_here`

## Background

当前 `chat_here` 已经具备 Tauri 桌面壳、Codex/Copilot CLI 调用、IM 群聊样式、初步讨论编排和自检能力。但现有实现仍偏 demo：

- UI 和 Gateway runtime 耦合较重
- 手机端无法直接接入 Tauri command
- 讨论状态缺少 thread/invocation/queue 的稳定生命周期
- agent 回复仍容易被当成普通 message，而不是一次可追踪 invocation 的结果
- 后续多人、人类 + AI、connector、A2A 扩展缺少协议骨架

目标是先把 PC 端讨论体验做稳，同时预留手机接入和 A2A 演进空间。

## Goals

- PC 端作为第一 Gateway 宿主，继续运行 Codex/Copilot CLI。
- 手机端通过浏览器/PWA 访问同一个 Gateway。
- 支持多人 + Codex + Copilot 在同一个 thread 中讨论。
- Gateway 负责调度、队列、调用生命周期、上下文和事件审计。
- 第一版轻量实现，但数据结构保留 A2A 扩展字段。
- 后续 Redis、skills、SOP、connector、权限系统都通过 port/interface 替换。

## Non-Goals

- 第一版不实现 Redis。
- 第一版不实现复杂 skills marketplace。
- 第一版不实现完整 SOP workflow。
- 第一版不实现企业权限系统。
- 第一版不接 Feishu/Telegram/WeCom 等 connector。
- 第一版不实现完整外部 A2A agent registry。

这些不是不要，而是先保留接口，不进入 MVP 实现。

## Design Principles

1. PC first, mobile ready.
2. Lightweight implementation, protocol-shaped interfaces.
3. Message is visible UI data; invocation is executable work.
4. Gateway does scheduling; agents do discussion.
5. Context is assembled as a packet, not raw full history.
6. Realtime rendering must use stable message/bubble identity.
7. Every important runtime state must be inspectable through events.

## Proposed Architecture

```text
PC Desktop
  Tauri Shell
  Web UI
  Gateway HTTP Server
  Gateway Runtime
    ThreadStore
    MessageStore
    InvocationStore
    EventStore
    InvocationQueue
    MentionRouter
    ContextAssembler
    AgentRunner
      Codex CLI
      Copilot CLI

Mobile Browser / PWA
  Web UI
  API Client
  SSE Client
```

## Core Model

### Thread

```ts
interface Thread {
  id: string;
  title: string;
  projectPath?: string;
  participants: string[];
  status: "idle" | "running" | "failed" | "completed";
  createdAt: string;
  updatedAt: string;
}
```

### Message

```ts
interface Message {
  id: string;
  threadId: string;
  source: {
    type: "user" | "agent" | "gateway" | "connector" | "a2a";
    id: string;
    displayName?: string;
  };
  targetAgents: string[];
  content: string;
  mentions: string[];
  replyTo?: string;
  invocationId?: string;
  a2a?: {
    depth: number;
    parentMessageId?: string;
    handoffReason?: string;
  };
  createdAt: string;
}
```

### InvocationRecord

```ts
interface InvocationRecord {
  id: string;
  threadId: string;
  agentId: "codex" | "copilot";
  triggerMessageId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  provider: "codex_cli" | "copilot_cli" | "mock" | "a2a";
  model: string;
  idempotencyKey: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}
```

### QueueEntry

```ts
interface QueueEntry {
  id: string;
  threadId: string;
  sourceCategory: "user" | "agent" | "connector" | "a2a";
  targetAgents: string[];
  priority: "normal" | "urgent";
  status: "queued" | "processing";
  triggerMessageId: string;
  idempotencyKey: string;
  createdAt: string;
}
```

### GatewayEvent

```ts
type GatewayEventType =
  | "thread.created"
  | "message.created"
  | "routing.decided"
  | "invocation.queued"
  | "invocation.running"
  | "invocation.succeeded"
  | "invocation.failed"
  | "queue.updated"
  | "summary.generated"
  | "diagnostic.updated";
```

Events are append-only. UI snapshots are derived from stores; diagnostics can replay events.

## API Surface

Minimum API for PC UI and mobile UI:

```text
GET  /api/health
GET  /api/threads
POST /api/threads
GET  /api/threads/:threadId
POST /api/threads/:threadId/messages
GET  /api/threads/:threadId/events
POST /api/invocations/:invocationId/retry
POST /api/invocations/:invocationId/cancel
GET  /api/diagnostics/self-test
GET  /api/stream
```

## Realtime

Use SSE for MVP.

Why SSE:

- Browser native.
- Good enough for server-to-client events.
- Simpler than WebSocket.
- Built-in reconnect.

WebSocket is reserved for later features such as typing, presence, cursor sharing, and richer collaborative controls.

## Mobile Access Requirements

- Gateway can listen on `0.0.0.0`.
- PC UI displays mobile access URL.
- Local bearer token protects API.
- Mobile stores token in localStorage.
- Thread snapshot endpoint supports reconnect recovery.
- SSE cursor or snapshot fallback prevents duplicated messages.
- Responsive UI works at 390px width.

## Modification Points

### Runtime

- Add `ThreadStore`, `MessageStore`, `InvocationStore`, `EventStore`.
- Add `InvocationQueue` and `SessionMutex`.
- Add `MentionRouter` and `RoutingDecision`.
- Add `ContextAssembler`.
- Keep Codex/Copilot CLI providers behind `AgentRunner`.

### Frontend

- Change UI from direct `startRun()` calls to Gateway API calls.
- Render from `ThreadSnapshot`.
- Use stable bubble key:

```text
agent message: source.id + invocationId + kind
user message: source.id + messageId
```

- Add mobile responsive layout.
- Add self-test and diagnostics panels.

### Tauri / Backend

- Keep current CLI commands.
- Add or launch Gateway HTTP server.
- Handle port conflict explicitly.
- Expose mobile URL and auth token.

### Persistence

- MVP can use file or SQLite.
- Store contracts must not depend on localStorage-only behavior.
- Redis-compatible port remains for later.

## Testing Strategy

### Unit Tests

- schema validation
- message mention parsing
- routing decision
- invocation state transition
- queue ordering
- session mutex contention
- context packet assembly
- stable bubble key reconciliation

### Integration Tests

- post message -> invocation queued -> invocation running -> agent message created
- failed CLI -> invocation failed -> UI receives error event
- retry failed invocation without duplicating user message
- `@codex` routes only to Codex
- `@copilot` routes only to Copilot
- `@all` creates discussion routing

### API Tests

- `GET /api/health`
- create thread
- post message
- read thread snapshot
- read events
- unauthorized request rejected
- authorized request accepted

### Realtime Tests

- SSE emits message and invocation events
- reconnect can recover from snapshot
- duplicate SSE event does not duplicate bubble

### Manual Tests

- PC can run Codex smoke.
- PC can run Copilot smoke.
- PC can start discussion.
- Phone can open mobile URL on LAN.
- Phone can send message.
- Phone can see PC-originated message in realtime.
- PC can see phone-originated message in realtime.

## Acceptance Criteria

RFC is considered implemented when:

- PC UI works through Gateway runtime, not direct demo-only orchestration.
- A discussion thread can include user, Codex, and Copilot messages.
- Codex/Copilot calls are represented as invocation records.
- Invocation states are visible and testable.
- Queue prevents concurrent CLI execution for the same thread/session.
- `@codex`, `@copilot`, and `@all` route correctly.
- Gateway exposes HTTP APIs for thread snapshot and message creation.
- Gateway exposes SSE for realtime updates.
- A phone browser on the same LAN can open the app and participate in a thread.
- Failed invocation can be retried without duplicating the original user message.
- UI does not show fake success when CLI or summary fails.
- No `[object Object]` errors are visible to users.
- Core stores and runtime are behind ports/interfaces suitable for future Redis, connector, skills, SOP, and A2A expansion.

## Open Questions

- Gateway HTTP server should be Node-based first or Rust/Tauri-based first?
- MVP persistence should be file JSON or SQLite?
- Should mobile access token be shown as raw URL or QR code first?
- Should `@all` run Codex/Copilot serially or through a queue fanout model?
- Should summary be mandatory for every discussion or only when user asks/turn limit reached?

## Recommendation

Implement in this order:

1. PC runtime stabilization.
2. Thread/message/invocation/event stores.
3. Invocation queue and mutex.
4. Mention router.
5. Gateway HTTP API.
6. SSE realtime.
7. Mobile responsive PWA.
8. Context packet lite.
9. Extension ports.
