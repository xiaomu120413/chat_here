# Gateway M7

## Goal

M7 adds provider preflight so the app can detect whether the Tauri OpenAI backend is runnable before starting a gateway run.

## Design

- Backend command: `openai_health`.
- Health source: `OPENAI_API_KEY` environment variable.
- Health result: `{ provider, ready, message }`.
- Frontend behavior: Mock is always ready; Tauri OpenAI checks backend health.
- Submit guard: Gateway run is blocked when selected provider health is not ready.

## Acceptance

M7 is accepted when:

- UI shows provider health next to provider settings.
- Switching to Tauri OpenAI triggers `openai_health`.
- Missing backend API key is reported before a gateway run starts.
- Health client can be unit tested with injected `invokeImpl`.
- Frontend build succeeds.
- Rust `cargo check` succeeds with the new command registered.

## Current Limits

- Health only validates key presence, not model access or network reachability.
- Copilot health remains out of scope because Copilot is still mock-only.
