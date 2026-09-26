import { invoke } from "@tauri-apps/api/core";
import type { Entry, Snapshot } from "./notus";
import { mergeDirectory, type DirectoryState } from "./directoryTree";
import { cachedDirectory, cacheDirectory } from "./directoryCache";

type Bootstrap = {
  root: string;
  generation: number;
  legacy_root?: string | null;
};
type Listing = {
  generation: number;
  path: string;
  revision: string;
  entries: Entry[];
};
export type DirectoryStatus = {
  state: DirectoryState;
  started?: number;
  error?: string;
};
let generation: number | undefined;
let attempt = 0;
let request = 0;
let changeVersion = 0;
let snapshot: Snapshot = { root: "", entries: [], complete: false };
const statuses = new Map<string, DirectoryStatus>();
const revisions = new Map<string, string>();
const latest = new Map<string, string>();
const flights = new Map<string, { id: string; promise: Promise<void> }>();
const listeners = new Set<(value: Snapshot) => void>();
let publishTimer: ReturnType<typeof setTimeout> | undefined;
let initialization: Promise<Snapshot> | undefined;
let fullScan: Promise<Snapshot> | undefined;
let fullScanId = "";
let indexing = false;
let indexingEpoch = 0;
const queue = new Set<string>();
const windowId = Math.random().toString(36).slice(2);

export const hasPendingDirectories = () =>
  [...statuses.values()].some((value) => value.state === "loading");
export const workspaceGeneration = () => generation;
export const directoryStatus = (path: string): DirectoryStatus =>
  statuses.get(path) ?? { state: "unloaded" };
