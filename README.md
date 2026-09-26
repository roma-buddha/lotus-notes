# Lotus

A Windows Markdown app with a quiet, focused interface. Opens directly into your notes. No Lotus account, server, local AI runtime, database, or starter content. Optional AI connects directly to your chosen provider using your own API key.

## Install Lotus

Lotus is a Windows-first, local-first Markdown knowledge workspace. Your notes stay as ordinary UTF-8 Markdown files in a folder you choose. It includes vault and folder organization, editable notes, tabs and split views, a contained browser tab, portable import/export, and optional bring-your-own-key AI providers.

### Windows installer (recommended)

1. Download `Lotus_1.0.2_x64-setup.exe` from the [Lotus 1.0.2 release](https://github.com/roma-buddha/lotus-notes/releases/tag/v1.0.2).
2. Run the installer and follow the Windows prompts.
3. Launch **Lotus** from the Start menu. On first launch, choose the parent folder where Lotus should keep its workspace.

Windows WebView2 is required. It is preinstalled on current Windows 10 and 11 systems; install the [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) if Lotus reports that it is missing.

### Terminal installation / build from source

Use this when you want to build Lotus yourself. Install Node.js, Rust with the MSVC toolchain, Visual Studio C++ Build Tools, and Windows WebView2 first.

```powershell
git clone https://github.com/roma-buddha/lotus-notes.git lotus
cd lotus
npm ci
npm run package:win
Start-Process .\src-tauri\target\release\bundle\nsis\Lotus_1.0.6_x64-setup.exe
```

For development rather than installation, run `npm run dev` after `npm ci`.

## AI assistant (0.13)

### Additional providers (0.13.1)

Google Gemini and NVIDIA now have built-in API endpoints alongside Groq and OpenRouter. **Custom** adds one named HTTPS OpenAI-compatible provider connection with an API base URL. This does not support arbitrary non-compatible APIs. Custom endpoints require explicit trust confirmation; changing the endpoint requires entering the key again rather than forwarding a previously saved key to a new destination.

Model discovery is optional: load suggestions or type/paste the exact model ID from the provider's API example. Test & save validates a real completion without requiring the model-list endpoint. Use NVIDIA's full **Key Value** (the `nvapi-…` secret), not its Key ID/name; for Google use the actual Gemini API key, not the Google project ID. Never paste keys into notes or chat messages. All new connections retain protected credential storage and are excluded from exports. Billing/quota follows each provider account; the OpenRouter preset still restricts models to free variants.

Open the sparkle below the note header for a resizable right-hand chat pane. In **Settings → AI models**, choose a provider, enter a key, load available models or paste a model ID, and **Test & save**. The test sends only a short synthetic prompt. The OpenRouter preset is restricted to `:free` models; other provider usage follows your account plan. Quotas are not unlimited and there is no automatic provider or paid fallback.

Keys and chosen models are kept in Windows Credential Manager, not Markdown, localStorage, or Lotus export archives. Keys must be entered again on another computer. Requests run in Rust over HTTPS to built-in provider endpoints or an explicitly trusted custom endpoint; no AI network access is exposed to the WebView.

Choose **No note**, **Current note**, or **Selected text** as context. Sending requires explicit acknowledgment that the conversation and chosen context are sent to the provider. Chat history is included in subsequent messages; New chat clears it. Chats are session-only and disappear when this note workspace view is unmounted or the app closes. No vault scanning, attachments, web browsing, or filesystem tools are available to the model.

**Suggest edit** returns a replacement preview with Apply/Discard. Apply changes only the captured note body/selection, preserves frontmatter, uses the normal undoable editor and native save path, and refuses locked, changed, or closed notes. Incomplete or malformed model output is rejected. Very long requests are refused instead of silently truncating note content. Stop cancels the in-flight HTTP request and ignores late results; a provider may already have counted the request against its quota.

## Stack

Tauri 2 / Rust for native windows and validated filesystem operations; React 19 / TypeScript / Vite for the interface; CodeMirror 6 for editing and React Markdown / GFM for locked reading. Ordinary UTF-8 Markdown files remain the source of truth. Windows WebView2 is required.

## Workspace

New installations show workspace setup after the shell opens. Existing workspaces load vaults first and discover folder contents as needed, with background indexing and retry controls for delayed operations. **Settings → Workspace → Open another vaults folder** selects the folder containing vault directories, without moving or reorganizing its files. The vaults folder can be a subfolder of your Lotus folder or a separate location. Existing Lotus storage homes and their Vaults subfolders are both recognized. Close detached windows and save or recover open drafts before switching.

New vaults locations keep separate metadata and Trash beneath the Windows app-data directory, keyed by their canonical path. Settings shows the actual locations of configuration, local browser preferences/draft recovery/cache, workspace state, and Trash, with Explorer actions. Configuration supports both legacy storage-home paths and separate vault/data paths and is replaced atomically. Existing legacy storage stays in place, as shown below; no bulk data migration is required. Browser settings and draft recovery records remain in the existing WebView profile. Release history is bundled with the application.

```text
Lotus/                        # your chosen storage folder
  Vaults/
    Example vault/            # vault
      Example folder/         # folder
        Example note.md       # note
    Reference/
      Reading/
        Notes.md
  .lotus-trash/               # internal recoverable deletion
  .lotus-state/               # locks, area metadata and migration records
```

Notes live directly in a **Vault**, or in a folder inside that vault. The wider bottom-left vault picker has a settings icon for each vault and a plus beside Find a vault for **Create vault** / **Add existing vault…**. The plus beside Files offers **Create note** and **Create folder**. Create folder acts on the current vault; Create note and Ctrl+N use the selected folder or vault. The searchable vault dropdown shows one vault’s folders and notes at a time without changing open tabs. Vault menus create folders or notes; folder menus create notes. Folders cannot contain subfolders. Drop `.md` or `.markdown` files from Explorer or the desktop onto a vault selector or the sidebar’s empty space to copy them into that vault; dropping onto a folder copies them there. The first imported note opens automatically, and duplicate filenames receive a numeric suffix. Duplicate names are never overwritten. Move/rename does not rewrite links inside Markdown files.

Folder/note creation inserts an Untitled folder/Untitled row directly into the tree with its name selected. Creation and rename happen inline: **Enter** confirms, **Escape** cancels. The complete temporary row has a rounded accent outline and the same indentation and folder arrow as its neighboring rows. Vault settings opens beside the vault picker; its gear is at the right of each vault row and a pencil beside the name starts inline rename. Settings retains reveal and **Remove from sidebar**, which leaves files unchanged; restore hidden registrations through **Hidden vaults**.

### Existing content

On opening a pre-0.4 workspace, nested folders move directly under their vault with combined names such as `Folder - Subfolder`. Name collisions receive a numeric suffix. Root-level notes move into a uniquely named `Recovered notes` folder. Operations rename files/folders without changing their bytes; durable old/new path records live in `.notus-state/migration-*.json`. Migration is idempotent.

**Vault switcher → Add existing vault…** copies an outside vault, leaving its source unchanged. Imported root notes use `Imported root notes`; nested folders are flattened. Hidden metadata is skipped and linked folders are rejected. New vaults are empty. Old Lattice workspaces are not imported automatically.

## Trash

Delete moves notes, folders or whole vaults into the workspace's **.lotus-trash**, not Windows Recycle Bin. Open **Settings → Trash** to see original location and deletion date, restore, permanently delete one item, or Empty Trash.

Permanent deletion requires confirmation. Restore never overwrites an existing path; restore/recreate the original parent first if needed. Tiny metadata records may remain after restoration but are not listed as deleted items. Trash shares the same disk as the workspace: it is recoverable deletion, not an independent backup.

## Editing and recovery

Changes save after a short pause in typing, with a five-second safety flush during continuous edits. Recovery drafts are recorded on every change, and saves also flush before navigation, locking, detaching or closing. There is no Save button; a small status icon beside the note lock shows pending, error, or confirmed saved (green).

**Unlocked** allows editing. **Locked** shows a read-only Markdown view; the backend also rejects writes to locked notes. Lock state persists across restarts and is shared between windows. This is an application editing lock, not filesystem encryption or an OS permission.

Writes use content revisions and atomic replacement. Per-window drafts are kept in local recovery storage. Clean views pick up disk/other-window changes within approximately one second. A competing write never silently overwrites the file: **Save recovery copy** preserves the local draft as a separate Markdown note. Moving or deleting an item open in another window is refused until that view closes.

Frontmatter is edited in a compact **Properties** section below the note title and above the body, collapsed initially. There is no separate popup or Properties toolbar icon. Dates, numbers, booleans, nested values and list/tag types survive saving. Add property lets you choose a type. Scalar property changes commit on blur/Enter and then autosave. Raw YAML is not shown in the normal interface; invalid YAML is preserved with a repair message.

**Text appearance**, beside the lock button, changes font family, size and overall weight across all notes and windows. Per-note **Text width** offers Comfortable (850px) and Wide (+35%, 1147.5px), constrained to the pane. These display-only preferences are saved separately from Markdown. Semantic headings and bold text remain Markdown content.

## Tables

Right-click a line in an unlocked note and choose **Insert → Table…**, then choose rows and columns. The table appears below that line. Type directly in cells. Drag along the mouse-sensitive top/left edges to select multiple columns/rows, or drag across cells to select a rectangular range. Right-click (or press Shift+F10) for Rows, Columns and Column alignment submenus. Drag a column border to resize it, or the table’s outer right edge to resize the whole table proportionally. **Fit to note width** resets explicit widths. Cells wrap instead of clipping; only the header is bold by default. **Highlight first column** uses a lighter fill without bold body text. Changes autosave as ordinary Markdown pipe tables, with a header and separator row. A horizontal scrollbar appears only when the table actually overflows. Table text is half a point smaller than note text, with compact padding. Active cells use one outline and render inline Markdown while editing. Locked notes render tables read-only. Simple tables only: no merged cells or nested tables. Cell contents may include inline Markdown; typography stays display-only.

**Text appearance → This note’s alignment** offers Left, Center, Right and Justified in editing and locked views. Code blocks and tables retain their layout. Alignment and table emphasis are stored locally per workspace/note, shared between Lotus windows, and follow in-app moves. They do not travel with a Markdown file to other apps. Table emphasis is associated with its position among the note's tables.

The sidebar shows Files and New folder at the top, and the full wrapping vault name at the bottom. General Settings is an icon in the top app toolbar. Folder rows are compact. A separate sidebar navigation row contains Files, Search, Bookmarks and Organizer. Search replaces the file tree with a dedicated content-search view; Ctrl+P opens it. Switching sections preserves folder expansion. The top app bar retains collapse, theme, split and Settings. Notes and Organizer use matching thin gray scrollbars at the far-right workspace edge.

## Workspace organizer and areas

Use the **Organize workspace icon** in the sidebar navigation row for a closable main-area tab containing every vault, folder and note. The tree starts collapsed, with one state-aware Expand all/Collapse all control. Vaults are visually grouped under their Areas; **Uncategorized** appears last when it contains vaults. Drag a note into a folder, including one in another vault. Moves never overwrite a destination. **Undo last move** is available while this organizer view stays open; it also refuses collisions.

Create, rename and choose icons for life **Areas**, then choose an area while creating or adding each vault. Unassigned vaults appear in **Uncategorized**. Areas are labels in `.lotus-state/organizer.json`, not another directory level. Removing an area only removes its label and puts its vaults back in Uncategorized. Vault settings show the current area's icon/name and allow reassignment, including Uncategorized, without moving files. Area edits use revisions to prevent overwriting changes from another window.

Vault action menus contain Create folder, Create note, Convert to folder and Vault settings, in that order. Rename and Trash are inside Vault settings. Organizer has a Create vault button and its search field above the Area groups on the left. Folder menus retain their creation, rename and Trash actions. Conversion requires a destination and a preview of every new path; source folder names become filename prefixes to retain Vault → Folder → Note. Filename collisions and stale previews are rejected. Copies are verified, and the original vault is retained in internal Trash. Empty folders are not reproduced as nested folders. Notes, bookmark paths, locks and appearance preferences follow the conversion; links inside Markdown are not rewritten.

## Menus, links and bookmarks

The note context menu groups Format, Paragraph and Insert in side submenus and preserves the selected text. Click outside the menu to dismiss it and position the caret; Escape closes the entire menu, including submenus. Lock and Search selection are absent. Bookmarking is only in the note toolbar, beside the lock. **Text color** is a top-level submenu with seven theme-aware colors plus Default color. Colors are saved as inline HTML spans in Markdown, so external applications may render them differently. Highlight/comment syntax and wiki links have display support; math commands save dollar-delimited Markdown math and render it with KaTeX in locked view. Clipboard menu actions use the native Windows clipboard. Block-only insertions are disabled in table cells, which cannot contain nested Markdown blocks.

Formatting marks for bold, italic, strike, inline code and links remain hidden while editing, including in headings and table cells. Formatting commands toggle the selected range rather than adding repeated markers. The note-toolbar **Undo** button and Ctrl+Z use temporary editing history; history is not a permanent backup and does not undo filesystem actions.

Select text in a note or table cell and use Add or edit link. Enter a website URL or choose a note. Note results scroll within their own area above the compact bottom-right Save link button. Rendered links show their label; Ctrl+click follows a link while editing and a normal click follows it when locked. External links use the system default browser, including bare domains normalized to HTTPS. Internal links open or reuse a top tab without switching the sidebar vault; returning to the original tab restores its reading position. Formatting, colors, highlights and link changes preserve the visible passage and only affect the selected occurrence. The Bookmarks toolbar button toggles the sidebar between the normal file tree and saved notes. Bookmarks persist locally and follow in-app moves. Search can match note contents as well as paths.

## Callouts and diagrams

Obsidian-style `> [!note] Title` callouts render as tinted blocks with a title/icon and regular-weight body text in editing and locked views. Their source remains plain Markdown. Bottom padding balances the callout body. Lists use hanging indents with left-aligned wrapped text in both views. Highlights use a distinct yellow fill.

Fenced `mermaid` blocks render locally as diagrams in both views. Controls provide zoom out/in, Fit, and (when unlocked) Edit diagram. Drag to pan when zoomed and resize the viewport from its bottom-right corner. Fit keeps the complete diagram visible. Invalid syntax displays an error without discarding the source. Rendering is restricted and sanitized; scripts, HTML labels and remote image content are not enabled. Diagram size/zoom and table widths are display preferences, not changes to the `.md` body. Diagram preferences are associated with the diagram’s order in the note.

## Tabs and windows

Click a sidebar or search-result note to replace the anchored first **Current note** tab. It remains available for the next note and cannot be closed independently. Use a note’s **Open in new tab** menu action or drag a note to the tab bar for an independent tab. Right-click a tab for **Close additional tabs**, which keeps the note currently being read in Current note and removes temporary note, browser, Organizer, and release-history tabs. Press **Ctrl+Shift+W** to close all tabs; **Ctrl+W** closes the active temporary tab. Tabs can be reordered by dragging; arrow keys navigate the focused tab strip. All unused top-bar space is a native window-drag region.

The globe beside Settings opens a built-in browser as an ordinary Lotus tab. It has an address field and Back, Forward, and Reload controls. Browser tabs can be reordered, closed, or dropped onto either split-pane header just like note tabs. Web content runs in an isolated native WebView2 child view and can only navigate to normal HTTP(S) addresses.

Use the top **Split view** icon or a tab’s right-click menu for side-by-side or top-and-bottom panes. Focus a pane, then click a sidebar note to open it there, or drag a sidebar note or an open top tab onto either pane’s header to replace only that pane. Resize the divider by dragging (or its arrow keys), and close either pane with its X. Both directions start at 50/50 and contain matching independent headers, editable titles, Properties, bookmarks, appearance controls and content. Both panes autosave before closing; two views of the same note share edits.

Drag a tab outside the app to open it in a separate native window, positioned at the pointer. Move that window to another monitor normally. Drag it onto another Lotus tab bar to reattach. **Ctrl+Shift+Enter** detaches the current note, or returns it to the main window from a detached window. Transfers save, open the destination and acknowledge receipt before closing the source view. Closing a tab/window never deletes a note.

The Lotus name/icon, collapse control and quick appearance switch are at top left. The top-toolbar **Settings** icon opens a minimal dialog with Appearance, Workspace and Trash navigation on the left and the selected content on the right. Light/dark appearance, sidebar visibility, sidebar width and the last main-window note are remembered.

| Shortcut | Action                                        |
| -------- | --------------------------------------------- |
| Ctrl+N   | Create note in the selected folder            |
| Ctrl+S   | Flush both panes immediately                  |
| Ctrl+B   | Bold in editor; toggle sidebar outside editor |
| Ctrl+P   | Focus search                                  |

## Development

Requires Node.js, Rust MSVC, Visual Studio C++ build tools, and Windows WebView2.

```sh
npm ci
npm run dev
npm run lint
npm test
npm run test:native
npm run package:win
npm run smoke
```

The NSIS installer is built in `src-tauri/target/release/bundle/nsis/`. Builds are unsigned.

The regression suite (`scripts/smoke-lotus-0120.mjs`) uses a temporary workspace, WebView profile and loopback debug port. It verifies real mouse selection, hidden formatting/toggles, toolbar and table undo, inline Properties/YAML, table and column resizing, overflow behavior, Mermaid rendering/editing/labels, anchored Current note navigation, closing temporary tabs, grouped Organizer Areas, actual sidebar/tab drops into both split orientations, inline creation, link-dialog layout, adjacent vault settings/rename, left-navigation Settings and narrow-window layouts. Set `NOTUS_EXECUTABLE` to test an installed build. `NOTUS_ROOT` bypasses single-instance handling for isolated tests; normal shortcuts set neither test environment variables nor debug ports.

Physical cross-monitor tab tear-off requires a manual desktop check: the available desktop automation restricts drag endpoints to the source window. Detached native windows and the menu-based round trip are covered automatically.

Filesystem commands reject traversal, internal metadata paths, reserved names, linked paths and overwrite collisions. No broad filesystem plugin is exposed. Obsidian plugins, graphs, attachment management and Windows Snap Layout hover are not included.

The source checkout and compatibility data may retain their historical names; the product and installed app are **Lotus**.

The previous suite (`scripts/smoke-lotus-0110.mjs`) verifies dedicated sidebar navigation/search, organizer actions, hanging lists, callout padding, table caret, selection isolation, formatting/link scroll stability, cross-vault tabs, browser dispatch, external file edits/moves and conflict recovery. External same-filesystem renames are followed using Windows file identities; unsupported/ambiguous moves are not guessed. Deleted open content and conflicting local drafts are retained rather than silently discarded. Inbound Markdown links are not rewritten automatically.

## Portable export / import (0.12)

Settings → Export / Import creates a standard ZIP with a versioned manifest, selected Lotus display/navigation preferences, organizer metadata and lock state. Include vaults is on by default and includes notes, attachments and empty folders; Include Trash is optional and off by default. Settings-only exports omit vault content. Lotus's application cache and recovery drafts are not exported. Vault files are copied as supplied, so review any sensitive documents before sharing an archive.

Import previews the archive, verifies paths and checksums, and restores into a separate **Lotus Imported <timestamp>** folder beneath your chosen destination. It never merges with or overwrites existing workspace files. Restore settings is optional. Settings/bookmark references are remapped to the restored location, and the app opens that workspace. Install Lotus separately on another computer before importing. This is manual transfer, not synchronization, automatic backup or version history.

Supported archive limits: 2 GB per file, 10 GB total, 100,000 files; symlinks are rejected. Archives are not encrypted. External absolute file links outside the vault are not relocated or rewritten.

The 0.12 interaction suite (`scripts/smoke-lotus-0120.mjs`, `npm run smoke`) adds sidebar ordering/icon sizing, search navigation without vault switching, isolated rectangular cell selection, subpixel-tolerance link positioning, compact vault settings/adjacent-or-stacked panels, and export/import controls. Tables are now 1.5 points larger than 0.11 (0.5 points below body text). Fixed title separation, minimal name editing and subtle non-stacking backdrops complete this batch.
