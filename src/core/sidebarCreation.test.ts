import { describe, expect, it } from "vitest";
import { isPendingCreation, type InlineEdit } from "../sidebarTypes";
import type { Entry } from "../notus";

describe("creation handoff", () => {
  const entry: Entry = {
    path: "Work/Hello2.md",
    name: "Hello2.md",
    kind: "note",
    children: [],
  };
  it("suppresses a watcher row only while its creation reply is pending", () => {
    const edit: InlineEdit = {
      kind: "create",
      entryKind: "note",
      parent: "Work",
      pendingName: "Hello2",
    };
    expect(isPendingCreation(entry, edit)).toBe(true);
    expect(isPendingCreation(entry, null)).toBe(false);
    expect(isPendingCreation(entry, { ...edit, pendingName: undefined })).toBe(
      false,
    );
    expect(isPendingCreation({ ...entry, path: "Other/Hello2.md" }, edit)).toBe(
      false,
    );
  });
  it("handles explicit Markdown extensions and folders without hiding unrelated names", () => {
    expect(
      isPendingCreation(entry, {
        kind: "create",
        entryKind: "note",
        parent: "Work",
        pendingName: "HELLO2.MD",
      }),
    ).toBe(true);
    expect(
      isPendingCreation(entry, {
        kind: "create",
        entryKind: "folder",
        parent: "Work",
        pendingName: "Hello2",
      }),
    ).toBe(false);
  });
});
