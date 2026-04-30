# Gateway M2

## Scope

M2 covers:

- mock Codex and Copilot adapters
- adapter contract validation
- memory store for task/run/message/decision records
- single-round orchestrator
- integration tests for success and failure paths

M2 does not cover:

- file persistence
- UI wiring
- provider API calls

## Orchestration Flow

The mock single-round flow is:

`task -> run -> codex.draft -> copilot.review -> codex.revise -> gateway.summary`

The gateway persists each task, run update, message, and decision to the injected store.

## Acceptance

M2 is accepted when:

- `startRun(prompt)` returns a completed run with three messages and one decision
- adapter failures return a failed run with a structured gateway error
- memory store can read back the completed run
- adapter calls can be retried, timed out, or cancelled through the runner
- all M1 and M2 tests pass through `npm test`
