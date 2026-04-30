# Gateway M3

## Scope

M3 covers:

- UI controller wiring to `gateway.startRun()`
- render-only UI layer for run, messages, decision, and error states
- removal of frontend-owned mock orchestration text

M3 does not cover:

- persistent history
- Tauri command bridge
- real provider adapters

## Acceptance

M3 is accepted when:

- submitting a task calls the gateway orchestrator
- Codex and Copilot panels render gateway messages
- summary panel renders the gateway decision or error
- frontend build passes
