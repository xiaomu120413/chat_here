# Gateway M5

## Scope

M5 covers:

- provider configuration
- OpenAI Responses API transport
- Tauri OpenAI transport that keeps API keys in the backend environment
- Codex adapter backed by OpenAI-compatible Responses calls
- adapter factory for mock/openai provider selection
- tests with injected fake transport

M5 does not cover:

- real Copilot provider
- secret storage UI
- streaming responses

## Acceptance

M5 is accepted when:

- provider config validates mock and OpenAI settings
- missing OpenAI API key fails clearly
- `tauri_openai` provider does not require a frontend API key
- Codex adapter converts Responses output into gateway messages
- orchestrator can replace mock Codex through provider config without changing orchestration logic
- tests and frontend build pass
