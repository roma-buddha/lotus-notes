import type { Entry } from "./notus";
export type DirectoryState = "unloaded" | "loading" | "loaded" | "failed";
/** Replace one listing without discarding already loaded descendants. */
export function mergeDirectory(
  tree: Entry[],
  path: string,
  children: Entry[],
): Entry[] {
  const merge = (previous: Entry[], next: Entry[]) => {
    const old = new Map(previous.map((entry) => [entry.path, entry]));
    return next.map((entry) => {
      const existing = old.get(entry.path);
      entry = { ...entry, identity: entry.identity ?? existing?.identity };
      return existing && entry.kind !== "note"
        ? {
            ...entry,
            children: existing.children,
            childrenLoaded: existing.childrenLoaded,
          }
        : entry;
    });
  };
  if (!path) return merge(tree, children);
  return tree.map((entry) =>
    entry.path === path
      ? {
          ...entry,
          children: merge(entry.children, children),
          childrenLoaded: true,
        }
      : path.startsWith(`${entry.path}/`)
        ? { ...entry, children: mergeDirectory(entry.children, path, children) }
        : entry,
  );
}
export function validCachedEntries(value: unknown): value is Entry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        entry &&
        typeof entry.name === "string" &&
        typeof entry.path === "string" &&
        ["vault", "folder", "note"].includes(entry.kind) &&
        Array.isArray(entry.children) &&
        entry.children.length === 0,
    )
  );
}
