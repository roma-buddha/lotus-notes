# To Do Version 1.0.6

Status: implemented and verified for release 1.0.6, with the manual acceptance limit noted below.

This document collects additional requested changes following Lotus 1.0.5. Append new requests here and update existing items when clarified. Do not implement until the user explicitly asks. Outstanding verification for 1.0.5 remains recorded in To Do Version 1.0.5.md.

## 1. Remove the “Workspace is not ready.” announcement

- [x] Remove the unwanted “Workspace is not ready.” banner shown at the top of the app during startup by waiting for readiness before initial view registration.
- [x] Check that normal startup and opening a note no longer display this announcement in the packaged app with a disposable vault.

Context: the user supplied a screenshot of the wide, dismissible banner beneath the Current note tab and asked to remove it.

## 2. Make new-note creation visually seamless

- [x] Remove the unwanted vertical mark: it was a left-edge focus shadow combined with programmatic focus on the new sidebar row. Creation no longer applies that focus; keyboard focus uses an inset outline.
- [x] Prevent a new note's name from briefly appearing twice during creation. Retire the creation input before refresh/open and suppress a matching watcher row while its creation reply is pending.
- [x] Transition from the creation field to a single normal note row without a duplicate-name flash or leftover visual marker.
- [x] Verify intermediate creation states with an injected early watcher row and delayed completion in a component preview, plus focused tests. Confirm normal note creation and its saved file in the packaged app.

Context: the user wants new notes to appear seamlessly.

## 3. Clarify storage locations and allow an independent vaults folder

User request: distinguish Lotus's own files (settings, internal state, Trash, history-related data) from the folder containing vaults. Let the user choose where vaults live, either within the Lotus storage location or separately. Investigate why Change workspace currently does not work for the user.

Current code review findings:

- Settings displays the note root, such as `C:\Users\valer\Documents\Notus\Vaults`, but Change workspace passes the chosen folder to `Workspace::open`, which expects the parent storage home, such as `C:\Users\valer\Documents\Notus`.
- The current layout couples `<home>/Vaults`, `<home>/.lotus-state`, and `<home>/.lotus-trash`. It does not support independently choosing the vaults root.
- The chooser accepts an empty storage home or a recognized Lotus/legacy workspace. It deliberately rejects ordinary nonempty folders and unrecognized Vaults directories to avoid reorganizing unrelated files. Selecting the displayed Vaults folder itself can therefore fail.
- Switching can also be blocked by detached windows or a failed save of open notes. The user's exact failure has not been reproduced; the path mismatch is a confirmed design issue, not a confirmed diagnosis of their specific attempt.
- The selected home is saved in the app-data directory's `workspace.json`. Some preferences and drafts use WebView local storage; directory caches use IndexedDB. The release-history document is bundled with the application. App-owned data is therefore not all in the displayed folder today.
- Startup retains the legacy Documents/Notus location when it exists, explaining why the old name can still appear in Lotus.

Implementation authorized and completed:

- [x] Show clearly labeled Lotus app-data and Vaults folder locations in Settings, with explanations of what each contains and Open in Explorer actions.
- [x] Support choosing the vaults folder independently of app data; allow a Vaults subfolder within the same Lotus parent or a separate location. Keep internal files out of the vault list.
- [x] Define storage ownership and inventory browser-stored data: configuration remains in Windows app data; new workspace state and Trash are keyed by canonical vaults path beneath it. Existing legacy state/Trash and WebView preferences, draft recovery, and IndexedDB caches stay in place. Settings exposes these locations. Release history remains bundled with Lotus.
- [x] Make the folder picker select the same kind of location that Settings displays. Correct the confirmed storage-home versus vaults-root mismatch, accept either recognized legacy location, and explain blocked saves or detached windows.
- [x] Clearly distinguish opening an existing vaults location from moving current vaults. Do not silently move, flatten, reorganize, or overwrite an existing folder when changing the setting.
- [x] Preserve existing vaults, Trash, metadata, drafts, and settings. No bulk migration is needed; legacy configurations remain supported and new selections are saved atomically. Workspace-specific state stays associated with its vaults location.
- [ ] Test same-parent and separate locations, existing and empty vaults folders, unavailable paths, restart persistence, and switching with open/unsaved notes using disposable workspaces.

Implementation notes: both note panes are cleared only after their drafts save and a new location is selected. Selecting another folder leaves current vaults where they are; moving vaults is not part of this action. The browser profile remains separate from configuration under the normal Windows Local/Roaming app-data locations, and Settings makes this distinction explicit.

Verification: two creation regression tests and nine focused native tests (storage configuration, legacy layout, and startup) pass. The creation handoff was inspected with an early watcher row and delayed completion. Storage settings were inspected in light and dark themes. Lint, the final production/NSIS build, and the startup bundle check pass. The packaged executable opened without the readiness banner, created one normal sidebar row without the vertical mark, opened its note, and saved the file in a disposable vault. Native folder-dialog switching with unsaved/split notes remains a manual acceptance check; no live vault was used for testing.

## Additional requests

Add subsequent requests as numbered sections above this heading.
