# Gateway M8

## Goal

M8 upgrades the orchestrator from a fixed single review loop to bounded multi-round Codex/Copilot discussion.

## Design

- `startRun(prompt, { maxRounds })` controls the loop count.
- Default `maxRounds` is `1`, preserving existing behavior.
- Valid range is `1..5` to prevent runaway local execution.
- Round 1 runs `codex.draft -> copilot.review -> codex.revise`.
- Later rounds repeat `copilot.review -> codex.revise` against the accumulated message history.
- The state machine supports a continue branch after `CODEX_REVISION_RECEIVED`.

## Acceptance

M8 is accepted when:

- Existing single-round tests continue to pass.
- `maxRounds: 2` produces one draft, two reviews, and two revisions.
- Run round advances to the final completed round.
- Persisted snapshots include all round messages.
- Invalid `maxRounds` fails clearly.
- UI exposes a bounded rounds input.
- Frontend build succeeds.

## Current Limits

- Termination is count-based only; no semantic "agreement reached" detector yet.
- Copilot remains mock-only until a real provider adapter is added.
