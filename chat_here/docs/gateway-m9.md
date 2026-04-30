# Gateway M9

## Goal

M9 gives Copilot provider parity with Codex so both sides of the discussion can be backed by real model transports instead of keeping Copilot mock-only.

## Design

- New `createCopilotAdapter(config, options)` mirrors the Codex transport contract.
- Copilot supports `mock`, `openai`, and `tauri_openai` provider ids.
- Tauri Copilot uses the same backend `openai_response` command and does not receive a frontend API key.
- UI exposes independent Codex and Copilot provider/model settings.
- Provider health checks run if either selected agent uses `tauri_openai`.

## Acceptance

M9 is accepted when:

- Factory can create OpenAI-backed Copilot.
- Factory can create Tauri OpenAI-backed Copilot without frontend API key.
- Orchestrator can run with both Codex and Copilot replaced by injected model transports.
- UI can configure Codex and Copilot providers independently.
- Unit tests and frontend build pass.

## Current Limits

- "Copilot" is a gateway role, not a GitHub Copilot API integration.
- Both real roles currently share the OpenAI Responses-compatible transport.
