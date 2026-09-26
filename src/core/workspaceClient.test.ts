import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../directoryCache", () => ({
  cachedDirectory: async () => undefined,
  cacheDirectory: async () => {},
}));
import {
  initializeWorkspace,
  resetWorkspace,
  loadDirectory,
  directoryStatus,
  subscribeWorkspace,
  workspaceGeneration,
} from "../workspaceClient";
import type { Snapshot } from "../notus";
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { resolve, promise };
};
describe("workspace request isolation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetWorkspace();
    invoke.mockReset();
  });
  afterEach(() => {
    resetWorkspace();
    vi.useRealTimers();
  });
  it("allows retry after an unavailable workspace fails bootstrap", async () => {
    invoke.mockRejectedValueOnce(new Error("Workspace folder unavailable"));
    await expect(initializeWorkspace(false)).rejects.toThrow("unavailable");
    invoke.mockResolvedValue({ root: "reconnected", generation: 1 });
    expect((await initializeWorkspace(false)).root).toBe("reconnected");
  });
  it("keeps failed folders distinct from empty folders and retries them", async () => {
    invoke.mockResolvedValueOnce({ root: "root", generation: 1 });
    await initializeWorkspace(false);
    invoke.mockRejectedValueOnce(new Error("Access denied"));
    await expect(loadDirectory("F")).rejects.toThrow("Access denied");
    expect(directoryStatus("F").state).toBe("failed");
    invoke.mockResolvedValue({ generation: 1, path: "F", revision: "1", entries: [] });
    await loadDirectory("F", false, true);
    expect(directoryStatus("F").state).toBe("loaded");
  });
  it("opens detached windows without starting a directory scan", async () => {
    invoke.mockResolvedValue({ root: "root", generation: 1 });
    await initializeWorkspace(false);
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "workspace_bootstrap",
    ]);
  });
  it("returns bootstrap before a stalled directory listing and permits another listing", async () => {
    invoke.mockImplementation((command, args) => {
      if (command === "workspace_bootstrap")
        return Promise.resolve({ root: "C:/V", generation: 1 });
      if (command === "list_directory" && args.path === "")
        return new Promise(() => {});
      return Promise.resolve({
        generation: 1,
        path: args.path,
        revision: "1",
        entries: [],
      });
    });
    const first = await initializeWorkspace();
    expect(first.root).toBe("C:/V");
    expect(directoryStatus("").state).toBe("loading");
    await loadDirectory("V/F");
    expect(directoryStatus("V/F").state).toBe("loaded");
  });
  it("ignores late results from the previous workspace", async () => {
    const old = deferred<unknown>();
    let generation = 1;
    invoke.mockImplementation((command, args) => {
      if (command === "workspace_bootstrap")
        return Promise.resolve({ root: `root-${generation}`, generation });
      if (command === "cancel_workspace_request") return Promise.resolve();
      if (args.generation === 1) return old.promise;
      return Promise.resolve({
        generation,
        path: args.path,
        revision: "2",
        entries: [],
      });
    });
    let latest: Snapshot | undefined;
    const dispose = subscribeWorkspace((value) => {
      latest = value;
    });
    await initializeWorkspace();
    resetWorkspace();
    generation = 2;
    await initializeWorkspace();
    old.resolve({
      generation: 1,
      path: "",
      revision: "1",
      entries: [{ name: "Old", path: "Old", kind: "vault", children: [] }],
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(workspaceGeneration()).toBe(2);
    expect(latest?.root).toBe("root-2");
    expect(latest?.entries).toEqual([]);
    dispose();
  });
  it("coalesces duplicate listings and supersedes a stalled attempt on retry", async () => {
    const stalled = deferred<unknown>();
    let calls = 0;
    invoke.mockImplementation((command, args) => {
      if (command === "workspace_bootstrap")
        return Promise.resolve({ root: "root", generation: 1 });
      if (command === "cancel_workspace_request") return Promise.resolve();
      if (args.path === "F" && ++calls === 1) return stalled.promise;
      if (args.path === "") return new Promise(() => {});
      return Promise.resolve({
        generation: 1,
        path: args.path,
        revision: "2",
        entries: [],
      });
    });
    await initializeWorkspace();
    const first = loadDirectory("F");
    expect(loadDirectory("F")).toBe(first);
    await loadDirectory("F", false, true);
    stalled.resolve({ generation: 1, path: "F", revision: "old", entries: [] });
    await first;
    expect(directoryStatus("F").state).toBe("loaded");
    expect(
      invoke.mock.calls.some(
        ([command]) => command === "cancel_workspace_request",
      ),
    ).toBe(true);
  });
});