export function subscribeWorkspace(listener: (value: Snapshot) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function publish() {
  if (publishTimer) return;
  publishTimer = setTimeout(() => {
    publishTimer = undefined;
    for (const listener of listeners) listener(snapshot);
  }, 40);
}
function apply(path: string, entries: Entry[]) {
  snapshot = {
    ...snapshot,
    entries: mergeDirectory(snapshot.entries, path, entries),
  };
  publish();
}
export function resetWorkspace() {
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = undefined;
  attempt++;
  indexingEpoch++;
  for (const { id } of flights.values())
    void invoke("cancel_workspace_request", { requestId: id }).catch(() => {});
  flights.clear();
  latest.clear();
  statuses.clear();
  revisions.clear();
  queue.clear();
  generation = undefined;
  initialization = undefined;
  if (fullScanId)
    void invoke("cancel_workspace_request", { requestId: fullScanId }).catch(
      () => {},
    );
  fullScanId = "";
  fullScan = undefined;
  indexing = false;
  snapshot = { root: "", entries: [], complete: false };
  publish();
}
export function initializeWorkspace(loadTree = true): Promise<Snapshot> {
  const ownAttempt = attempt;
  return (initialization ??= (async () => {
    performance.mark("lotus-bootstrap-start");
    const result = await invoke<Bootstrap>("workspace_bootstrap");
    if (ownAttempt !== attempt) throw new Error("Workspace changed.");
    generation = result.generation;
    snapshot = { ...result, entries: [], complete: false };
    performance.mark("lotus-workspace-ready");
    publish();
    // Cache lookup and vault enumeration are independent of shell readiness.
    if (loadTree)
      void loadDirectory("")
        .then(() => {
          queue.add("");
          return startIndexing();
        })
        .catch(() => {});
    return snapshot;
  })().catch((error) => {
    if (ownAttempt === attempt) initialization = undefined;
    throw error;
  }));
}
export function loadDirectory(
  path: string,
  identities = false,
  retry = false,
): Promise<void> {
  if (generation === undefined)
    return Promise.reject(new Error("Workspace is not ready."));
  const key = `${identities ? "index" : "visible"}:${path}`;
  const previous = flights.get(key);
  if (previous && !retry) return previous.promise;
  if (previous)
    void invoke("cancel_workspace_request", { requestId: previous.id }).catch(
      () => {},
    );
  const ownGeneration = generation;
  const ownAttempt = attempt;
  const root = snapshot.root;
  const id = `${windowId}:${++request}`;
  snapshot = { ...snapshot, complete: false };
  latest.set(path, id);
  statuses.set(path, { state: "loading", started: Date.now() });
  publish();
  // Provisional cache entries never mark a directory complete.
  if (!revisions.has(path))
    void cachedDirectory(root, path).then((entries) => {
      if (entries && ownAttempt === attempt && !revisions.has(path))
        apply(path, entries);
    });
  const promise = invoke<Listing>("list_directory", {
    generation: ownGeneration,
    path,
    identities,
    requestId: id,
  })
    .then((result) => {
      if (
        ownAttempt !== attempt ||
        flights.get(key)?.id !== id ||
        latest.get(path) !== id ||
        result.generation !== generation
      )
        return;
      if (revisions.get(path) !== result.revision) {
        revisions.set(path, result.revision);
        apply(path, result.entries);
        void cacheDirectory(root, path, result.entries);
      }
      statuses.set(path, { state: "loaded" });
      const validChildren = new Set(
        result.entries
          .filter((entry) => entry.kind !== "note")
          .map((entry) => entry.path),
      );
      for (const known of statuses.keys()) {
        if (
          known &&
          known.split("/").slice(0, -1).join("/") === path &&
          !validChildren.has(known)
        ) {
          for (const descendant of statuses.keys())
            if (descendant === known || descendant.startsWith(known + "/")) {
              statuses.delete(descendant);
              revisions.delete(descendant);
              queue.delete(descendant);
            }
        }
      }
      for (const entry of result.entries)
        if (entry.kind !== "note" && !statuses.has(entry.path))
          queue.add(entry.path);
      if (!path) performance.mark("lotus-vaults-ready");
      publish();
    })
    .catch((error) => {
      if (
        ownAttempt === attempt &&
        flights.get(key)?.id === id &&
        latest.get(path) === id
      ) {
        statuses.set(path, { state: "failed", error: String(error) });
        snapshot = { ...snapshot, complete: false };
        publish();
      }
      throw error;
    })
    .finally(() => {
      if (flights.get(key)?.id === id) flights.delete(key);
      if (ownAttempt === attempt) {
        if (queue.size) void startIndexing();
        else if (!indexing && !fullScan) {
          snapshot = {
            ...snapshot,
            complete: [...statuses.values()].every(
              (status) => status.state === "loaded",
            ),
          };
          publish();
        }
      }
    });
  flights.set(key, { id, promise });
  return promise;
}
async function startIndexing() {
  if (indexing) return;
  indexing = true;
  const epoch = indexingEpoch;
  // One low-priority directory at a time. Interactive listings use a separate worker.
  while (queue.size && epoch === indexingEpoch) {
    const path = queue.values().next().value!;
    queue.delete(path);
    await new Promise((resolve) => setTimeout(resolve, 25));
    if (epoch !== indexingEpoch) return;
    await loadDirectory(path, true).catch(() => {});
  }
  if (epoch !== indexingEpoch) return;
  indexing = false;
  snapshot = {
    ...snapshot,
    complete: [...statuses.values()].every(
      (status) => status.state === "loaded",
    ),
  };
  publish();
}
export async function refreshDirectories(paths?: string[]) {
  changeVersion++;
  const parents = paths?.length
    ? new Set(paths.map((path) => path.split("/").slice(0, -1).join("/")))
    : new Set(statuses.keys());
  for (const path of parents) {
    if (!statuses.has(path)) continue;
    // Queue invalidations that arrive during a listing; never silently lose a change.
    await loadDirectory(path, true).catch(() => {});
    queue.add(path);
  }
  void startIndexing();
  return snapshot;
}
export function completeSnapshot(retry = false): Promise<Snapshot> {
  if (fullScan && !retry) return fullScan;
  if (fullScanId)
    void invoke("cancel_workspace_request", { requestId: fullScanId }).catch(
      () => {},
    );
  const scanId = (fullScanId = windowId + ":full:" + ++request);
  fullScan = undefined;
  indexingEpoch++;
  indexing = false;
  queue.clear();
  for (const flight of flights.values()) {
    void invoke("cancel_workspace_request", { requestId: flight.id }).catch(
      () => {},
    );
  }
  flights.clear();
  const version = changeVersion;
  const ownAttempt = attempt;
  return (fullScan ??= invoke<Snapshot>("snapshot", {
    generation,
    requestId: scanId,
  })
    .then((value) => {
      if (ownAttempt !== attempt || scanId !== fullScanId)
        throw new Error("Request superseded.");
      const mark = (entries: Entry[]): Entry[] =>
        entries.map((entry) => ({
          ...entry,
          childrenLoaded: true,
          children: mark(entry.children),
        }));
      const completed = mark(value.entries);
      statuses.clear();
      const record = (path: string, entries: Entry[]) => {
        statuses.set(path, { state: "loaded" });
        revisions.set(path, "complete-" + request++);
        for (const entry of entries)
          if (entry.kind !== "note") record(entry.path, entry.children);
      };
      record("", completed);
      snapshot = {
        ...value,
        entries: completed,
        complete: version === changeVersion,
      };
      publish();
      return snapshot;
    })
    .finally(() => {
      if (ownAttempt === attempt && scanId === fullScanId) {
        fullScan = undefined;
        fullScanId = "";
      }
    }));
}
