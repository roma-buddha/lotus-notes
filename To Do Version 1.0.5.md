# To Do Version 1.0.5

Status: implemented for 1.0.5; real desktop/Explorer drag acceptance remains open.

This document collects the user's requested changes for Lotus 1.0.5, following installed version 1.0.4. Append additional requests here as they arrive. Update an existing item when the user clarifies it rather than duplicating it. Do not implement these items until the user explicitly asks to implement this document. During implementation, mark items complete only after their changes and relevant checks are finished.

## 1. One stable sidebar creation button

- [x] Replace the separate New note and New folder controls in the Files toolbar with one plus button in a stable position beside Files.
- [x] Clicking the plus opens a menu offering Create note and Create folder.
- [x] Create note uses the selected folder when appropriate, otherwise the active vault. Create folder uses the active vault.
- [x] Check narrow and normal sidebar widths so the button does not shift unexpectedly.

Context: the current plus appears to move and feels detached from the folder button. The user's preferred solution is a single plus menu with both creation actions.

## 2. Fix external Markdown drag-and-drop into the sidebar

User report after installing Lotus 1.0.4: dragging `.md` files from the Windows desktop or a Windows Explorer folder into the notes sidebar still does not work.

Implementation: subscribe to the current WebView's native drag events instead of the Window event target. Tauri routes WebView file drops to WebView/WebViewWindow listeners; a Window listener can miss them when native child browser views are present. Existing destination selection, safe copying, filename collision handling, sidebar refresh, and opening the first imported note are retained. Frontend tests pass, but this is not yet confirmation of real Windows dragging.

- [ ] Reproduce and diagnose the failure in the installed Windows app using real desktop and Explorer file drags.
- [x] Implement dropping Markdown files into the active vault through its notes sidebar, including a vault with no subfolders. A drop onto a folder imports into that folder.
- [x] Implement copying files without modifying originals or overwriting existing notes, updating the sidebar, and opening the first imported note automatically.
- [ ] Verify the complete interaction from both the desktop and Explorer in the packaged Windows app using disposable files and a test vault. Browser previews or simulated events alone are insufficient to confirm this fix.

Verification limit: a disposable vault and source files were prepared, but the Windows automation tool rejected a drag whose destination was outside the source window. Both real drag acceptance checks remain open. The creation menu was checked at 180px and 360px widths, including both menu actions; 53 frontend tests and lint passed.

## Additional requests

Add subsequent requests as numbered sections above this heading.
