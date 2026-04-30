# Gateway M11

## Goal

M11 makes the M10 audit trail visible in the app UI so gateway lifecycle state can be inspected without opening storage.

## Design

- Summary card includes an event log section.
- `renderRun()` renders stored `events` from run snapshots.
- Empty/loading/error states clear the event log.
- History-loaded runs show their persisted lifecycle events.

## Acceptance

M11 is accepted when:

- Completed runs render lifecycle events in order.
- History items restore the event log with the rest of the run snapshot.
- Empty and loading states show no stale events.
- Frontend build succeeds.

## Current Limits

- Event payloads are summarized, not expanded as raw JSON.
- There is no event replay control yet.
