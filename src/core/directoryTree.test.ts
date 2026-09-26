import { describe, expect, it } from "vitest";
import { mergeDirectory, validCachedEntries } from "../directoryTree";
import { externalMoves } from "./fileChanges";
import type { Entry } from "../notus";
const entry = (
  path: string,
  kind: Entry["kind"],
  children: Entry[] = [],
): Entry => ({ path, name: path.split("/").at(-1)!, kind, children });
describe("partial directory trees", () => {
  it("keeps loaded descendants and identities when a parent refreshes", () => {
    const note = { ...entry("V/F/N.md", "note"), identity: "42" };
    const folder = { ...entry("V/F", "folder", [note]), childrenLoaded: true };
    const tree = [entry("V", "vault", [folder])];
    const next = mergeDirectory(tree, "V", [entry("V/F", "folder")]);
    expect(next[0].children[0].children).toBe(folder.children);
    expect(next[0].children[0].childrenLoaded).toBe(true);
    expect(
      mergeDirectory(next, "V/F", [entry(note.path, "note")])[0].children[0]
        .children[0].identity,
    ).toBe("42");
  });
  it("distinguishes an empty completed folder from an unloaded folder", () => {
    const tree = [entry("V", "vault", [entry("V/F", "folder")])];
    expect(tree[0].children[0].childrenLoaded).toBeUndefined();
    expect(mergeDirectory(tree, "V/F", [])[0].children[0].childrenLoaded).toBe(
      true,
    );
  });
  it("follows descendants when a renamed folder has not loaded its children yet", () => {
    const old = {
      ...entry("V/F", "folder", [entry("V/F/N.md", "note")]),
      identity: "folder-id",
    };
    const next = { ...entry("V/Renamed", "folder"), identity: "folder-id" };
    expect(externalMoves([old], [next]).get("V/F/N.md")).toBe("V/Renamed/N.md");
  });
  it("rejects corrupt and recursive directory cache records", () => {
    expect(validCachedEntries([entry("V", "vault")])).toBe(true);
    expect(validCachedEntries([{}])).toBe(false);
    expect(
      validCachedEntries([entry("V", "vault", [entry("V/F", "folder")])]),
    ).toBe(false);
  });
});
