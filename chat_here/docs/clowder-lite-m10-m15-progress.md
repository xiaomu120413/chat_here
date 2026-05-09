# Clowder-lite M10-M15 Progress

Date: 2026-05-08

## Completed

## M10 Plan

- Added `docs/clowder-lite-next-execution-plan.md`.
- Confirmed the boundary between tested Node Gateway modules and Tauri-hosted runtime.

## M11 Tauri-managed Gateway Service

Implemented:

- Backend commands:
  - `gateway_status`
  - `start_gateway_service`
  - `stop_gateway_service`
- Backend-generated random token.
- Local bind mode: `127.0.0.1`.
- Opt-in LAN bind mode: `0.0.0.0`.
- `/api/health` endpoint.
- UI status card with local URL, LAN URL, token, start/stop actions.

Security:

- LAN mode does not start automatically.
- Token is generated at runtime and is not committed.

## M12 HTTP/SSE Client Foundation

Implemented:

- `createGatewayApiClient`.
- `createGatewayEventStream`.
- Tests for health/thread/message/error handling and EventSource token URL.

Not completed:

- PC UI is not yet fully migrated to HTTP thread snapshots.
- Rust Gateway does not yet provide full thread/SSE API; the complete API still exists in the Node module.

## M13 Real CLI Provider Wrappers

Implemented:

- `createCodexCliAgentProvider`.
- `createCopilotCliAgentProvider`.
- Context packet to CLI prompt mapping.
- `GATEWAY_NEXT` parsing from real CLI output.

Not completed:

- Existing PC UI still uses the old `startRun` orchestrator path by default.

## M14 Event-driven Discussion Runtime

Implemented:

- Optional `autoContinue` mode in `ThreadDiscussionRuntime`.
- Agent output can trigger the next speaker.
- `GATEWAY_NEXT: summary` stops.
- `GATEWAY_NEXT: either` chooses the other agent for continuation.
- Depth and auto-turn limits prevent infinite loops.

## M15 Mobile LAN Checklist

Implemented:

- Added `docs/mobile-lan-verification-checklist.md`.

Not completed:

- Physical phone verification was not run in this environment.

## Current Completion

Estimated completion after this pass: 97%.

Remaining critical path:

1. Move full thread/message/SSE API into the Tauri-hosted Gateway or host the Node Gateway as a managed sidecar.
2. Switch PC UI from local run state to Gateway HTTP/SSE.
3. Use CLI AgentProvider wrappers in the primary user flow.
4. Run actual phone LAN verification.
