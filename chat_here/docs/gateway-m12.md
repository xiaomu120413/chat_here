# Gateway M12

## Goal

M12 wires authentication into both Codex and Copilot provider calls instead of treating OpenAI auth as one undifferentiated global check.

## Design

- Tauri request payload includes `agent`.
- Backend resolves credentials by agent without requiring project-stored keys:
  - Codex: `CODEX_OPENAI_API_KEY`, fallback `~/.codex/auth.json`, fallback `OPENAI_API_KEY`.
  - Copilot: `COPILOT_OPENAI_API_KEY`, fallback `~/.codex/auth.json`, fallback `OPENAI_API_KEY`.
- `openai_health` returns per-agent auth status.
- UI preflight checks only selected Tauri OpenAI agents.
- Codex and Copilot adapters pass their agent identity to the transport.
- UI exposes auth buttons that ask Tauri to launch `codex login` or `gh auth login`.
- UI always runs real Tauri OpenAI providers; the previous mock selector is removed from the app surface.
- Model selection is a dropdown for both Codex and Copilot.
- Codex auth accepts either a stored `OPENAI_API_KEY` or the Codex login `tokens.access_token` from `~/.codex/auth.json`.
- Copilot model labels follow the GitHub Copilot model family, but the current backend still uses the OpenAI-compatible reviewer transport until a dedicated `gh copilot` adapter is implemented.
- Non-OpenAI Copilot models are blocked at submit time until the dedicated `gh copilot` adapter is implemented; they are shown to make the provider mismatch explicit instead of silently down-mapping to an OpenAI model.

## Acceptance

M12 is accepted when:

- Codex Tauri calls carry `agent: "codex"`.
- Copilot Tauri calls carry `agent: "copilot"`.
- Backend rejects unsupported agents.
- Health results report Codex and Copilot auth independently.
- UI blocks only when a selected real provider lacks auth.
- Unit tests, frontend build, and Rust `cargo check` pass.

## Current Limits

- Codex/OpenAI auth is local-machine based; secrets are not written to this project.
- Copilot's dedicated GitHub Copilot API auth is not implemented; the current Copilot role uses the OpenAI-compatible reviewer transport.
