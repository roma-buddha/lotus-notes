# Lotus release history

This is Lotus’s built-in, read-only release record. It opens from **Settings → About** and is stored with the application rather than in a vault. Every release entry records its date, user-facing behavior, compatibility or data-handling notes, and verification. Future releases must add a dated, detailed entry here before packaging.

## 1.0.4 — 2026-09-26 — Flexible vault notes and editing menus

- Allow Markdown notes directly in a vault as well as inside one of its folders. Explorer drops onto a vault or folder copy the files safely and open the first imported note.
- Add pointer-based note dragging in the organizer so notes can move between folders and vaults, with highlighted destinations and an Undo action.
- Simplify Insert to Link, Table, Callout, and Horizontal line. Link creation, editing, and removal now live under Insert → Link, and Markdown separators render as visible lines in the editor.

**Compatibility:** existing vaults, folders, notes, drafts, and organizer metadata remain compatible. No note-format migration is required.

**Verification:** focused frontend and native tests, TypeScript, lint, dark/light visual checks, organizer drag checks, production build, and packaged installation verification passed before delivery.

## 1.0.3 — 2026-09-26 — Responsive startup

- Render the shell before workspace initialization, load vaults and folders incrementally, and run scans and filesystem commands on native workers.
- Keep note reads and saves responsive during indexing. Cancel superseded searches and ignore results from previous workspace activations.
- Load editor, AI chat, diagrams, and math features on demand; retain AI conversations when the chat panel closes.
- Show delayed-operation status and recovery controls. Preserve draft recovery, revision checks, split panes, detached notes, and external rename handling with partial folder data.

**Compatibility:** no note-format changes or automatic reopening of the last note. Existing migration safeguards and local drafts remain supported; directory caches are provisional.

**Verification:** frontend tests, native tests (including paused-scan concurrency), lint, production build, and isolated packaged native smoke passed. Disposable 100–50,000-note Windows benchmarks measured shell readiness at 115–439 ms after WebView navigation and first editable note at 154–368 ms. See artifacts/STARTUP-VALIDATION.md for methodology and limits.

## 1.0.2 — 2026-09-14 — Titlebar drag surface

- Restored native window dragging from the unused portion of the tab bar. The visible empty tab-strip area is now a dedicated Windows drag region, while note tabs themselves remain independently clickable and reorderable.
- Updated the public repository identity to **Lotus Notes** (`lotus-notes` on GitHub) and removed the obsolete Ohana-inspired wording from its README description.

**Compatibility:** no vault, note, draft, browser-profile, organizer, or AI-connection migration is required. Existing Lotus workspaces remain compatible.

**Verification:** TypeScript production build, frontend lint, and 35 frontend tests passed before packaging.

## 1.0.1 — 2026-09-14 — Native browser and drop reliability

- Removed the white flicker while resizing a split that contains a browser. An established native WebView2 browser now resizes in place; it is hidden only during its initial placement.
- Made either split pane a reliable note-drop target even when that pane contains a browser. Dragging a sidebar note or a top note tab over a browser replaces that pane with the note while retaining the browser tab for later use.
- Restored external Markdown import reliability. Explorer `.md` and `.markdown` drops now locate sidebar folders from their geometry with high-DPI support and retain the intended target across a short native browser-WebView handoff.

**Compatibility:** no vault, note, draft, browser-profile, organizer, or AI-connection migration is required. Existing Lotus workspaces remain compatible.

**Verification:** TypeScript production build, frontend lint, 35 frontend tests, and isolated native browser/tab/split smoke coverage passed before packaging.

## 1.0.0 — 2026-09-14 — Stable MVP

- Established Lotus’s first stable public release: a local Markdown workspace with vaults, folders, notes, organized tabs, editable Markdown, split views, local drafts/recovery, import/export, and configurable AI connections.
- Finalized native browser tabs: browser sessions are contained within Lotus’s note workspace, can be reordered with normal tabs, remain in split view when selected, can be placed into either pane by dragging, and can be closed from their own toolbar.
- Hardened tab interaction on the undecorated Windows titlebar. Temporary tabs select from captured pointer release, tolerate small pointer movement, and retain deterministic before/after reordering without an accidental browser activation.
- Updated Settings → About attribution to **VISTU LABS**.

**Compatibility:** no vault, note, draft, browser-profile, organizer, or AI-connection migration is required. Existing Lotus workspaces remain compatible.

**Verification:** TypeScript production build, frontend lint, 35 frontend tests, 28 native Rust tests, and isolated native browser/tab/split smoke coverage passed before packaging.

