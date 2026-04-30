# Gateway M1

## Scope

M1 only covers:

- gateway directory boundary
- schema for task/run/message/decision/artifact/agent/error
- explicit event creators
- pure run state machine
- automated tests for schema, events, and state transitions

M1 does not cover:

- orchestrator execution
- adapters
- persistence
- UI integration
- real Codex or Copilot calls

## State Lifecycle

The intended single-round lifecycle is:

`queued -> dispatching -> awaiting_codex -> awaiting_copilot -> revising -> summarizing -> completed`

Exceptional exits:

- `dispatching|awaiting_codex|awaiting_copilot|revising|summarizing -> failed`
- `dispatching|awaiting_codex|awaiting_copilot|revising -> cancelled`

## Acceptance

M1 is accepted when:

- schema constructors reject invalid enum values and malformed payloads
- state transitions are explicit and deterministic
- illegal transitions throw
- the gateway core can be tested without loading the UI
