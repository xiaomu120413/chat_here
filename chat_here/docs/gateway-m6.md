# Gateway M6

## Goal

M6 makes the first real-provider path usable from the Tauri app without exposing the OpenAI API key to the WebView. The frontend selects `tauri_openai`; the gateway still talks through the same adapter interface; the Rust backend owns the outbound HTTPS call to the OpenAI Responses API.

## Design

- Provider id: `tauri_openai`.
- Frontend payload: `{ provider: "tauri_openai", model }`.
- Backend command: `openai_response`.
- Backend secret source: `OPENAI_API_KEY` environment variable.
- Backend request: `POST {baseUrl}/responses` with bearer auth and `{ model, input }`.
- Adapter contract: OpenAI response payload is normalized into the existing gateway draft/revision messages.

## Acceptance

M6 is accepted when:

- UI can switch Codex between mock and Tauri OpenAI.
- Selecting Tauri OpenAI does not require an API key in browser JavaScript config.
- Tauri backend returns a clear error when `OPENAI_API_KEY` is absent.
- Adapter factory can create a Tauri OpenAI-backed Codex provider through normal provider config.
- Unit tests cover provider validation and backend transport injection.
- Frontend build succeeds.
- Rust `cargo check` succeeds with the Tauri command registered.

## Manual Check

Run from a terminal that has `OPENAI_API_KEY` set:

```powershell
npm run dev
```

Then select `Tauri OpenAI`, keep or change the model, submit a task, and confirm the Codex panel contains a real model response instead of the mock draft.

## Current Limits

- Copilot is still mock-only.
- Responses are non-streaming.
- Secrets are environment-based only; no encrypted settings UI yet.