## 0.14.13 — 2026-09-14 — Browser-and-note split workspace

- Fixed temporary tab selection on the Windows undecorated titlebar. Native drag handling could consume a real mouse-release before it became a DOM click, leaving the old note visible. A primary pointer-down now selects the tab before optional drag tracking begins, while keyboard tab activation remains supported.
- Added browser-aware splitting. When **Side by side** or **Top and bottom** is chosen with a browser tab active, Lotus moves that same native WebView2 session into the second pane and restores the underlying note as the editable first pane. Browser navigation and the page session remain intact while the split direction changes.
- Extended the isolated native browser smoke test to cover real tab clicks with minor pointer movement, deterministic tab reordering, browser-plus-note side-by-side, and browser-plus-note top-and-bottom layouts.

**Compatibility:** no vault, note, draft, browser-profile, organizer, or AI-connection migration is required.

**Verification:** TypeScript production build, frontend lint, 35 frontend tests, 28 native Rust tests, and the isolated native browser/tab/split smoke test passed.

## 0.14.12 — 2026-09-14 — Reliable browser overlays and tab switching

- Fixed the native browser child turning Lotus into a multi-WebView host while normal workspace commands still expected a single-webview window. Vault selection, note/view bookkeeping, drag targets, detached notes, and AI request/download controls now address their host window safely while a browser tab is open; the misleading **current webview is not a WebviewWindow** error no longer appears.
- Added a native-overlay handoff for Settings and anchored menus. When a Lotus modal or vault chooser opens, the browser child hides so the dialog is visible and clickable; it returns to its exact note-pane bounds when the overlay closes.
- Replaced tab click suppression during save/read with a latest-intent selection queue. A delayed read for an older tab can no longer overwrite the document selected by a newer tab click.
- Separated same-strip tab reordering from note drops and detached-window transfer. Tabs can be dropped before or after another non-pinned tab with a deterministic insertion index, including adjacent tabs.
- Extended browser/tab smoke coverage to verify Alpha/Beta selection and before/after tab reordering.

**Compatibility:** no vault, note, draft, browser-profile, organizer, or AI-connection migration is required.

**Verification:** TypeScript production build, frontend lint, 35 frontend tests, and 28 native Rust tests passed. The isolated native browser smoke test requires Lotus to be closed because Lotus enforces a single application instance.

## 0.14.11 — 2026-09-14 — Reliable embedded browser and Current note selection

- Corrected native WebView2 browser placement using the main webview's desktop client origin plus the browser host bounds. Browser pages now occupy only the note workspace, leaving the sidebar and tab strip interactive.
- Serialized browser-child creation and navigation so commands wait for a registered WebView2 child instead of intermittently failing with `webview not found`. Switching tabs no longer lets an older React host hide the currently active browser child.
- Made ordinary sidebar note selection complete on pointer release, which avoids WebView2 losing the nested button click after drag-and-drop pointer capture. A simple click now consistently replaces the permanent **Current note** slot.
- Kept the pinned tab visibly named **Current note** while its contents change. Closing it clears the active document without closing the slot.

**Compatibility:** no vault, draft, organizer, browser-profile, or AI-connection migration is required.

**Verification:** frontend lint, TypeScript build, 35 frontend tests, 28 native tests, browser-to-sidebar desktop smoke test, general desktop smoke test, and Windows NSIS package.

## 0.14.10 — 2026-09-14 — Faster startup and reliable workspace flow

- Deferred native recursive workspace watching until after the Lotus window is ready. Cached workspace data and the lightweight startup snapshot can therefore reach the screen before watcher setup touches a large vault; normal create, rename, delete, and open-note reconciliation resumes immediately afterward.
- Replaced the unconditional one-second filesystem write loop with a 700 ms idle save and a five-second continuous-edit safety flush. Recovery drafts remain recorded on each change, and all explicit transitions still wait for a successful save.
- Moved the CodeMirror editing surface behind a lazy feature boundary and split editor/Markdown libraries into dedicated production chunks. The app shell, cached workspace tree, Settings, and Organizer no longer need to parse the full editing stack before becoming usable.
- Made the AI settings panel fetch connected models and the model-library location first. Potentially slow local GGUF discovery and computer-specification detection now run only for Local and Hugging Face work, and independent requests execute in parallel.
- Updated the Organizer regression suite for its single expand/collapse button and Area headings. It also verifies that sidebar/search navigation always reuses Current note, while manually opened temporary tabs can be removed with Close additional tabs.
- Updated the built-in documentation to describe the anchored Current note, browser tabs, Area grouping, and idle autosave behavior. Added Windows CI for linting, frontend tests/build, and native Rust tests.

