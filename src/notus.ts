import { invoke as nativeInvoke } from "@tauri-apps/api/core";
import { readDeadline } from "./readDeadline";
import { loadEditorRuntime } from "./editorBridge";
import {
  initializeWorkspace,
  workspaceGeneration,
  completeSnapshot,
  resetWorkspace,
} from "./workspaceClient";
async function invoke<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const generation = workspaceGeneration();
  const value = await nativeInvoke<T>(command, { ...args, generation });
  if (generation !== workspaceGeneration())
    throw new Error("Workspace changed.");
  return value;
}
export type Entry = {
  childrenLoaded?: boolean;
  name: string;
  path: string;
  kind: "vault" | "folder" | "note";
  children: Entry[];
  identity?: string | null;
};
export type Snapshot = {
  complete?: boolean;
  root: string;
  entries: Entry[];
  legacy_root?: string | null;
};
export type Area = { id: string; name: string; icon: string };
export type OrganizerState = {
  revision: number;
  areas: Area[];
  assignments: Record<string, string>;
  orders: Record<string, string[]>;
};
export type Document = {
  identity?: string | null;
  path: string;
  content: string;
  revision: string;
  locked: boolean;
};
export type SearchResult = { path: string; snippet: string };
export type StorageLocations = { app_data: string; browser_data: string; workspace_data: string; trash: string };
export type TrashItem = {
  id: string;
  name: string;
  original: string;
  kind: Entry["kind"];
  deleted: number;
};
export type BackupPreview = {
  archive: string;
  revision: string;
  manifest: {
    source_root: string;
    include_vaults: boolean;
    include_trash: boolean;
    files: { path: string; size: number; sha256: string }[];
    settings: Record<string, string>;
  };
};
export const api = {
  exportBackup: (
    settings: Record<string, string>,
    vaults: boolean,
    trash: boolean,
  ) => invoke<string | null>("export_backup", { settings, vaults, trash }),
  previewBackup: () => invoke<BackupPreview | null>("preview_backup"),
  importBackup: (plan: BackupPreview, settings: boolean) =>
    invoke<{
      root: string;
      source_root: string;
      settings: Record<string, string>;
    } | null>("import_backup", { plan, settings }),
  readClipboard: () => invoke<string>("read_clipboard"),
  writeClipboard: (text: string) => invoke<void>("write_clipboard", { text }),
  previewConversion: (source: string, parent: string, name: string) =>
    invoke<Conversion>("preview_conversion", { source, parent, name }),
  convertVault: (
    source: string,
    parent: string,
    name: string,
    revision: string,
  ) => invoke<Conversion>("convert_vault", { source, parent, name, revision }),
  openExternal: (url: string) => invoke<void>("open_external", { url }),
  organizer: () => invoke<OrganizerState>("get_organizer"),
  saveOrganizer: (value: OrganizerState) =>
    invoke<OrganizerState>("save_organizer", { value }),
  snapshot: completeSnapshot,
  startupSnapshot: initializeWorkspace,
  search: (query: string, requestId?: string) =>
    invoke<SearchResult[]>("search_notes", { query, requestId }),
  cancel: (requestId: string) =>
    nativeInvoke<void>("cancel_workspace_request", { requestId }),
  read: async (path: string) => {
    const [note] = await readDeadline(
      Promise.all([
        invoke<Document>("read_note", { path }),
        loadEditorRuntime(),
      ]),
    );
    return note;
  },
  write: (path: string, content: string, revision: string) =>
    invoke<Document>("write_note", { path, content, revision }),
  create: (parent: string, kind: Entry["kind"], name: string) =>
    invoke<string>("create_entry", { parent, kind, name }),
  importMarkdown: (parent: string, sources: string[]) =>
    invoke<string[]>("import_markdown", { parent, sources }),
  relocate: (path: string, parent: string, name: string) =>
    invoke<string>("relocate_entry", { path, parent, name }),
  remove: (path: string) => invoke<void>("delete_entry", { path }),
  reveal: (path: string) => invoke<void>("reveal_vault", { path }),
  storageLocations: (reveal?: "app_data" | "browser_data" | "workspace_data" | "trash") =>
    invoke<StorageLocations>("storage_locations", { reveal }),
  chooseRoot: async () => {
    const changed = await nativeInvoke<boolean>("choose_root");
    if (changed) {
      resetWorkspace();
    }
    return changed;
  },
  retryWatcher: () => nativeInvoke<void>("retry_workspace_watcher"),
  importVault: () => invoke<string | null>("import_vault"),
  listTrash: () => invoke<TrashItem[]>("list_trash"),
  restore: (id: string) => invoke<string>("restore_trash", { id }),
  purge: (ids: string[]) => invoke<void>("purge_trash", { ids }),
  setLocked: (path: string, locked: boolean, revision: string) =>
    invoke<Document>("set_locked", { path, locked, revision }),
  registerView: (path: string | null, additional: string[] = []) =>
    invoke<void>("register_view", { path, additional }),
  detach: (path: string, atCursor: boolean) =>
    invoke<string>("detach_note", { path, atCursor }),
  focusMain: (path: string) => invoke<boolean>("focus_main", { path }),
  registerTabStrip: (bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => invoke<void>("register_tab_strip", { bounds }),
  tabDropTarget: () =>
    invoke<{ label: string; client_x: number } | null>("tab_drop_target"),
  releaseHistory: () => invoke<string>("release_history"),
  browserNavigate: (label: string, url: string) =>
    invoke<string>("browser_navigate", { label, url }),
  browserReload: (label: string) => invoke<void>("browser_reload", { label }),
  browserHistory: (label: string, forward: boolean) =>
    invoke<void>("browser_history", { label, forward }),
  browserUrl: (label: string) =>
    invoke<string>("browser_url_current", { label }),
};
export type Conversion = {
  source: string;
  destination: string;
  files: [string, string][];
  revision: string;
};
export const parentOf = (path: string) =>
  path.split("/").slice(0, -1).join("/");
export const stem = (path: string) =>
  path
    .split("/")
    .at(-1)!
    .replace(/\.(md|markdown)$/i, "");
export const flatten = (entries: Entry[]): Entry[] =>
  entries.flatMap((e) => [e, ...flatten(e.children)]);
