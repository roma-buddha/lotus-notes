import type { Entry } from "./notus";
export type InlineEdit =
  | {
      kind: "create";
      parent: string;
      entryKind: Entry["kind"];
      pendingName?: string;
    }
  | { kind: "rename"; entry: Entry };
export type Anchor = {
  x: number;
  y: number;
  trigger: HTMLElement;
  beside?: HTMLElement;
};
// Watcher events may publish a newly created entry before its IPC reply arrives.
// Until that reply retires the input, display only the input for that path.
export function isPendingCreation(
  entry: Entry,
  inline: InlineEdit | null,
): boolean {
  if (inline?.kind !== "create" || !inline.pendingName) return false;
  const name =
    inline.entryKind === "note" && !/\.(md|markdown)$/i.test(inline.pendingName)
      ? `${inline.pendingName}.md`
      : inline.pendingName;
  const path = inline.parent ? `${inline.parent}/${name}` : name;
  return entry.path.toLowerCase() === path.toLowerCase();
}
export function anchorAt(trigger: HTMLElement): Anchor {
  const rect = trigger.getBoundingClientRect();
  return { x: rect.right + 4, y: rect.top, trigger };
}
export function anchorBelow(trigger: HTMLElement): Anchor {
  const rect = trigger.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom + 6, trigger };
}
