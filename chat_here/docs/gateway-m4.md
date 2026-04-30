# Gateway M4

## Scope

M4 covers:

- Node `FileStore` for persisted gateway records
- browser `localStorageStore` for current UI history
- recent run list in the UI
- click-to-load run snapshots

M4 does not cover:

- SQLite
- Tauri Rust persistence bridge
- multi-window synchronization

## Acceptance

M4 is accepted when:

- completed runs can be restored from `FileStore`
- UI runs survive page reload through localStorage
- recent runs display task title, status, and timestamp
- clicking a history item renders the stored run
- tests and frontend build pass
