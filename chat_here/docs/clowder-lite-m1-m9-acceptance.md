# Clowder-lite M1-M9 Acceptance

Date: 2026-05-08

## Scope Completed

This milestone implements the PC-first, mobile-ready Gateway foundation from the RFC/Story plan.

## M1: PC Runtime Baseline

Implemented:

- `scripts/clear-dev-port.mjs` clears only stale own Vite process on port 1420 and fails on unrelated occupancy.
- `scripts/smoke-cli.mjs` runs real Codex and Copilot CLI smoke tests.
- Tauri command `cli_smoke_test` exposes real CLI smoke to UI.
- UI self-test now fails visibly instead of faking success.

Acceptance:

- Codex smoke returns `CODEX_SMOKE_OK`.
- Copilot smoke returns `COPILOT_SMOKE_OK`.
- `[object Object]` style errors are normalized by existing render/error tests.

## M2: Thread, Message, Event Store

Implemented:

- `Thread`, `ThreadMessage`, and `GatewayEventRecord` schema.
- Store APIs for thread snapshot, messages, and append-only events.
- Memory, file, and localStorage stores preserve thread data.
- Future fields are preserved: `source.type`, `targetAgents`, `replyTo`, `metadata`, `a2a`.

Acceptance:

- Multiple threads do not leak messages.
- Snapshot restores thread/messages/events/invocations.
- Events receive stable per-thread cursor values.

## M3: Invocation Lifecycle and Queue

Implemented:

- `InvocationRecord` schema with `queued/running/succeeded/failed/canceled`.
- Store APIs for save/update/get/list invocations.
- `InvocationQueue` and `SessionMutex`.

Acceptance:

- Retry creates a new invocation attempt without duplicating user messages.
- Queue respects ordering and priority.
- Mutex prevents same thread or same agent session concurrency.

## M4: Mention Discussion Router

Implemented:

- `MentionRouter` for `@codex`, `@copilot`, `@all`, unknown mentions, auto routing.
- A2A depth guard.
- `GATEWAY_NEXT` is treated as a hint only when there is no explicit mention.

Acceptance:

- Explicit mentions route to the correct agent set.
- Unknown mentions do not crash routing.
- Max depth stops A2A loops.

## M5: Gateway HTTP API

Implemented:

- Token-protected HTTP server.
- APIs:
  - `GET /api/health`
  - `GET /api/threads`
  - `POST /api/threads`
  - `GET /api/threads/:threadId`
  - `POST /api/threads/:threadId/messages`
  - `GET /api/threads/:threadId/events`
  - `POST /api/invocations/:invocationId/retry`
  - `POST /api/invocations/:invocationId/cancel`
  - `GET /api/diagnostics/self-test`
  - `GET /api/threads/:threadId/context-packet`

Acceptance:

- Missing token is rejected.
- Token requests can create/list/read threads.
- Message posting writes message and event.
- Retry/cancel invocation APIs update state and emit events.

## M6: SSE Realtime

Implemented:

- `GET /api/stream`.
- `GatewayEventBus`.
- SSE events include `id`, `event`, and JSON `data`.
- Server-published events flow to stream subscribers.

Acceptance:

- Stream receives `message.created`.
- Event ids include thread cursor, for example `threadId:2`.

## M7: Mobile PWA Layout

Implemented:

- `manifest.webmanifest`.
- SVG icons.
- Mobile rail controls for session list and member/details panel.
- 430px and 390px CSS breakpoints.
- Mobile layout uses `100dvh`, hides horizontal overflow, and keeps composer usable.

Acceptance:

- Static tests verify viewport, manifest, breakpoints, and session toggle CSS.
- Frontend build includes manifest.

## M8: Context Packet Lite

Implemented:

- `ContextAssembler`.
- Default recent burst is 8 messages.
- Thread summary and open questions are injected from metadata or options.
- Failed/canceled invocation output messages are excluded.
- HTTP diagnostics exposes context packet.

Acceptance:

- Long threads are clipped to recent burst.
- Excluded invocation outputs do not enter context.

## M9: Extension Ports

Implemented:

- `StorePort`
- `AgentProvider`
- `SkillResolver`
- `PolicyGate`
- `ConnectorSource`
- `AuthProvider`
- No-op/default local implementations.

Acceptance:

- Current local store satisfies `StorePort`.
- Mock provider can satisfy `AgentProvider`.
- Extension ports are replaceable.

## Additional Integration

Implemented after M9 because it was a real functional gap:

- `ThreadDiscussionRuntime`.
- `POST /api/threads/:threadId/messages` can dispatch through runtime when a runtime is supplied.
- Runtime connects router, queue, invocation lifecycle, context packet, provider invocation, messages, events, and SSE event publishing.

Acceptance:

- `@codex` creates one Codex invocation and one Codex message.
- `@all` dispatches Codex then Copilot sequentially.
- Provider failure records failed invocation and does not create fake agent message.
- HTTP message endpoint can trigger runtime dispatch.

## Verification

Commands passed:

```text
npm.cmd test
npm.cmd run frontend:build
cargo check
npm.cmd run smoke:cli
```

Latest test count:

```text
106 passed, 0 failed
```

Latest CLI smoke:

```text
PASS codex: model gpt-5.4 returned CODEX_SMOKE_OK
PASS copilot: model gpt-5.4-mini returned COPILOT_SMOKE_OK
```

## Remaining Follow-up

These are intentionally left for the next implementation pass:

- Start the HTTP Gateway from Tauri and expose the LAN URL/token in the PC UI.
- Migrate the existing PC UI from local run-state rendering to the HTTP thread snapshot + SSE client.
- Wrap the real Codex/Copilot adapters as `AgentProvider.invoke` for the new `ThreadDiscussionRuntime`.
- Add a browser/manual mobile verification pass on an actual phone in the same LAN.
- Add true free-speech A2A scheduling after each agent output, instead of the current mention-targeted sequential dispatch.
