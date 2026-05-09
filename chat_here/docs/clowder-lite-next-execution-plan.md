# Clowder-lite Next Execution Plan

Date: 2026-05-08

## Goal

Move from tested Gateway foundation to a real app path:

PC Tauri app starts a managed Gateway, exposes URL/token, PC UI can consume Gateway APIs/SSE, and Codex/Copilot can be invoked through the new thread runtime.

## M10: Execution Plan and Boundaries

Acceptance:

- Plan is documented.
- Current boundary is explicit: Node Gateway modules are tested, Tauri does not yet host the full API.
- Sensitive defaults are explicit: LAN exposure is opt-in.

## M11: Tauri-managed Gateway Service

Implementation:

- Add Rust backend state for Gateway lifecycle.
- Add commands:
  - `gateway_status`
  - `start_gateway_service`
  - `stop_gateway_service`
- Generate token in backend.
- Support local-only bind `127.0.0.1` and opt-in LAN bind `0.0.0.0`.
- Expose `/api/health`.

Acceptance:

- UI can start local Gateway.
- UI can start LAN Gateway.
- UI shows local URL, LAN URL, token, and status.
- `GET /api/health` returns 200.
- LAN mode is never enabled silently.

## M12: HTTP/SSE Frontend Client

Implementation:

- Add API client module.
- Add SSE client module.
- PC UI reads thread list/snapshot from API where available.
- Existing local orchestrator remains fallback.

Acceptance:

- PC UI can read Gateway health through HTTP.
- PC UI can subscribe to SSE.
- No duplicate event bubbles on reconnect.

## M13: Real CLI Providers for Thread Runtime

Implementation:

- Wrap Codex CLI transport as `AgentProvider.invoke`.
- Wrap Copilot CLI transport as `AgentProvider.invoke`.
- Map context packet to natural discussion prompt.

Acceptance:

- `@codex` through thread runtime creates a real Codex message.
- `@copilot` through thread runtime creates a real Copilot message.
- Provider failure records failed invocation only.

## M14: Event-driven Free Discussion

Implementation:

- After each agent output, route the new agent message.
- Use `GATEWAY_NEXT` only as hint.
- Enforce max depth and max consecutive speaker limits.
- Gateway can stop on `summary`, no target, or depth limit.

Acceptance:

- Discussion is not fixed one-person-one-turn.
- Same speaker can continue once when useful.
- A2A cannot loop forever.

## M15: Mobile LAN Verification

Implementation:

- Add manual checklist.
- Verify phone can open Gateway URL.
- Verify token required.
- Verify phone can see same thread.

Acceptance:

- Same-LAN phone reaches `/api/health`.
- Unauthorized request fails.
- Authorized request succeeds.