**Compatibility:** no vault layout, organizer metadata, draft, browser, or AI-connection migration is required. Existing local model connections and workspaces continue unchanged.

**Verification:** lint, TypeScript, frontend tests, Rust formatting/tests, production build, debug smoke test, and Windows NSIS package are required for this release.

## 0.14.9 — 2026-09-14 — Native in-app browser tabs

- Added an **Open browser** globe button directly beside Settings in the top menu. It opens a normal Lotus tab with a DuckDuckGo start page, address field, Back, Forward, and Reload controls.
- Implemented browser content as a native Tauri/WebView2 child webview instead of an iframe. This lets ordinary sites load even when they prohibit embedding, keeps browser navigation in its own webview profile, and avoids adding remote websites to Lotus’s vault UI.
- Browser tabs participate in the existing tab strip: they can be reordered, closed, and dragged onto either note-pane header. Dropping a browser on a split pane moves that browser session there; closing its tab closes the native browser webview as well.
- Restricted Lotus-initiated browser navigation to normal `http` and `https` addresses, and only accepts internal browser-tab labels for browser navigation, history, reload, and current-address commands.
- Enabled only the native webview lifecycle permissions required to create, show, hide, resize, move, and close the child browser view. No vault filesystem or AI-provider capability was added for web content.

**Verification:** frontend lint and production frontend build passed. Native Rust compilation still requires `cargo`, which is unavailable in this workspace environment.

## 0.14.8 — 2026-09-14 — Project attribution and licensing clarity

- Added VISTU LAB attribution in Settings → About, identifying Lotus as an educational project.
- Added an accurate plain-language MIT License summary in Settings → About: reuse, modification, distribution, sublicensing, and sale are permitted when the copyright and license notice are retained; the software is provided without warranty.
- Kept the existing MIT License unchanged. Creative Commons licensing was considered but not applied because Creative Commons does not recommend its licenses for computer software.

**Verification:** frontend lint and production frontend build passed.

## 0.14.7 — 2026-09-14 — Fast workspace startup

- Added a cached workspace-tree snapshot in the local webview profile. Lotus can now draw the previous vault structure immediately on a subsequent launch instead of waiting for a filesystem scan before the interface becomes usable. The cache contains only workspace paths, names, kinds, order, and Windows file identities—never note contents, AI conversations, or credentials.
- Added a dedicated lightweight startup snapshot. It traverses the workspace to obtain the current names and folder structure but deliberately skips per-item Windows file-identity handle opens, which were costly in large vaults.
- Deferred the complete identity-aware reconciliation until after the first paint. Rename detection and normal external-filesystem change handling continue to use the complete snapshot once it is available.
- Removed redundant path canonicalisation for every child discovered during a trusted workspace traversal. The root is validated before traversal and links are still rejected, preserving the workspace boundary while avoiding thousands of repeated filesystem calls.
- The normal workspace tree refresh remains available for changes, vault switching, and external rename reconciliation. If the optional cached snapshot is absent, invalid, oversized, or cannot be written, Lotus safely falls back to the lightweight live scan.

**Verification:** frontend lint, focused editor-action tests, and production frontend build passed. Native Rust tests could not be run because `cargo` is unavailable in this workspace environment.

## 0.14.6 — 2026-09-14 — Navigation, pane drops, local AI, and list editing

- Made unused top-tab-strip space a native Windows drag region while keeping controls and tabs interactive.
- Added a permanent first **Current note** tab: sidebar clicks replace this anchored view; manually opened tabs remain independent.
- Fixed the note context menu’s **Open in new tab** action so it ignores the anchored tab and opens/selects an independent one.
- Extended pointer note drops to the tab strip and either note header. A sidebar note replaces only its target pane; dropping a top tab on a pane leaves the source tab open.
- Increased local GGUF chat output from 384 to 1,536 tokens and local edit output to 2,048. Local chat now retains a useful partial reply with a continuation notice if a reasoning-heavy model still reaches its limit; incomplete edits remain rejected.
- Fixed bullet and numbered-list insertion so typing preserves the list marker. Added a left-aligned orange release-history link in Settings → About.

**Verification:** frontend lint, focused list-action tests, and production frontend builds passed. Native Rust tests require `cargo`, which was unavailable in this workspace environment.

## 0.14.5 — 2026-09-11 — Local model restart

