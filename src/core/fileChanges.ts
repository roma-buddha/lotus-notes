import { flatten, type Entry } from "../notus";
/** Match only unambiguous filesystem identities. Never guess between copies. */
export function externalMoves(
  before: Entry[],
  after: Entry[],
): Map<string, string> {
  const old = flatten(before),
    next = flatten(after),
    paths = new Set(next.map((e) => e.path)),
    moves = new Map<string, string>();
  const identities = new Map<string, Entry[]>();
  for (const entry of next) {
    if (!entry.identity) continue;
    const key = entry.kind + ":" + entry.identity;
    identities.set(key, [...(identities.get(key) ?? []), entry]);
  }
  for (const entry of old) {
    if (paths.has(entry.path) || !entry.identity) continue;
    const matches = identities.get(entry.kind + ":" + entry.identity) ?? [];
    if (matches.length === 1) moves.set(entry.path, matches[0].path);
  }
  // A loaded folder's identity also identifies descendants not yet listed at
  // its new location. Prefer direct identity matches when a child moved separately.
  const folders = old
    .filter((entry) => entry.kind !== "note" && moves.has(entry.path))
    .sort((a, b) => b.path.length - a.path.length);
  for (const entry of old) {
    if (moves.has(entry.path) || paths.has(entry.path)) continue;
    const parent = folders.find((folder) =>
      entry.path.startsWith(folder.path + "/"),
    );
    if (parent)
      moves.set(
        entry.path,
        moves.get(parent.path)! + entry.path.slice(parent.path.length),
      );
  }
  return moves;
}
