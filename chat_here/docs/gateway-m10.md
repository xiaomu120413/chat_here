# Gateway M10

## Goal

M10 adds an audit event log so gateway state changes can be inspected, persisted, and later replayed or debugged.

## Design

- Stores support optional `appendEvent(event)`.
- Stored event shape: `{ id, runId, type, payload, createdAt }`.
- `getRun(runId)` returns `events` alongside task, run, messages, and decision.
- Orchestrator state changes go through one `applyRunEvent` helper.
- Stores remain backward-compatible with old persisted data by defaulting missing `eventsByRun` to `{}`.

## Acceptance

M10 is accepted when:

- A completed single-round run stores six lifecycle events.
- A two-round run stores continuation metadata on revision events.
- File store persists and restores event history.
- Existing message and decision persistence still works.
- Unit tests and frontend build pass.

## Current Limits

- Event replay is not implemented yet.
- UI does not render the event log yet; it is available through stored run snapshots.