- Saved the approved GGUF path alongside the server-reported local model ID and restarts saved local models automatically after an app restart.
- Migrates older local connections by finding the matching GGUF in approved folders, resolving the filename-versus-full-path model-ID mismatch.

## 0.14.4 — 2026-09-11 — Local runtime and drag reliability

- Repaired stale local model IDs, allowed more time for local requests, added pointer-driven tab reordering, made sidebar moves feel immediate, and introduced the release-history tab.

## 0.14.3 — 2026-09-11 — Reliable note dragging

- Replaced WebView2-dependent sidebar-note drops with pointer capture; added note ordering, note-to-folder movement, note-to-tab-strip drops, outside table-selection dismissal, and clearer startup feedback.

## 0.14.2 — 2026-09-11 — Standard drag transport

- Added compatibility for WebView2’s standard text drag payload.

## 0.14.1 — 2026-09-11 — Tabs and ordering

- Added note tabs, per-folder manual ordering, folder movement, and cross-window tab-transfer groundwork.

## 0.14.0 — 2026-09-10 — Local model management

- Added About and computer-information views, a local-model library, Hugging Face GGUF browsing/downloads, local runtime controls, and assistant/startup refinements.

## 0.13.1 — 2026-09-09 — Additional AI providers

- Added Google Gemini, NVIDIA, and named Custom HTTPS-compatible providers while retaining Groq and OpenRouter.
- Added editable model IDs, optional discovery, Test & save validation, custom-endpoint trust acknowledgement, strict URL validation, and connection-specific consent text. Credentials remain in Windows Credential Manager.

## 0.13.0 — 2026-09-09 — AI assistant

- Added the resizable assistant pane, chat, note/selection context, session-only history, safe edit previews, explicit transmission acknowledgement, and revision/lock/conflict checks before applying an edit.

## 0.12.0 — 2026-09-09 — Workspace transfer and interaction polish

- Added portable ZIP export/import with preview, checksums, selected destination, optional vault/Trash/settings contents, and non-overwriting imports. Refined navigation, search, inline naming, table selection, vault settings, and narrow layouts.

## 0.11.0 — 2026-09-09 — Navigation and Markdown refinement

- Added hanging nested/wrapped list presentation, dedicated search, refined bookmarks/Organizer actions, internal and web links, live formatting behavior, callout spacing, and external filesystem refresh/conflict recovery.

## 0.10.0 — 2026-09-09 — Split panes and editor polish

- Added note/header drops in both split orientations, inline folder/note creation, typed Properties, visual formatting toggles, callouts, table sizing, toolbar Undo, Mermaid editing, and the revised settings layout.

## 0.9.0 — 2026-09-09 — Symmetric note workspace

- Completed mirrored side-by-side/top-bottom split panes, editable filename titles, width preferences, bookmark placement, refined context-menu behavior, inline creation, vault-area controls, and Lotus icon assets.

## 0.8.0 — 2026-09-09 — Structured Markdown workspace

- Expanded Markdown tables, YAML Properties, submenus, colors, links, bookmarks, split views, Organizer, search, and vault conversion with collision-safe previews and internal Trash.

## 0.7.0 — 2026-09-09 — Lotus rebrand

- Rebranded Notus as Lotus across the application, installer, titles, and shortcuts while retaining compatible workspace/state locations. Added compact navigation, live Markdown previews, Properties, table interactions, split panes, and Organizer workflows.

## Notus 0.6.1–0.2.0 — 2026-09-08 to 2026-09-09 — Foundation

- **0.6.1:** table row/column selection, per-note alignment, first-column highlighting, refined search, dense sidebar rows, and Organizer scrolling.
- **0.6.0:** areas/icons, vault setup/import, close-only tabs, lock/save indicators, typography controls, and editable Markdown tables.
- **0.5.0:** vault Organizer, workspace areas, tab scrolling/reordering, typography preferences, cross-vault movement, and recoverable Trash.
- **0.4.0:** native tabs, detached windows, tab transfer/reattachment, autosave, locking, conflicts, and internal Trash.
- **0.3.0–0.2.0:** local-first Tauri/React Markdown workspace, vault/folder/note hierarchy, native title bar, create/rename/move, autosave/recovery, imports, themes, and Windows packaging.

**Compatibility:** Lotus uses ordinary UTF-8 Markdown, YAML frontmatter, and standard Markdown tables. Widths, alignment, bookmarks, areas, and UI state remain local preferences outside note files. Windows installers are unsigned; notes are not uploaded unless a configured AI provider is explicitly sent user-selected context.
