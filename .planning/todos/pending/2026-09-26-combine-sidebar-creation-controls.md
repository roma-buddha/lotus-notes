---
created: 2026-09-26T17:34:20.491Z
title: Combine sidebar creation controls
area: ui
files:
  - src/App.tsx:2752
  - src/styles.css:2395
---

## Problem

Tracking note: this request is now collected in the project's `To Do Version 1.0.5.md`, which is the authoritative list for this version. Add further requests and clarifications there. Await the user's instruction to implement that document.

The Files toolbar currently shows separate New note and New folder controls. The note plus appears to move depending on the available sidebar space and feels visually detached from the folder control. This makes the primary creation action harder to find and the two adjacent actions less clear.

## Solution

Replace the separate creation buttons with one stable plus button anchored beside the Files heading or folder area. Clicking it should open a compact menu with two choices: Create note and Create folder. Both choices should keep the current destination behavior, using the selected folder when appropriate and otherwise the active vault. Confirm the placement in narrow and normal sidebar widths so the control does not shift.
