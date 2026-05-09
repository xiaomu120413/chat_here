# iOS App Plan

## Decision

Build the phone client as a Tauri iOS app first. It reuses the existing Vite mobile UI and Gateway HTTP/SSE protocol, so the product can keep one discussion experience across desktop, browser preview, and iPhone.

This is not a rewrite to SwiftUI for M1. Native Swift can be added later for platform-only surfaces such as push notifications, Keychain-only auth storage, share extensions, or widgets.

## Product Shape

- Desktop app: starts Gateway, owns Codex/Copilot sessions, mirrors discussion state.
- iOS app: native app shell with the mobile chat UI, connects to the desktop Gateway over LAN or a future hosted Gateway.
- Current PWA: remains as a fallback and smoke-test target.

## Build Requirements

- macOS with Xcode installed, not just Command Line Tools.
- Rust iOS targets: `aarch64-apple-ios`, `x86_64-apple-ios`, `aarch64-apple-ios-sim`.
- CocoaPods installed.
- Apple Developer Program for TestFlight/App Store distribution and signing.

## Commands

Run from `chat_here` on macOS:

```bash
npm ci
npm run ios:init
npm run ios:open
```

For CLI development:

```bash
npm run ios:dev
```

For archive/build:

```bash
npm run ios:build
```

## Implementation Notes

- `vite.config.js` reads `TAURI_DEV_HOST`, which Tauri iOS uses so the iPhone can reach the development server.
- `tauri.conf.json` uses bundle identifier `app.chathere.mobile`; the same identifier must be registered in App Store Connect before distribution.
- The mobile client already strips token from URLs, expires saved credentials, and provides a disconnect path.
- The first iOS app version should still connect to a manually supplied Gateway URL/token. QR pairing can be added next.

## Acceptance

- On macOS, `npm run ios:init` creates `src-tauri/gen/apple`.
- `npm run ios:open` opens Xcode without manual project edits.
- On iPhone or simulator, the app loads the existing mobile chat UI.
- Connecting to an invalid Gateway token stays offline and shows an auth error.
- Connecting to a valid Gateway token lists threads, sends messages, and receives SSE updates.
- `npm test`, `npm run frontend:build`, and `npm run smoke:mobile` pass before every iOS build.
