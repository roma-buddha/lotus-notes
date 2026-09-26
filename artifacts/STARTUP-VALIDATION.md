# Lotus startup validation

Implemented on 2026-09-26. The existing clean workspace launch is preserved.

## Changes

- Workspace initialization and note/file operations use native workers. Scans clone a validated workspace handle instead of holding the mutation lock.
- Startup lists vaults; folders load independently, with incremental background identities and asynchronous directory caches. Newly discovered folders start collapsed to bound rendering.
- Generation checks, cancellation, scoped file-change reconciliation, directory states, and retry controls protect against stale responses and indefinite waiting. Reads time out without retrying writes.
- Editor, chat, Markdown, math, and diagram code load on demand. Detached notes bootstrap without a directory scan.

## Verification

- Frontend suite: 44 tests passed. A subsequent focused workspace run passed 6 tests, including 2 additional bootstrap/folder recovery tests (46 distinct frontend tests verified).
- Native suite: 31 tests passed, including reading/saving during a deliberately paused scan and cancellation/generation checks.
- ESLint, TypeScript/Vite build, startup bundle guard, and release executable build passed.
- Packaged native smoke passed: navigation, organizer operations, editor formatting/selection, links, external file edits/create/delete/renames, draft conflicts, recovery copies, and dark/narrow navigation. No page errors.
- Final executable benchmark verified obsolete-generation writes are rejected and detached notes open without scanning directories.
- Initial JavaScript: 403,086 bytes, one startup chunk; previously approximately 5.1 MB. Editor, AI chat, Mermaid, and KaTeX are excluded from the initial import graph.

## Final executable timings (milliseconds)

| Notes | Profile | Process → shell | WebView → shell | WebView → vaults | Selection → editable | Native read + save |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 100 | cold | 1235 | 115 | 200 | 362 | 19 |
| 100 | cached | 536 | 125 | 208 | 368 | 15 |
| 10,000 | cold | 592 | 118 | 205 | 351 | 17 |
| 10,000 | cached | 943 | 439 | 563 | 154 | 23 |
| 50,000 | cold | 676 | 145 | 265 | 317 | 18 |
| 50,000 | cached | 684 | 153 | 260 | 365 | 14 |

Both requested targets passed in all six runs: shell under 1 second after WebView navigation; first small note editable within 500 ms. Process launch also includes WebView startup and is reported separately.

Cold means a new WebView profile; cached means reopening the same profile. OS filesystem caches were not flushed. Results are from this Windows machine and disposable local workspaces, not disconnected/network drives. Slow scans are covered by deterministic native tests; physical stalled-drive and watcher-error recovery were not exercised end to end.

## Reproduce

- npm test
- cargo test --manifest-path src-tauri/Cargo.toml
- npm run lint
- npm run build
- node scripts/check-startup-bundle.mjs
- node node_modules/@tauri-apps/cli/tauri.js build --no-bundle
- Set NOTUS_EXECUTABLE to src-tauri/target/release/lotus.exe, then run node scripts/smoke-lotus-0120.mjs and node scripts/benchmark-startup.mjs.

Raw timings: startup-benchmark.json. Logs are saved beside this report. Tests did not modify the live vault. The 1.0.3 delivery rebuilds the NSIS installer from the final source, including the detached-window adjustment.
