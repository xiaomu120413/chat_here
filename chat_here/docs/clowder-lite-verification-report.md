# Clowder-lite Verification Report

Date: 2026-05-08

## Verdict

Current foundation completion: 96%.

Reasoning:

- M1-M9 code-level acceptance is complete and covered by automated tests.
- Real Codex/Copilot CLI smoke passed.
- Frontend build and Rust check passed.
- Local frontend accessibility was verified after moving dev server from `1420` to `127.0.0.1:1421`.
- Remaining work is product integration, not foundation correctness: Tauri-hosted Gateway process, PC UI migration to HTTP/SSE, real CLI providers wired into `ThreadDiscussionRuntime`, and physical mobile LAN verification.

## Validation Results

| Check | Result | Evidence |
| --- | --- | --- |
| Unit/integration tests | PASS | `106 passed, 0 failed` |
| Frontend build | PASS | `vite build` completed |
| Rust/Tauri check | PASS | `cargo check` completed |
| Real Codex CLI smoke | PASS | `gpt-5.4` returned `CODEX_SMOKE_OK` |
| Real Copilot CLI smoke | PASS | `gpt-5.4-mini` returned `COPILOT_SMOKE_OK` |
| Frontend HTTP access | PASS | `http://127.0.0.1:1421/` returned `200` |
| PWA manifest | PASS | Manifest built into `dist` |
| Sensitive secret scan | PASS | No obvious `sk-*`, `ghp_*`, `github_pat_*`, `OPENAI_API_KEY=`, long inline `token=` matches found |

## Fixed During Verification

The default dev port `1420` was not reliable in this Windows environment:

```text
curl http://localhost:1420
connect to ::1 port 1420 failed: Bad access
connect to 127.0.0.1 port 1420 failed: Connection refused
```

Fix applied:

- `package.json` now runs Vite on `127.0.0.1:1421`.
- `src-tauri/tauri.conf.json` now uses `http://127.0.0.1:1421`.
- `scripts/clear-dev-port.mjs` now clears port `1421` and no longer hardcodes `1420`.

Verified:

```text
GET http://127.0.0.1:1421/ -> 200
```

## Sensitivity / Risk Assessment

| Area | Sensitivity | Status | Notes |
| --- | --- | --- | --- |
| API token for mobile Gateway | High | Partially designed | Token auth exists in HTTP API tests, but token generation/display in Tauri UI is not implemented yet. |
| Codex/Copilot auth | High | Real smoke passed | No frontend API key is required. Auth still depends on local CLI sessions. |
| Secret leakage | High | No obvious match | Regex scan found no obvious hardcoded provider keys or long tokens. |
| LAN exposure | High | Not enabled by default | Current verified dev binding is `127.0.0.1`, safe for local. Mobile LAN mode must use explicit host/token UI later. |
| CLI concurrency | Medium-High | Guarded in runtime | Queue and SessionMutex are implemented and tested. |
| Failed invocation correctness | Medium | Covered | Failed provider output does not create fake agent messages. |
| SSE duplicate/reconnect | Medium | Basic covered | Event IDs/cursors exist; reconnect replay policy still needs UI client implementation. |
| Mobile layout | Medium | Static verified | 390px/430px breakpoints exist; physical phone verification still pending. |
| True free discussion | Medium | Partially complete | Mention/target dispatch works; autonomous multi-turn speaker selection after each agent message is next-stage work. |

## Current Functional Boundary

Works now:

- PC-side existing discussion flow still works through existing orchestrator.
- New Gateway foundation supports thread/message/event/invocation snapshots.
- HTTP API can create/read threads, append messages, retry/cancel invocations, stream SSE, and expose context packet.
- Thread runtime can dispatch `@codex`, `@copilot`, and `@all` through pluggable providers.

Not fully wired yet:

- Tauri does not yet start the HTTP Gateway as a managed background service.
- PC UI does not yet consume HTTP/SSE as its primary data source.
- `ThreadDiscussionRuntime` currently has tested mock/provider boundary, but the real Codex/Copilot CLI adapters still need wrapping as `AgentProvider.invoke`.
- Actual phone-on-LAN test is pending.

## Next Execution Plan

1. Start Gateway service from Tauri.
2. Generate and display LAN URL plus short-lived token in the PC UI.
3. Add HTTP/SSE frontend client and migrate PC UI to thread snapshots.
4. Wrap real Codex/Copilot CLI adapters as `AgentProvider.invoke`.
5. Add mobile browser manual verification checklist and run against same-LAN phone.
6. Upgrade runtime from mention-targeted dispatch to event-driven free discussion after each agent output.
