import { markdownDropTarget } from "./core/markdownDrop";
import { CreateMenu } from "./CreateMenu";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { externalEditorUpdate } from "./editorBridge";
import {
  initializeWorkspace,
  resetWorkspace,
  subscribeWorkspace,
  directoryStatus,
  loadDirectory,
  refreshDirectories,
  workspaceGeneration,
  hasPendingDirectories,
} from "./workspaceClient";
import { externalMoves } from "./core/fileChanges";
import { websiteUrl } from "./core/links";
import type { EditorView } from "@codemirror/view";
import { undo, undoDepth } from "./editorBridge";
import { exportSettings, importSettings } from "./portableSettings";
import { AreaIcon } from "./AreaIcons";
import { NoteSearch } from "./NoteSearch";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen, emitTo } from "@tauri-apps/api/event";
const AIChat = lazy(() =>
  import("./AIChat").then((m) => ({ default: m.AIChat })),
);
import {
  editedBody,
  minimalChange,
  preserveNotePosition,
  type NoteContext,
} from "./ai";
import { type TableActionRequest } from "./TableEditor";
import { useNoteAppearance, moveNoteAppearance } from "./noteAppearance";
import { serializeTable, findTables } from "./core/tables";
import { VaultSetup } from "./VaultSetup";
import { VaultSwitcher } from "./VaultSwitcher";
import type { TabTransfer } from "./TitleBar";
import {
  FolderOpen,
  FolderTree,
  Bookmark,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
  Check,
  FolderPlus,
  FilePlus2,
  Settings,
  EyeOff,
  ChevronsUpDown,
} from "lucide-react";
import { SidebarTree, InlineName } from "./SidebarTree";
import { anchorAt, type Anchor, type InlineEdit } from "./sidebarTypes";
import { AnchoredPanel } from "./AnchoredPanel";
import { TitleBar, type NoteTab } from "./TitleBar";
import {
  api,
  flatten,
  parentOf,
  stem,
  type Entry,
  type Snapshot,
  type Document,
  type OrganizerState,
  type Conversion,
} from "./notus";
import { splitFrontmatter, relativeNoteLink } from "./core/markdown";
import { PropertiesPanel } from "./PropertiesPanel";
import { NoteHeader } from "./NoteHeader";
import { ContextMenu } from "./ContextMenu";
import {
  BrowserPane,
  closeBrowserSession,
  hideBrowserSession,
} from "./BrowserPane";
import type { BrowserSession } from "./browserSession";
import type { NoteEditorAppearance } from "./NoteEditor";

// These panels are useful, but they should not delay the first usable Lotus window.
const MarkdownView = lazy(() =>
  import("./MarkdownView").then((module) => ({ default: module.MarkdownView })),
);
const AppSettings = lazy(() =>
  import("./AppSettings").then((module) => ({ default: module.AppSettings })),
);
const WorkspaceOrganizer = lazy(() =>
  import("./WorkspaceOrganizer").then((module) => ({
    default: module.WorkspaceOrganizer,
  })),
);
const NoteEditor = lazy(() =>
  import("./NoteEditor").then((module) => ({ default: module.NoteEditor })),
);
import { editorItems } from "./editorBridge";
import { codeTarget, readTarget } from "./editorBridge";
import type { EditTarget } from "./editTarget";
import { FeatureBoundary } from "./FeatureBoundary";
import { useBookmarks, moveBookmarks } from "./bookmarks";

type DialogState = { kind: "delete"; entry: Entry };
type ActionMenu = { entry: Entry; anchor: Anchor; settings?: boolean };
const storage = {
  get: (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key: string, value: string) => localStorage.setItem(key, value),
  remove: (key: string) => localStorage.removeItem(key),
};
const browserTitle = (url: string) => {
  if (!url) return "New tab";
  try {
    return new URL(url).hostname.replace(/^www\./, "") || "Browser";
  } catch {
    return "Browser";
  }
};
function Icon({
  label,
  children,
  onClick,
  disabled = false,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className="icon"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const trigger = useRef(document.activeElement as HTMLElement);
  useLayoutEffect(() => {
    const el = ref.current!;
    const previous = trigger.current;
    el.showModal();
    return () => {
      el.close();
      previous?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={title === "Add or edit link" ? "link-dialog" : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <Icon label="Close dialog" onClick={onClose}>
          <X size={18} />
        </Icon>
      </header>
      {children}
    </dialog>
  );
}
export default function App() {
  useEffect(() => {
    requestAnimationFrame(() => performance.mark("lotus-shell-ready"));
  }, []);
  const [aiMounted, setAiMounted] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot>({
    root: "",
    entries: [],
    complete: false,
  });
  const [loading, setLoading] = useState(true);
  const [startupError, setStartupError] = useState("");
  const [startupAttempt, setStartupAttempt] = useState(0);
  const [startupAge, setStartupAge] = useState(0);
  const [directoryTick, setDirectoryTick] = useState(0);
  const [watcherError, setWatcherError] = useState("");
  useEffect(() => {
    const start = Date.now();
    const timer = window.setInterval(() => {
      if (loading) setStartupAge(Date.now() - start);
      if (hasPendingDirectories()) setDirectoryTick((value) => value + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [startupAttempt, loading]);
  const snapshotReceiver = useRef<(value: Snapshot) => void>(() => {});
  useEffect(
    () => subscribeWorkspace((value) => snapshotReceiver.current(value)),
    [],
  );
  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void listen<string>("lotus-watcher-error", (event) =>
      setWatcherError(event.payload),
    ).then((off) => {
      if (cancelled) off();
      else dispose = off;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);
  const [selected, setSelected] = useState("");
  const [doc, setDoc] = useState<Document | null>(null);
  const [draft, setDraft] = useState("");
  const [releaseHistory, setReleaseHistory] = useState("");
  const [appearance, setAppearance] = useNoteAppearance(
    snapshot.root,
    doc?.path ?? "",
  );
  const [tableActions, setTableActions] = useState<TableActionRequest | null>(
    null,
  );
  useEffect(() => {
    setTableActions(null);
  }, [doc?.path, doc?.locked, draft]);
  useEffect(() => {
    const handler = (event: Event) => {
      if (!doc) return;
      const detail = (event as CustomEvent<TableActionRequest>).detail;
      menuPane.current = detail.trigger.closest(".secondary-pane")
        ? "secondary"
        : "primary";
      menuTarget.current = detail.target ?? null;
      setTableMenu(null);
      setTableActions(detail);
    };
    window.addEventListener("notus-table-actions", handler);
    return () => window.removeEventListener("notus-table-actions", handler);
  }, [doc]);
  const [status, setStatus] = useState("Saved");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    storage.get("notus-theme") === "light" ? "light" : "dark",
  );
  const [sidebar, setSidebar] = useState(
    () =>
      getCurrentWindow().label === "main" &&
      storage.get("notus-sidebar") !== "closed",
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [externalDropTarget, setExternalDropTarget] = useState("");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    Math.min(
      480,
      Math.max(220, Number(storage.get("notus-sidebar-width")) || 272),
    ),
  );
  const [bookmarks, toggleBookmark] = useBookmarks(snapshot.root);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [activePane, setActivePane] = useState<"primary" | "secondary">(
    "primary",
  );
  const [splitRatio, setSplitRatio] = useState(50);
  const [splitMenu, setSplitMenu] = useState<Anchor | null>(null);
  const [tabMenu, setTabMenu] = useState<{ anchor: Anchor; id: number } | null>(
    null,
  );
  const [linkDialog, setLinkDialog] = useState<{
    target: EditTarget;
    label: string;
    url: string;
    query: string;
  } | null>(null);
  const [conversion, setConversion] = useState<{
    source: Entry;
    parent: string;
    name: string;
    preview: Conversion | null;
    error: string;
    busy: boolean;
  } | null>(null);
  const secondaryEditor = useRef<EditorView | null>(null);
  const menuTarget = useRef<EditTarget | null>(null);
  const menuPane = useRef<"primary" | "secondary">("primary");
  const [splitView, setSplitView] = useState<"right" | "down" | null>(null);
  const [secondaryDoc, setSecondaryDoc] = useState<Document | null>(null);
  const [secondarySaveError, setSecondarySaveError] = useState(false);
  const [secondaryDraft, setSecondaryDraft] = useState("");
  const [secondaryBrowser, setSecondaryBrowser] =
    useState<BrowserSession | null>(null);
  const secondaryRef = useRef<{ doc: Document | null; draft: string }>({
    doc: null,
    draft: "",
  });
  const [secondaryAppearance, setSecondaryAppearance] = useNoteAppearance(
    snapshot.root,
    secondaryDoc?.path ?? "",
  );
  const secondaryValue =
    secondaryDoc?.path === doc?.path ? draft : secondaryDraft;
  const secondaryNote = secondaryDoc?.path === doc?.path ? doc : secondaryDoc;
  const [settings, setSettings] = useState(false);
  // Settings is a DOM modal. When a native browser child is active on Windows,
  // it otherwise remains above this modal and steals its pointer input.
  useEffect(() => {
    if (!settings) return;
    const id = "lotus-settings-modal";
    window.dispatchEvent(
      new CustomEvent("lotus-native-overlay", { detail: { id, open: true } }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent("lotus-native-overlay", {
          detail: { id, open: false },
        }),
      );
    };
  }, [settings]);
  const [aiOpen, setAiOpen] = useState(false);
  useEffect(() => {
    if (aiOpen) setAiMounted(true);
  }, [aiOpen]);
  const [aiPane, setAiPane] = useState<"primary" | "secondary">("primary");
  const [aiSettings, setAiSettings] = useState(false);
  const [vaultPath, setVaultPath] = useState("");
  const [organizer, setOrganizer] = useState<OrganizerState>({
    revision: 0,
    areas: [],
    assignments: {},
    orders: {},
  });
  const editorView = useRef<EditorView | null>(null);
  const [tableMenu, setTableMenu] = useState<{
    anchor: Anchor;
    position: number;
    path: string;
  } | null>(null);
  const [tableInsert, setTableInsert] = useState<{
    position: number;
    path: string;
  } | null>(null);
  const [tableRows, setTableRows] = useState(3);
  const [tableColumns, setTableColumns] = useState(3);
  const [vaultSetup, setVaultSetup] = useState<"create" | "add" | null>(null);
  const [vaultSetupBusy, setVaultSetupBusy] = useState(false);
  const [fontFamily, setFontFamily] = useState(
    () => storage.get("notus-font-family") || "Georgia",
  );
  useEffect(() => {
    storage.set("notus-font-family", fontFamily);
  }, [fontFamily]);
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === "notus-font-family" && e.newValue)
        setFontFamily(e.newValue);
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);
  const [textPane, setTextPane] = useState<"primary" | "secondary">("primary");
  const [textPanel, setTextPanel] = useState<Anchor | null>(null);
  const [fontSize, setFontSize] = useState(() =>
    Math.min(28, Math.max(12, Number(storage.get("notus-font-size")) || 15)),
  );
  const [fontWeight, setFontWeight] = useState(() =>
    [400, 500, 600, 700].includes(Number(storage.get("notus-font-weight")))
      ? Number(storage.get("notus-font-weight"))
      : 400,
  );
  const windowLabel = getCurrentWindow().label;
  const detached = windowLabel !== "main";
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [actions, setActions] = useState<ActionMenu | null>(null);
  const [inline, setInline] = useState<InlineEdit | null>(null);
  const [hiddenVaults, setHiddenVaults] = useState<string[]>([]);
  const [hiddenPanel, setHiddenPanel] = useState<Anchor | null>(null);
  const [tabs, setTabs] = useState<NoteTab[]>(() =>
    detached ? [] : [{ id: 0, path: null, pinned: true }],
  );
  const [activeTab, setActiveTab] = useState(0);
  const tabSequence = useRef(1);
  const activeTabRef = useRef(0);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const pendingTabSelection = useRef<number | null>(null);
  const tabSelectionRunning = useRef(false);
  const tabSelectionVersion = useRef(0);
  const inlineTrigger = useRef<HTMLElement | null>(null);
  const inlineBusy = useRef(false);
  const [name, setName] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [working, setWorking] = useState(false);
  const current = useRef<{ doc: Document | null; draft: string; root: string }>(
    { doc: null, draft: "", root: "" },
  );
  const pending = useRef<Promise<boolean> | null>(null);
  const navigating = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const visibleEntries = useMemo(
    () => snapshot.entries.filter((e) => !hiddenVaults.includes(e.path)),
    [snapshot.entries, hiddenVaults],
  );
  // A vault is deliberately chosen by the user; do not preload the first one.
  const activeVault = visibleEntries.find((e) => e.path === vaultPath);
  const organizerActive =
    tabs.find((t) => t.id === activeTab)?.organizer === true;
  useEffect(() => {
    if (!snapshot.root || !vaultPath) return;
    void loadDirectory(vaultPath).catch((e) => setError(String(e)));
  }, [vaultPath, snapshot.root]);
  useEffect(() => {
    if (!snapshot.root) return;
    for (const entry of flatten(snapshot.entries)) {
      if (
        entry.kind === "folder" &&
        entry.path.startsWith(vaultPath + "/") &&
        !collapsed.has(entry.path) &&
        directoryStatus(entry.path).state === "unloaded"
      )
        void loadDirectory(entry.path).catch(() => {});
    }
  }, [snapshot.entries, snapshot.root, vaultPath, collapsed]);
  const needsCompleteTree = organizerActive || !!linkDialog;
  useEffect(() => {
    if (snapshot.root && needsCompleteTree && !snapshot.complete)
      void api.snapshot().catch((e) => setError(String(e)));
  }, [needsCompleteTree, snapshot.root, snapshot.complete]);

  const releaseActive = tabs.find((t) => t.id === activeTab)?.release === true;
  const browserActive = tabs.find((t) => t.id === activeTab)?.browser;
  const primaryBrowser = Boolean(browserActive && splitView);
  const files = useMemo(() => flatten(visibleEntries), [visibleEntries]);
  const selectedEntry = files.find((e) => e.path === selected);
  const folder =
    selectedEntry?.kind === "note"
      ? parentOf(selectedEntry.path)
      : (selectedEntry?.path ?? activeVault?.path ?? "");
  const canCreateNote = !!folder;
  const draftKey = (path: string) =>
    `notus-draft:${current.current.root}:${windowLabel}:${path}`;
  const viewPositions = useRef(
    new Map<string, { top: number; anchor: number; head: number }>(),
  );
  const rememberView = () => {
    const note = current.current.doc,
      scroll = document.querySelector<HTMLElement>(".primary-pane");
    if (note && scroll) {
      const sel = editorView.current?.state.selection.main;
      viewPositions.current.set(note.path, {
        top: scroll.scrollTop,
        anchor: sel?.anchor ?? 0,
        head: sel?.head ?? 0,
      });
    }
  };
  const positionPath = doc?.path;
  const positionLocked = doc?.locked;
  useLayoutEffect(() => {
    const saved = positionPath
      ? viewPositions.current.get(positionPath)
      : undefined;
    const scroll = document.querySelector<HTMLElement>(".primary-pane");
    if (!scroll) return;
    const restore = () => {
      scroll.scrollTop = saved?.top ?? 0;
    };
    restore();
    const frame = requestAnimationFrame(() => {
      restore();
      requestAnimationFrame(restore);
    });
    return () => cancelAnimationFrame(frame);
  }, [positionPath, positionLocked]);
  const loadDocument = (next: Document, targetTabId = activeTabRef.current) => {
    rememberView();
    let text = next.content;
    let base = next;
    let conflicted = false;
    const legacyKey = `notus-draft:${current.current.root}:${next.path}`;
    const saved =
      storage.get(draftKey(next.path)) ??
      (windowLabel === "main" ? storage.get(legacyKey) : null);
    if (
      saved !== null &&
      windowLabel === "main" &&
      storage.get(legacyKey) !== null
    ) {
      storage.set(draftKey(next.path), saved);
      storage.remove(legacyKey);
    }
    if (saved !== null) {
      try {
        const recovery = JSON.parse(saved) as {
          content: string;
          revision: string;
        };
        if (
          typeof recovery.content === "string" &&
          typeof recovery.revision === "string"
        ) {
          text = recovery.content;
          if (text !== next.content) {
            setNotice("Recovered your unsaved draft.");
            conflicted = recovery.revision !== next.revision;
            base = { ...next, revision: recovery.revision };
          } else storage.remove(draftKey(next.path));
        }
      } catch {
        setError("Could not read the saved draft recovery record.");
      }
    }
    void api
      .registerView(
        next.path,
        secondaryRef.current.doc?.path ? [secondaryRef.current.doc.path] : [],
      )
      .catch(setError);
    if (current.current.doc?.path === base.path)
      externalEditorUpdate(editorView.current, splitFrontmatter(text).body);
    current.current.doc = base;
    current.current.draft = text;
    setDoc(base);
    setActivePane("primary");
    setTabs((previous) =>
      previous.some((tab) => tab.id === targetTabId)
        ? previous.map((tab) =>
            tab.id === targetTabId ? { ...tab, path: next.path } : tab,
          )
        : [...previous, { id: targetTabId, path: next.path }],
    );
    setDraft(text);
    setStatus(
      conflicted
        ? "Conflict"
        : text === next.content
          ? "Saved"
          : "Unsaved draft",
    );
    if (conflicted)
      setError(
        "CONFLICT: Your recovered draft and the file on disk both changed. Save a recovery copy to keep both.",
      );
    setCollapsed(
      (previous) =>
        new Set(
          [...previous].filter((path) => !next.path.startsWith(path + "/")),
        ),
    );
    storage.set(`notus-last:${current.current.root}`, next.path);
  };
  const knownFolders = useRef(new Set<string>());
  const expandedFolders = useRef(new Set<string>());
  const knownEntries = useRef(new Map<string, Entry>());
  const latestSnapshot = useRef(snapshot);
  latestSnapshot.current = snapshot;
  const acceptSnapshot = (next: Snapshot) => {
    const openEntries: Entry[] = [current.current.doc, secondaryRef.current.doc]
      .filter((note): note is Document => !!note?.identity)
      .map((note) => ({
        name: note.path.split("/").at(-1)!,
        path: note.path,
        kind: "note",
        children: [],
        identity: note.identity,
      }));
    if (latestSnapshot.current.root !== next.root) {
      knownEntries.current.clear();
      knownFolders.current.clear();
    }
    const moves = externalMoves(
      [...knownEntries.current.values(), ...openEntries],
      next.entries,
    );
    for (const [old, path] of moves) {
      if (expandedFolders.current.delete(old))
        expandedFolders.current.add(path);
    }
    const newFolders = flatten(next.entries).filter(
      (entry) =>
        entry.kind === "folder" && !knownFolders.current.has(entry.path),
    );
    if (newFolders.length) {
      for (const entry of newFolders) knownFolders.current.add(entry.path);
      setCollapsed(
        (previous) =>
          new Set([
            ...previous,
            ...newFolders
              .filter(
                (entry) =>
                  !expandedFolders.current.has(entry.path) &&
                  !(
                    moves.get(current.current.doc?.path ?? "") ??
                    current.current.doc?.path
                  )?.startsWith(entry.path + "/"),
              )
              .map((entry) => entry.path),
          ]),
      );
    }
    if (next.complete) knownEntries.current.clear();
    for (const entry of flatten(next.entries))
      knownEntries.current.set(entry.path, { ...entry, children: [] });
    if (moves.size) {
      const remap = (path: string) => moves.get(path) ?? path;
      setTabs((previous) =>
        previous.map((tab) =>
          tab.path ? { ...tab, path: remap(tab.path) } : tab,
        ),
      );
      setVaultPath(remap);
      setSelected(remap);
      setCollapsed((previous) => new Set([...previous].map(remap)));
      setHiddenVaults((previous) => previous.map(remap));
      for (const [old, path] of moves) {
        const position = viewPositions.current.get(old);
        if (position) viewPositions.current.set(path, position);
        const recovery = storage.get(draftKey(old));
        if (recovery) {
          storage.set(draftKey(path), recovery);
          storage.remove(draftKey(old));
        }
        moveBookmarks(next.root, old, path);
        moveNoteAppearance(next.root, old, path);
      }
      const note = current.current.doc;
      if (note && moves.has(note.path)) {
        rememberView();
        const moved = { ...note, path: remap(note.path) };
        const position = viewPositions.current.get(note.path);
        if (position) viewPositions.current.set(moved.path, position);
        current.current.doc = moved;
        setDoc(moved);
        setStatus(
          current.current.draft === note.content ? "Saved" : "Unsaved draft",
        );
      }
      const second = secondaryRef.current.doc;
      if (second && moves.has(second.path)) {
        const moved = { ...second, path: remap(second.path) };
        secondaryRef.current.doc = moved;
        setSecondaryDoc(moved);
      }
    }
    latestSnapshot.current = next;
    setSnapshot(next);
    return moves;
  };
  const reconcileOrganizer = async (moves: Map<string, string>) => {
    let organization = await api.organizer();
    if (moves.size) {
      const assignments = Object.fromEntries(
        Object.entries(organization.assignments).map(([path, id]) => [
          moves.get(path) ?? path,
          id,
        ]),
      );
      if (
        JSON.stringify(assignments) !== JSON.stringify(organization.assignments)
      )
        organization = await api.saveOrganizer({
          ...organization,
          assignments,
        });
    }
    setOrganizer((previous) =>
      JSON.stringify(previous) === JSON.stringify(organization)
        ? previous
        : organization,
    );
  };
  snapshotReceiver.current = (next) => {
    if (!next.root) return;
    const moves = acceptSnapshot(next);
    if (moves.size)
      void reconcileOrganizer(moves).catch((e) => setError(String(e)));
  };
  const refresh = async (complete = false) => {
    const next = complete ? await api.snapshot() : await refreshDirectories();
    const moves = acceptSnapshot(next);
    await reconcileOrganizer(moves);
    return next;
  };

  const save = async (): Promise<boolean> => {
    if (pending.current) {
      if (!(await pending.current)) return false;
      return save();
    }
    const state = current.current;
    if (!state.doc || state.doc.content === state.draft) return true;
    const original = state.doc,
      text = state.draft;
    setStatus("Saving…");
    const task = (async () => {
      try {
        const next = await api.write(original.path, text, original.revision);
        if (current.current.doc?.path === original.path) {
          current.current.doc = next;
          setDoc(next);
          if (secondaryRef.current.doc?.path === next.path) {
            secondaryRef.current = { doc: next, draft: current.current.draft };
            setSecondaryDoc(next);
            setSecondaryDraft(current.current.draft);
          }
          if (current.current.draft === text) {
            storage.remove(draftKey(next.path));
            setStatus("Saved");
          } else {
            storage.set(
              draftKey(next.path),
              JSON.stringify({
                content: current.current.draft,
                revision: next.revision,
              }),
            );
            setStatus("Unsaved draft");
          }
        }
        return true;
      } catch (e) {
        setError(String(e));
        setStatus(String(e).includes("CONFLICT") ? "Conflict" : "Save failed");
        return false;
      }
    })();
    pending.current = task;
    const result = await task;
    pending.current = null;
    if (result && current.current.doc?.content !== current.current.draft)
      return save();
    return result;
  };
  const run = (task: () => Promise<void>) => {
    void task().catch((e) => setError(String(e)));
  };
  const pendingCurrentNote = useRef<string | null>(null);
  const openingCurrentNote = useRef(false);
  const openNote = async (path: string) => {
    performance.mark("lotus-note-request");
    // A sidebar click is an intent to replace the current-note slot.  Keep the
    // newest one while saving or reading instead of silently dropping it.
    pendingCurrentNote.current = path;
    if (openingCurrentNote.current) return;
    openingCurrentNote.current = true;
    navigating.current = true;
    const delayed = window.setTimeout(() => setNotice("Opening note…"), 3000);
    try {
      while (pendingCurrentNote.current) {
        const next = pendingCurrentNote.current;
        pendingCurrentNote.current = null;
        await openCurrentNote(next);
      }
    } finally {
      clearTimeout(delayed);
      setNotice("");
      openingCurrentNote.current = false;
      navigating.current = false;
    }
  };
  const edit = (text: string) => {
    if (!current.current.doc || current.current.doc.locked) return;
    try {
      storage.set(
        draftKey(current.current.doc.path),
        JSON.stringify({
          content: text,
          revision: current.current.doc.revision,
        }),
      );
    } catch {
      setError(
        "Draft recovery storage is full. Keep this note open until it has saved.",
      );
    }
    current.current.draft = text;
    setDraft(text);
    if (secondaryRef.current.doc?.path === current.current.doc.path) {
      secondaryRef.current.draft = text;
      externalEditorUpdate(
        secondaryEditor.current,
        splitFrontmatter(text).body,
      );
      setSecondaryDraft(text);
    }
    setStatus(text === current.current.doc.content ? "Saved" : "Unsaved draft");
  };
  const secondaryPending = useRef<Promise<boolean> | null>(null);
  const editSecondary = (text: string) => {
    const note = secondaryRef.current.doc;
    if (!note || note.locked) return;
    if (note.path === current.current.doc?.path) {
      externalEditorUpdate(editorView.current, splitFrontmatter(text).body);
      edit(text);
      return;
    }
    secondaryRef.current.draft = text;
    setSecondaryDraft(text);
    storage.set(
      draftKey(note.path),
      JSON.stringify({ content: text, revision: note.revision }),
    );
  };
  const saveSecondary = async (): Promise<boolean> => {
    if (secondaryPending.current) {
      if (!(await secondaryPending.current)) return false;
      return saveSecondary();
    }
    const { doc: note, draft: text } = secondaryRef.current;
    if (
      !note ||
      note.path === current.current.doc?.path ||
      note.content === text
    )
      return true;
    const task = (async () => {
      try {
        const next = await api.write(note.path, text, note.revision);
        setSecondarySaveError(false);
        if (secondaryRef.current.doc?.path === note.path) {
          secondaryRef.current.doc = next;
          setSecondaryDoc(next);
          if (secondaryRef.current.draft === text)
            storage.remove(draftKey(note.path));
          else
            storage.set(
              draftKey(note.path),
              JSON.stringify({
                content: secondaryRef.current.draft,
                revision: next.revision,
              }),
            );
        }
        return true;
      } catch (e) {
        setSecondarySaveError(true);
        setError(`Second pane could not save; draft preserved: ${e}`);
        return false;
      }
    })();
    secondaryPending.current = task;
    const result = await task;
    secondaryPending.current = null;
    if (
      result &&
      secondaryRef.current.doc?.content !== secondaryRef.current.draft
    )
      return saveSecondary();
    return result;
  };
  const saveAll = async () => (await save()) && (await saveSecondary());
  const openSecondary = async (path: string) => {
    setVaultPath(path.split("/")[0]);
    if (!(await saveAll())) return;
    const next =
      path === current.current.doc?.path
        ? current.current.doc
        : await api.read(path);
    if (!next) return;
    // A note dropped onto a browser pane replaces that pane's visible content.
    // Keep the browser tab in the tab strip, but hide its native child surface
    // before the note becomes the secondary document.
    const replacedBrowser = secondaryBrowser;
    if (replacedBrowser) {
      setSecondaryBrowser(null);
      void hideBrowserSession(replacedBrowser.id).catch(() => {});
    }
    let text = next.content;
    const recovery = storage.get(draftKey(path));
    if (recovery) {
      try {
        const saved = JSON.parse(recovery);
        if (saved.content !== next.content && saved.revision !== next.revision)
          throw new Error(
            "Draft conflicts with file; open in the main pane to recover.",
          );
        text = saved.content;
      } catch (e) {
        setError(String(e));
        return;
      }
    }
    secondaryRef.current = { doc: next, draft: text };
    setSecondaryDoc(next);
    setSecondaryDraft(text);
    setActivePane("secondary");
  };
  const startSplit = async (direction: "right" | "down") => {
    if (!(await saveAll())) return;
    const activeBrowser = tabsRef.current.find(
      (tab) => tab.id === activeTabRef.current,
    )?.browser;
    if (activeBrowser) {
      // A browser is a native child WebView, not a document. It cannot be
      // rendered in the primary editor branch and split at the same time.
      // Move that exact WebView into the existing secondary-browser slot and
      // restore the note it was opened over as the editable primary pane.
      const primary = current.current.doc;
      if (!primary) {
        setError("Open a note before splitting a browser tab.");
        return;
      }
      const primaryTab = tabsRef.current.find(
        (tab) => tab.path === primary.path,
      );
      if (!primaryTab) {
        setError("The note behind this browser tab is no longer open.");
        return;
      }
      setSecondaryBrowser(activeBrowser);
      activeTabRef.current = primaryTab.id;
      setActiveTab(primaryTab.id);
      setActivePane("primary");
      setSplitRatio(50);
      setSplitView(direction);
      return;
    }
    if (!secondaryRef.current.doc && current.current.doc) {
      secondaryRef.current = {
        doc: current.current.doc,
        draft: current.current.draft,
      };
      setSecondaryDoc(current.current.doc);
      setSecondaryDraft(current.current.draft);
    }
    setSplitRatio(50);
    setSplitView(direction);
  };
  const ensureSecondaryNote = () => {
    if (secondaryRef.current.doc || !current.current.doc) return;
    secondaryRef.current = {
      doc: current.current.doc,
      draft: current.current.draft,
    };
    setSecondaryDoc(current.current.doc);
    setSecondaryDraft(current.current.draft);
  };
  const primaryNoteTab = () =>
    current.current.doc
      ? tabsRef.current.find((tab) => tab.path === current.current.doc?.path)
      : undefined;
  const closeSplit = async () => {
    if (!(await saveAll())) return;
    secondaryRef.current = { doc: null, draft: "" };
    setSecondaryDoc(null);
    setSecondaryDraft("");
    setSecondaryBrowser(null);
    setActivePane("primary");
    setSplitView(null);
  };
  const closePrimaryPane = async () => {
    if (!(await saveAll())) return;
    const remaining = secondaryRef.current.doc;
    await closeSplit();
    if (remaining) await openExtraTab(remaining.path);
  };
  const renameNote = async (path: string, name: string) => {
    if (!name) throw new Error("A note needs a name.");
    if (!(await saveAll()))
      throw new Error("Save or recover the draft before renaming.");
    const next = await api.relocate(
      path,
      parentOf(path),
      name.endsWith(".md") ? name : name + ".md",
    );
    await afterRelocate(path, next);
  };
  const toggleLock = async (pane: "primary" | "secondary" = activePane) => {
    if (!(await saveAll())) return;
    const note =
      pane === "secondary" ? secondaryRef.current.doc : current.current.doc;
    if (!note) return;
    const next = await api.setLocked(note.path, !note.locked, note.revision);
    if (current.current.doc?.path === next.path) {
      current.current.doc = next;
      setDoc(next);
    }
    if (secondaryRef.current.doc?.path === next.path) {
      secondaryRef.current.doc = next;
      setSecondaryDoc(next);
    }
  };
  const openLink = async (
    href: string,
    sourcePane: "primary" | "secondary" = activePane,
  ) => {
    href = href.trim();
    if (href.startsWith("#")) {
      const pane = document.querySelector(
        activePane === "secondary" ? ".secondary-pane" : ".primary-pane",
      );
      const id = decodeURIComponent(href.slice(1));
      pane
        ?.querySelector(`[id="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: "nearest" });
      return;
    }
    const website = websiteUrl(href);
    if (website) {
      await api.openExternal(website);
      return;
    }
    const decoded = decodeURIComponent(href).split("#")[0];
    const source =
      sourcePane === "secondary"
        ? secondaryRef.current.doc?.path
        : current.current.doc?.path;
    const parts = (parentOf(source || "") + "/" + decoded).split("/");
    const normalized: string[] = [];
    for (const part of parts) {
      if (part === "..") normalized.pop();
      else if (part && part !== ".") normalized.push(part);
    }
    const candidates = [decoded, normalized.join("/")];
    const notes = flatten(
      snapshot.complete ? snapshot.entries : (await api.snapshot()).entries,
    ).filter((e) => e.kind === "note");
    const exact = notes.find((e) =>
      candidates.some((p) => e.path === p || e.path === p + ".md"),
    );
    const byName = notes.filter(
      (e) => stem(e.path).toLowerCase() === decoded.toLowerCase(),
    );
    if (exact) await openExtraTab(exact.path, true);
    else if (byName.length === 1) await openExtraTab(byName[0].path, true);
    else
      setError(
        byName.length
          ? "Several notes have this name. Use the link picker to choose the exact note."
          : "Linked note was not found.",
      );
  };
  const showLink = (target: EditTarget) => {
    const match = [...target.text.matchAll(/\[([^\]]+)\]\(([^)]+)\)|\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)].find(
      (m) => m.index! <= target.from && m.index! + m[0].length >= target.to,
    );
    setLinkDialog({
      target: match
        ? { ...target, from: match.index!, to: match.index! + match[0].length }
        : target,
      label: match?.[1] || match?.[4] || match?.[3] || target.text.slice(target.from, target.to),
      url: match?.[2] || match?.[3] || "",
      query: "",
    });
  };
  const live = useRef({
    save: saveAll,
    refresh,
    loadDocument,
    openNote,
    status,
  });
  live.current = { save: saveAll, refresh, loadDocument, openNote, status };
  useEffect(() => {
    let cancelled = false;
    const requestedNote = new URLSearchParams(window.location.search).get(
      "note",
    );
    // A detached note needs no file tree or organiser. Reading it directly keeps
    // the new window focused and avoids repeating the main workspace startup.
    if (detached && requestedNote) {
      void initializeWorkspace(false)
        .then(() => api.read(requestedNote))
        .then((note) => {
          if (cancelled) return;
          current.current.root = "detached";
          tabSequence.current = 1;
          setTabs([{ id: 1, path: note.path }]);
          activeTabRef.current = 1;
          setActiveTab(1);
          live.current.loadDocument(note);
          setSelected(note.path);
        })
        .catch((e) => !cancelled && setError(String(e)))
        .finally(() => !cancelled && setLoading(false));
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    setStartupError("");
    void initializeWorkspace()
      .then(async (next) => {
        if (cancelled) return;
        if (next.legacy_root)
          importSettings(
            exportSettings(next.legacy_root),
            next.legacy_root,
            next.root,
            false,
          );
        current.current.root = next.root;
        setSnapshot(next);
        // Organiser metadata is not needed to render the normal note workspace.
        // Fetch it independently so it never holds up initial interaction.
        void api
          .organizer()
          .then((value) => {
            if (!cancelled) setOrganizer(value);
          })
          .catch(() => {});
        // Launch into a clean workspace. Vaults and the last note are not
        // restored until the user explicitly chooses a vault or note.
        setVaultPath("");
        try {
          const expanded = JSON.parse(
            storage.get("lotus-expanded:" + next.root) ?? "[]",
          );
          expandedFolders.current = new Set(
            Array.isArray(expanded)
              ? expanded.filter((p): p is string => typeof p === "string")
              : [],
          );
        } catch {
          expandedFolders.current.clear();
        }
        try {
          const saved = JSON.parse(
            storage.get(`notus-collapsed:${next.root}`) ?? "[]",
          );
          if (Array.isArray(saved))
            setCollapsed(
              new Set(saved.filter((p): p is string => typeof p === "string")),
            );
        } catch {
          /* Ignore malformed UI preferences. */
        }
        let hidden: string[] = [];
        try {
          const saved = JSON.parse(
            storage.get(`notus-hidden:${next.root}`) ?? "[]",
          );
          if (Array.isArray(saved))
            hidden = saved.filter(
              (value): value is string => typeof value === "string",
            );
        } catch {
          /* Ignore malformed UI preferences. */
        }
        setHiddenVaults(hidden);
        const last = new URLSearchParams(window.location.search).get("note");
        if (last) {
          const note = await api.read(last);
          if (!cancelled) {
            live.current.loadDocument(note);
            setSelected(note.path);
            setVaultPath(last.split("/")[0]);
          }
        } else setSelected("");
      })
      .catch((e) => {
        if (!cancelled) {
          setError(String(e));
          setStartupError(String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [detached, startupAttempt]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    storage.set("notus-theme", theme);
    void getCurrentWindow()
      .setTheme(theme)
      .catch(() => {});
  }, [theme]);
  useEffect(() => {
    if (!snapshot.root || loading) return;
    storage.set(`notus-vault:${snapshot.root}`, vaultPath);
    storage.set(
      `notus-collapsed:${snapshot.root}`,
      JSON.stringify([...collapsed]),
    );
    expandedFolders.current = new Set(
      [...knownFolders.current].filter((path) => !collapsed.has(path)),
    );
    storage.set(
      "lotus-expanded:" + snapshot.root,
      JSON.stringify([...expandedFolders.current]),
    );
  }, [vaultPath, collapsed, snapshot.root, loading]);
  useEffect(() => {
    storage.set("notus-font-size", String(fontSize));
    storage.set("notus-font-weight", String(fontWeight));
  }, [fontSize, fontWeight]);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === "notus-font-size" && event.newValue)
        setFontSize(Math.min(28, Math.max(12, Number(event.newValue) || 16)));
      if (
        event.key === "notus-font-weight" &&
        [400, 500, 600, 700].includes(Number(event.newValue))
      )
        setFontWeight(Number(event.newValue));
      if (
        event.key === "notus-theme" &&
        (event.newValue === "light" || event.newValue === "dark")
      )
        setTheme(event.newValue);
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  useEffect(() => {
    if (getCurrentWindow().label === "main")
      storage.set("notus-sidebar", sidebar ? "open" : "closed");
  }, [sidebar]);
  useEffect(() => {
    storage.set("notus-sidebar-width", String(sidebarWidth));
  }, [sidebarWidth]);
  useEffect(() => {
    const primaryDirty = !!doc && doc.content !== draft;
    const secondaryDirty =
      !!secondaryDoc &&
      secondaryDoc.path !== doc?.path &&
      secondaryDoc.content !== secondaryDraft;
    if (!primaryDirty && !secondaryDirty) return;
    // Keep typing responsive: persistence happens after the writer pauses, while
    // recovery drafts continue to be recorded on every edit.
    const timer = window.setTimeout(() => {
      if (!["Conflict", "Save failed"].includes(live.current.status))
        void live.current.save();
    }, 700);
    return () => window.clearTimeout(timer);
  }, [doc, draft, secondaryDoc, secondaryDraft]);
  useEffect(() => {
    // A slower safety flush still protects a continuously edited note without
    // issuing a filesystem write for every second of active typing.
    const timer = setInterval(() => {
      if (!["Conflict", "Save failed"].includes(live.current.status))
        void live.current.save();
    }, 5000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let refreshing = false;
    const changedPaths = new Set<string>();
    let timer: number | undefined;
    const reconcileOpenNotes = () => {
      if (pending.current || navigating.current) return;
      const note = current.current.doc;
      if (note) {
        void api
          .read(note.path)
          .then((next) => {
            if (current.current.doc !== note) return;
            if (
              current.current.draft !== note.content &&
              next.revision !== note.revision
            ) {
              setStatus("Conflict");
              setError(
                "CONFLICT: This note changed outside Lotus. Your unsaved version is preserved; save a recovery copy to keep both.",
              );
            } else if (
              current.current.draft === note.content &&
              (next.revision !== note.revision || next.locked !== note.locked)
            ) {
              live.current.loadDocument(next);
            }
          })
          .catch(() => {
            setError(
              "This note could not be read from disk. Its open text is preserved; retry or save a recovery copy.",
            );
          });
      }
      const second = secondaryRef.current.doc;
      if (second && second.path !== note?.path && !secondaryPending.current) {
        void api
          .read(second.path)
          .then((next) => {
            if (secondaryRef.current.doc !== second) return;
            if (secondaryRef.current.draft === second.content) {
              externalEditorUpdate(
                secondaryEditor.current,
                splitFrontmatter(next.content).body,
              );
              secondaryRef.current = { doc: next, draft: next.content };
              setSecondaryDoc(next);
              setSecondaryDraft(next.content);
            } else if (
              next.revision !== second.revision ||
              next.locked !== second.locked
            ) {
              secondaryRef.current.doc = { ...second, locked: next.locked };
              setSecondaryDoc(secondaryRef.current.doc);
              setError(
                "CONFLICT: The second note changed outside Lotus. Its unsaved draft is preserved.",
              );
            }
          })
          .catch(() => {});
      }
    };
    const refreshFromFilesystem = (paths: string[] = []) => {
      for (const path of paths) changedPaths.add(path);
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (
          refreshing ||
          navigating.current ||
          pending.current ||
          !current.current.root
        ) {
          if (changedPaths.size) refreshFromFilesystem();
          return;
        }
        refreshing = true;
        void (async () => {
          const paths = [...changedPaths];
          changedPaths.clear();
          const snapshot = await refreshDirectories(paths);
          snapshotReceiver.current(snapshot);
          const present = new Set(flatten(snapshot.entries).map((e) => e.path));
          const before = current.current;
          const note = before.doc;
          if (note && present.has(note.path)) {
            const next = await api.read(note.path);
            if (
              current.current.doc === note &&
              current.current.draft !== note.content &&
              next.revision !== note.revision
            ) {
              setStatus("Conflict");
              setError(
                "CONFLICT: This note changed outside Lotus. Your unsaved version is preserved; save a recovery copy to keep both.",
              );
            }
            if (
              current.current.doc === note &&
              current.current.draft === note.content &&
              (next.revision !== note.revision || next.locked !== note.locked)
            )
              live.current.loadDocument(next);
            else if (
              current.current.doc === note &&
              next.locked !== note.locked
            ) {
              current.current.doc = { ...note, locked: next.locked };
              setDoc(current.current.doc);
              if (next.locked) {
                setError(
                  "This note was locked in another window. Your unsaved draft is kept; unlock it or save a recovery copy.",
                );
                setStatus("Save failed");
              }
            }
          }
          if (note && snapshot.complete && !present.has(note.path)) {
            setStatus("Save failed");
            setError(
              "This note was moved outside the workspace or deleted. Its open text is preserved; restore the file or save a recovery copy.",
            );
          }
          const second = secondaryRef.current.doc;
          if (
            second &&
            present.has(second.path) &&
            second.path !== current.current.doc?.path &&
            !secondaryPending.current
          ) {
            const next = await api.read(second.path);
            if (secondaryRef.current.doc === second) {
              if (secondaryRef.current.draft === second.content) {
                externalEditorUpdate(
                  secondaryEditor.current,
                  splitFrontmatter(next.content).body,
                );
                secondaryRef.current = { doc: next, draft: next.content };
                setSecondaryDoc(next);
                setSecondaryDraft(next.content);
              } else if (
                next.revision !== second.revision ||
                next.locked !== second.locked
              ) {
                secondaryRef.current.doc = { ...second, locked: next.locked };
                setSecondaryDoc(secondaryRef.current.doc);
                setError(
                  "CONFLICT: The second note changed outside Lotus. Its unsaved draft is preserved.",
                );
              }
            }
          }
        })()
          .catch((e) => setError(String(e)))
          .finally(() => {
            refreshing = false;
            if (changedPaths.size) refreshFromFilesystem();
          });
      }, 350);
    };
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<{ structural: boolean; generation: number; paths: string[] }>(
        "lotus-workspace-changed",
        (event) => {
          if (event.payload.generation !== workspaceGeneration()) return;
          if (event.payload.structural) {
            refreshFromFilesystem(event.payload.paths);
          } else reconcileOpenNotes();
        },
      ).then((dispose) => {
        unlisten = dispose;
      }),
    );
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      unlisten?.();
    };
  }, []);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let lastFolderTarget = "";
    let clearFolderTargetTimer: number | undefined;
    const clearFolderTarget = () => {
      lastFolderTarget = "";
      setExternalDropTarget("");
    };
    const folderAt = (position: { x: number; y: number }) => {
      // Tauri reports physical pixels on Windows, while row bounds are CSS
      // pixels. Compare against the rows themselves rather than using
      // elementsFromPoint: a native WebView2 child can sit above DOM hit
      // testing even though the Explorer drag is physically over the sidebar.
      return markdownDropTarget(
        position,
        window.devicePixelRatio || 1,
        [
          ...document.querySelectorAll<HTMLElement>(
            ".tree-row.kind-folder[data-path], [data-vault-drop]",
          ),
        ].map((element) => {
          const bounds = element.getBoundingClientRect();
          const viewport = element
            .closest(".file-tree")
            ?.getBoundingClientRect();
          return {
            path: element.dataset.vaultDrop ?? element.dataset.path ?? "",
            folder: element.classList.contains("kind-folder"),
            left: Math.max(bounds.left, viewport?.left ?? bounds.left),
            right: Math.min(bounds.right, viewport?.right ?? bounds.right),
            top: Math.max(bounds.top, viewport?.top ?? bounds.top),
            bottom: Math.min(bounds.bottom, viewport?.bottom ?? bounds.bottom),
          };
        }),
      );
    };
    // Drag events originate from the WebView. A Window-targeted listener misses
    // those events, notably when native browser child views are present.
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "leave") {
          // Moving an Explorer drag between the main WebView and a browser
          // child view produces a window-level leave/re-enter pair. Keep the
          // last folder briefly so that handoff cannot turn a valid drop into
          // an un-targeted one; a genuine leave still clears its highlight.
          if (clearFolderTargetTimer !== undefined)
            window.clearTimeout(clearFolderTargetTimer);
          clearFolderTargetTimer = window.setTimeout(clearFolderTarget, 350);
          return;
        }
        if (clearFolderTargetTimer !== undefined) {
          window.clearTimeout(clearFolderTargetTimer);
          clearFolderTargetTimer = undefined;
        }
        const target =
          folderAt(event.payload.position) ||
          (event.payload.type === "drop" ? lastFolderTarget : "");
        lastFolderTarget = target;
        setExternalDropTarget(target);
        if (event.payload.type !== "drop") return;
        clearFolderTarget();
        const sources = event.payload.paths.filter((path) =>
          /\.(md|markdown)$/i.test(path),
        );
        if (!target || !sources.length) {
          if (!target)
            setError(
              "Drop Markdown files onto a vault or folder in the sidebar.",
            );
          else setError("Only .md and .markdown files can be imported.");
          return;
        }
        run(async () => {
          const imported = await api.importMarkdown(target, sources);
          setCollapsed((previous) => {
            const next = new Set(previous);
            next.delete(target);
            return next;
          });
          await loadDirectory(target, false, true);
          if (imported[0]) await live.current.openNote(imported[0]);
          setNotice(
            `Imported ${imported.length} Markdown ${imported.length === 1 ? "file" : "files"}.`,
          );
        });
      })
      .then((dispose) => {
        if (disposed) dispose();
        else unlisten = dispose;
      })
      .catch((error) => setError(String(error)));
    return () => {
      disposed = true;
      if (clearFolderTargetTimer !== undefined)
        window.clearTimeout(clearFolderTargetTimer);
      unlisten?.();
    };
  }, []);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        if (await live.current.save()) await getCurrentWindow().destroy();
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  const showCreate = (kind: Entry["kind"], parent = folder) => {
    setBookmarksOpen(false);
    if (kind === "vault") {
      setVaultSetup("create");
      return;
    }
    inlineTrigger.current =
      actions?.anchor.trigger ?? (document.activeElement as HTMLElement);
    setActions(null);
    setHiddenPanel(null);
    setSidebar(true);
    setQuery("");
    const base = kind === "folder" ? "Untitled folder" : "Untitled";
    const siblings = flatten(snapshot.entries).filter(
      (e) => parentOf(e.path) === parent,
    );
    let proposed = base,
      suffix = 1;
    while (
      siblings.some(
        (e) =>
          (kind === "note" ? stem(e.name) : e.name).toLowerCase() ===
          proposed.toLowerCase(),
      )
    )
      proposed = `${base} ${++suffix}`;
    setName(proposed);
    setDialogError("");
    const target = parent;
    if (target) setVaultPath(target.split("/")[0]);
    setInline({ kind: "create", entryKind: kind, parent: target });
    setCollapsed(
      (previous) =>
        new Set(
          [...previous].filter(
            (path) => target !== path && !target.startsWith(path + "/"),
          ),
        ),
    );
  };
  const cancelInline = () => {
    if (inlineBusy.current) return;
    setInline(null);
    setDialogError("");
    requestAnimationFrame(() => inlineTrigger.current?.focus());
  };
  const resetDocument = () => {
    rememberView();
    void api
      .registerView(
        null,
        secondaryRef.current.doc?.path ? [secondaryRef.current.doc.path] : [],
      )
      .catch(setError);
    current.current.doc = null;
    current.current.draft = "";
    setDoc(null);
    setDraft("");
    setError("");
    setStatus("Saved");
  };
  const selectTab = async (id: number) => {
    // Do not discard a click made while another note is saving or loading.
    // The latest requested tab is the only one that may update the editor.
    pendingTabSelection.current = id;
    tabSelectionVersion.current += 1;
    if (tabSelectionRunning.current) return;
    tabSelectionRunning.current = true;
    navigating.current = true;
    try {
      while (pendingTabSelection.current !== null) {
        const requested = pendingTabSelection.current;
        pendingTabSelection.current = null;
        const version = tabSelectionVersion.current;
        if (!(await saveAll())) continue;
        // A newer click arrived while saving. Skip this stale selection before
        // it starts an unnecessary read.
        if (pendingTabSelection.current !== null) continue;
        const tab = tabsRef.current.find((item) => item.id === requested);
        if (!tab) continue;
        if (tab.browser) {
          if (splitView && current.current.doc) {
            if (activePane === "primary") {
              // Keep the split and place the selected browser in the pane the
              // user is working in. Its underlying note becomes pane two.
              ensureSecondaryNote();
              setSecondaryBrowser(null);
              activeTabRef.current = requested;
              setActiveTab(requested);
              setActivePane("primary");
            } else {
              // Browser tabs selected from a split stay in the split instead
              // of unexpectedly replacing the entire workspace.
              setSecondaryBrowser(tab.browser);
              const primary = primaryNoteTab();
              if (primary) {
                activeTabRef.current = primary.id;
                setActiveTab(primary.id);
              }
              setActivePane("secondary");
            }
            continue;
          }
          setSecondaryBrowser((current) =>
            current?.id === tab.browser?.id ? null : current,
          );
          activeTabRef.current = requested;
          setActiveTab(requested);
          setActivePane("primary");
          continue;
        }
        if (tab.release) {
          if (!releaseHistory) setReleaseHistory(await api.releaseHistory());
          if (version !== tabSelectionVersion.current) continue;
          activeTabRef.current = requested;
          setActiveTab(requested);
          resetDocument();
          continue;
        }
        const next = tab.path ? await api.read(tab.path) : null;
        // A read may finish after another tab was clicked. Its result must not
        // overwrite the newer tab's document.
        if (version !== tabSelectionVersion.current) continue;
        activeTabRef.current = requested;
        setActiveTab(requested);
        if (next) {
          setError("");
          loadDocument(next, requested);
          setSelected(next.path);
        } else {
          resetDocument();
          storage.remove(`notus-last:${current.current.root}`);
        }
      }
    } finally {
      tabSelectionRunning.current = false;
      navigating.current = false;
    }
  };
  const openExtraTab = async (
    path: string,
    preserveVault = false,
    before?: number,
  ) => {
    if (!preserveVault) setVaultPath(path.split("/")[0]);
    if (!(await saveAll()))
      throw new Error("Save or recover the current draft first.");
    const next = await api.read(path);
    const existing = tabs.find((t) => !t.pinned && t.path === path);
    const id = existing?.id ?? ++tabSequence.current;
    if (!existing)
      setTabs((previous) => {
        const next = [...previous];
        const targetBefore =
          before === 0 ? next.find((tab) => !tab.pinned)?.id : before;
        const index =
          targetBefore === undefined
            ? -1
            : next.findIndex((tab) => tab.id === targetBefore);
        next.splice(index < 0 ? next.length : index, 0, { id, path });
        return next;
      });
    activeTabRef.current = id;
    setActiveTab(id);
    setTableActions(null);
    setTableMenu(null);
    loadDocument(next);
    setSelected(path);
    setError("");
  };
  const openCurrentNote = async (path: string, preserveVault = false) => {
    const visibleBrowser = tabs.find(
      (tab) => tab.id === activeTabRef.current,
    )?.browser;
    // Recreate Current note only when it is needed. Closing it removes the
    // tab from the strip, while a sidebar note reliably brings it back.
    setTabs((previous) =>
      previous.some((tab) => tab.id === 0)
        ? previous
        : [{ id: 0, path: null, pinned: true }, ...previous],
    );
    activeTabRef.current = 0;
    setActiveTab(0);
    if (!preserveVault) setVaultPath(path.split("/")[0]);
    if (!(await saveAll()))
      throw new Error("Save or recover the current draft first.");
    const next = await api.read(path);
    // A native WebView2 hide can be delayed by a page process. It is cleanup,
    // not a prerequisite for navigating Lotus, so never let it hold the
    // sidebar click hostage. BrowserPane's unmount cleanup hides it again.
    if (visibleBrowser)
      void hideBrowserSession(visibleBrowser.id).catch(() => {});
    // Sidebar navigation always replaces the pinned first tab. Extra tabs are
    // reserved for notes explicitly opened from the menu or dropped in the strip.
    setTableActions(null);
    setTableMenu(null);
    loadDocument(next, 0);
    setSelected(path);
    setError("");
  };
  const paneDropLive = useRef({ openCurrentNote, openSecondary });
  paneDropLive.current = { openCurrentNote, openSecondary };
  useEffect(() => {
    const receivePointerDrop = (event: Event) => {
      const detail = (
        event as CustomEvent<{ path?: unknown; target?: unknown }>
      ).detail;
      if (typeof detail?.path !== "string" || !detail.path) return;
      if (detail.target === "primary-pane")
        void paneDropLive.current
          .openCurrentNote(detail.path)
          .catch((error) => setError(String(error)));
      if (detail.target === "secondary-pane")
        void paneDropLive.current
          .openSecondary(detail.path)
          .catch((error) => setError(String(error)));
    };
    window.addEventListener("lotus-note-pointer-drop", receivePointerDrop);
    return () =>
      window.removeEventListener("lotus-note-pointer-drop", receivePointerDrop);
  }, []);
  useEffect(() => {
    const receiveBrowserDrop = (event: Event) => {
      const detail = (
        event as CustomEvent<{ browserId?: unknown; target?: unknown }>
      ).detail;
      const browserId =
        typeof detail?.browserId === "number" &&
        Number.isInteger(detail.browserId)
          ? detail.browserId
          : null;
      if (browserId === null) return;
      const browser = tabs.find(
        (tab) => tab.browser?.id === browserId,
      )?.browser;
      if (!browser) return;
      if (detail.target === "secondary-pane") {
        setSecondaryBrowser(browser);
        if (activeTabRef.current === browserId) {
          const primary = primaryNoteTab();
          if (primary) {
            activeTabRef.current = primary.id;
            setActiveTab(primary.id);
          }
        }
        setActivePane("secondary");
      } else if (detail.target === "primary-pane") {
        ensureSecondaryNote();
        setSecondaryBrowser((current) =>
          current?.id === browserId ? null : current,
        );
        activeTabRef.current = browserId;
        setActiveTab(browserId);
        setActivePane("primary");
      }
    };
    window.addEventListener("lotus-browser-pointer-drop", receiveBrowserDrop);
    return () =>
      window.removeEventListener(
        "lotus-browser-pointer-drop",
        receiveBrowserDrop,
      );
  }, [tabs]);
  const closeCurrentNote = async () => {
    if (!(await saveAll())) return;
    const wasActive = activeTabRef.current === 0;
    const remaining = tabs.filter((tab) => tab.id !== 0);
    setTabs(remaining);
    if (!wasActive) return;
    const next = remaining[0];
    if (next) {
      await selectTab(next.id);
      return;
    }
    activeTabRef.current = -1;
    setActiveTab(-1);
    resetDocument();
    setSelected("");
    storage.remove(`notus-last:${current.current.root}`);
  };
  const closeTab = async (id: number) => {
    const closing = tabs.find((tab) => tab.id === id);
    if (!closing) return;
    if (closing.pinned) return closeCurrentNote();
    if (closing.browser) {
      if (secondaryBrowser?.id === closing.browser.id)
        setSecondaryBrowser(null);
      await closeBrowserSession(closing.browser.id).catch(() => {});
    }
    if (id === activeTabRef.current) {
      if (tabs.length === 1) {
        if (!(await saveAll())) return;
        await closeSplit();
        resetDocument();
        setTabs([]);
        storage.remove(`notus-last:${current.current.root}`);
        return;
      }
      const index = tabs.findIndex((t) => t.id === id);
      await selectTab(tabs[index === 0 ? 1 : index - 1].id);
      if (activeTabRef.current === id) return;
    }
    setTabs((previous) => previous.filter((tab) => tab.id !== id));
  };
  const closeBrowserPane = async (
    id: number,
    pane: "primary" | "secondary",
  ) => {
    await closeTab(id);
    if (pane === "secondary" && !secondaryRef.current.doc) {
      setSecondaryBrowser(null);
      setSplitView(null);
      setActivePane("primary");
    }
  };
  const closeAll = async () => {
    if (!(await saveAll())) return;
    await Promise.all(
      tabs.flatMap((tab) =>
        tab.browser
          ? [closeBrowserSession(tab.browser.id).catch(() => {})]
          : [],
      ),
    );
    setSecondaryBrowser(null);
    await closeSplit();
    resetDocument();
    if (detached) setTabs([]);
    else setTabs([{ id: 0, path: null, pinned: true }]);
    activeTabRef.current = detached ? 1 : 0;
    setActiveTab(detached ? 1 : 0);
    storage.remove(`notus-last:${current.current.root}`);
  };
  const closeAdditionalTabs = async () => {
    if (!(await saveAll())) return;
    // A temporary tab may be the one the user is reading. Promote its note
    // into the anchored workspace before removing all temporary tabs.
    const active = tabs.find((tab) => tab.id === activeTabRef.current);
    const path = active?.path ?? current.current.doc?.path;
    await Promise.all(
      tabs.flatMap((tab) =>
        !tab.pinned && tab.browser
          ? [closeBrowserSession(tab.browser.id).catch(() => {})]
          : [],
      ),
    );
    setSecondaryBrowser(null);
    await closeSplit();
    setTabs((previous) => previous.filter((tab) => tab.pinned));
    activeTabRef.current = 0;
    setActiveTab(0);
    setActivePane("primary");
    if (!path) return;
    const next = await api.read(path);
    if (!next) return;
    setVaultPath(path.split("/")[0]);
    loadDocument(next);
    setSelected(path);
    setError("");
  };
  const openOrganizer = async () => {
    if (!(await saveAll())) return;
    const existing = tabs.find((tab) => tab.organizer);
    if (existing) {
      await closeTab(existing.id);
      setSettings(false);
      return;
    }
    const id = ++tabSequence.current;
    setTabs((previous) => [...previous, { id, path: null, organizer: true }]);
    activeTabRef.current = id;
    setActiveTab(id);
    resetDocument();
    setSettings(false);
  };
  const openReleaseHistory = async () => {
    if (!(await saveAll())) return;
    const content = await api.releaseHistory();
    setReleaseHistory(content);
    const existing = tabs.find((tab) => tab.release);
    const id = existing?.id ?? ++tabSequence.current;
    if (!existing)
      setTabs((previous) => [...previous, { id, path: null, release: true }]);
    activeTabRef.current = id;
    setActiveTab(id);
    resetDocument();
    setSettings(false);
  };
  const openBrowser = async () => {
    if (!(await saveAll())) return;
    const id = ++tabSequence.current;
    const url = "";
    setTabs((previous) => [
      ...previous,
      {
        id,
        path: null,
        browser: { id, url, title: browserTitle(url) },
      },
    ]);
    activeTabRef.current = id;
    setActiveTab(id);
    setActivePane("primary");
    setSettings(false);
  };
  const addVault = async () => {
    setVaultSetup("add");
  };
  useEffect(() => {
    const context = (event: MouseEvent) => {
      if (
        !(event.target as HTMLElement).closest(
          "input, textarea, [contenteditable=true], .reading",
        )
      )
        event.preventDefault();
    };
    document.addEventListener("contextmenu", context);
    return () => document.removeEventListener("contextmenu", context);
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.ctrlKey || e.metaKey)) return;
      if (
        inline ||
        dialog ||
        actions ||
        hiddenPanel ||
        vaultSetup ||
        settings ||
        tableInsert ||
        tableMenu ||
        tableActions
      )
        return;
      if (e.key.toLowerCase() === "w") {
        e.preventDefault();
        run(() => (e.shiftKey ? closeAll() : closeTab(activeTab)));
      }
      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        run(() =>
          detached ? returnTab(activeTab) : detachTab(activeTab, false),
        );
      }
      if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        run(async () => {
          await saveAll();
        });
      }
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        if (canCreateNote) showCreate("note");
        else setNotice("Select a vault or folder to create a note.");
      }
      if (e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebar((v) => !v);
      }
      if (e.key.toLowerCase() === "p") {
        e.preventDefault();
        setSidebar(true);
        setBookmarksOpen(false);
        setSearchOpen((open) => {
          if (open) setQuery("");
          else setTimeout(() => searchRef.current?.focus(), 0);
          return !open;
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  const afterRelocate = async (old: string, next: string) => {
    moveNoteAppearance(current.current.root, old, next);
    moveBookmarks(current.current.root, old, next);
    const secondaryPath = secondaryRef.current.doc?.path;
    if (
      secondaryPath &&
      (secondaryPath === old || secondaryPath.startsWith(old + "/"))
    ) {
      const moved = await api.read(next + secondaryPath.slice(old.length));
      secondaryRef.current = { doc: moved, draft: moved.content };
      setSecondaryDoc(moved);
      setSecondaryDraft(moved.content);
    }
    setTabs((previous) =>
      previous.map((tab) =>
        tab.path && (tab.path === old || tab.path.startsWith(old + "/"))
          ? { ...tab, path: next + tab.path.slice(old.length) }
          : tab,
      ),
    );
    const path = current.current.doc?.path;
    if (path && (path === old || path.startsWith(old + "/"))) {
      storage.remove(draftKey(path));
      loadDocument(await api.read(next + path.slice(old.length)));
    }
    setSelected(next);
    setCollapsed(
      (previous) =>
        new Set(
          [...previous].map((path) =>
            path === old || path.startsWith(old + "/")
              ? next + path.slice(old.length)
              : path,
          ),
        ),
    );
    if (!old.includes("/")) setVaultPath(next);
    await refresh();
  };
  const move = async (source: string, parent: string) => {
    setNotice("");
    const before = snapshot;
    const name = source.split("/").at(-1)!;
    const next = parent ? `${parent}/${name}` : name;
    const moveVisible = (entries: Entry[]): Entry[] => {
      let moving: Entry | null = null;
      const remove = (items: Entry[]): Entry[] =>
        items.flatMap((entry) => {
          if (entry.path === source) {
            moving = entry;
            return [];
          }
          return [{ ...entry, children: remove(entry.children) }];
        });
      const without = remove(entries);
      if (!moving) return entries;
      const insert = (items: Entry[]): Entry[] =>
        items.map((entry) =>
          entry.path === parent
            ? {
                ...entry,
                children: [...entry.children, { ...moving!, path: next }],
              }
            : { ...entry, children: insert(entry.children) },
        );
      return insert(without);
    };
    // Move the row immediately. The filesystem operation then confirms or
    // rolls back the optimistic result instead of making the sidebar feel hung.
    setSnapshot((currentSnapshot) => ({
      ...currentSnapshot,
      entries: moveVisible(currentSnapshot.entries),
    }));
    setSelected(next);
    setNotice("Moving…");
    try {
      if (!(await saveAll()))
        throw new Error("Save or recover the draft first.");
      const actual = await api.relocate(source, parent, name);
      await afterRelocate(source, actual);
      setNotice("Moved successfully.");
    } catch (error) {
      setSnapshot(before);
      setSelected(source);
      throw error;
    }
  };
  const reorderNote = async (
    source: string,
    parent: string,
    before: string | null,
  ) => {
    setNotice("");
    if (before === source) return;
    if (!(await saveAll()))
      throw new Error("Save or recover the current draft first.");
    let path = source;
    if (parentOf(source) !== parent) {
      path = await api.relocate(source, parent, source.split("/").at(-1)!);
      await afterRelocate(source, path);
    }
    // A cross-folder move updates organizer metadata in Rust, so always use a
    // fresh snapshot/state before writing the final requested placement.
    const currentOrganizer = await api.organizer();
    // Reordering needs the complete destination listing, never provisional rows.
    await loadDirectory(parent);
    const currentFiles = flatten((await api.snapshot()).entries);
    const siblings = currentFiles
      .filter(
        (entry) => entry.kind === "note" && parentOf(entry.path) === parent,
      )
      .map((entry) => entry.path)
      .filter((entry) => entry !== path);
    const at = before ? siblings.indexOf(before) : -1;
    siblings.splice(at < 0 ? siblings.length : at, 0, path);
    const orders = { ...currentOrganizer.orders, [parent]: siblings };
    setOrganizer(await api.saveOrganizer({ ...currentOrganizer, orders }));
    await refresh();
    setNotice("Note order saved.");
  };
  const resetNoteOrder = async (parent: string) => {
    const orders = { ...organizer.orders };
    delete orders[parent];
    setOrganizer(await api.saveOrganizer({ ...organizer, orders }));
    await refresh();
    setNotice("Note order reset to alphabetical.");
  };
  const commitInline = async () => {
    if (!inline || inlineBusy.current) return;
    let created = false;
    inlineBusy.current = true;
    setWorking(true);
    setDialogError("");
    try {
      if (!(await saveAll())) {
        setDialogError("Save or recover the current draft first.");
        return;
      }
      if (inline.kind === "create") {
        setInline({ ...inline, pendingName: name.trim() });
        const path = await api.create(
          inline.parent,
          inline.entryKind,
          name.trim(),
        );
        created = true;
        // The write has succeeded. Retire the input before refreshing or opening
        // the note; those reads can be slow and must not leave a duplicate name.
        setInline(null);
        await refresh();
        setSelected(path);
        setVaultPath(path.split("/")[0]);
        if (inline.entryKind === "note") {
          await openExtraTab(path);
        }
      } else {
        const next = await api.relocate(
          inline.entry.path,
          parentOf(inline.entry.path),
          name.trim(),
        );
        await afterRelocate(inline.entry.path, next);
        if (actions?.settings && actions.entry.path === inline.entry.path)
          setActions({
            ...actions,
            entry: { ...actions.entry, path: next, name: name.trim() },
          });
      }
      setInline(null);
    } catch (e) {
      if (created) setError(`The item was created, but could not be opened or refreshed: ${String(e)}`);
      else {
        setInline(inline);
        setDialogError(String(e));
      }
    } finally {
      inlineBusy.current = false;
      setWorking(false);
    }
  };
  const forgetPaths = (entry: Entry) => {
    const belongs = (path: string) =>
      path === entry.path || path.startsWith(entry.path + "/");
    if (secondaryRef.current.doc && belongs(secondaryRef.current.doc.path)) {
      secondaryRef.current = { doc: null, draft: "" };
      setSecondaryDoc(null);
      setSecondaryDraft("");
      setSplitView(null);
      setActivePane("primary");
    }
    const remaining = tabs.flatMap((tab) =>
      tab.pinned && tab.path && belongs(tab.path)
        ? [{ ...tab, path: null }]
        : !tab.path || !belongs(tab.path)
          ? [tab]
          : [],
    );
    setTabs(remaining);
    const path = current.current.doc?.path;
    if (path && belongs(path)) {
      storage.remove(draftKey(path));
      resetDocument();
      const next = remaining.find((tab) => tab.path) ?? remaining[0];
      activeTabRef.current = next?.id ?? 0;
      setActiveTab(next?.id ?? 0);
      if (next?.path)
        run(async () => {
          const note = await api.read(next.path!);
          if (!current.current.doc && activeTabRef.current === next.id)
            loadDocument(note);
        });
      storage.remove(`notus-last:${current.current.root}`);
    }
    setSelected(parentOf(entry.path));
  };
  const commitDialog = async () => {
    if (!dialog || working) return;
    setWorking(true);
    setDialogError("");
    try {
      if (!(await saveAll())) {
        setDialogError("Save or recover the current draft first.");
        return;
      }
      await api.remove(dialog.entry.path);
      forgetPaths(dialog.entry);
      await refresh();
      setNotice("Moved to Lotus Trash. Restore it from Settings → Trash.");
      setDialog(null);
    } catch (e) {
      setDialogError(String(e));
    } finally {
      setWorking(false);
    }
  };
  const renameEntry = (entry: Entry) => {
    setBookmarksOpen(false);
    inlineTrigger.current =
      actions?.anchor.trigger ?? (document.activeElement as HTMLElement);
    setActions(null);
    setSidebar(true);
    setQuery("");
    setSelected(entry.path);
    setVaultPath(entry.path.split("/")[0]);
    setCollapsed(
      (previous) =>
        new Set(
          [...previous].filter((path) => !entry.path.startsWith(path + "/")),
        ),
    );
    setName(entry.kind === "note" ? stem(entry.name) : entry.name);
    setDialogError("");
    setInline({ kind: "rename", entry });
  };
  const deleteEntry = (entry: Entry) => {
    setActions(null);
    setDialogError("");
    setDialog({ kind: "delete", entry });
  };
  const updateHidden = (hidden: string[]) => {
    storage.set(`notus-hidden:${current.current.root}`, JSON.stringify(hidden));
    setHiddenVaults(hidden);
  };
  const hideVault = async (entry: Entry) => {
    if (!(await saveAll())) return;
    updateHidden([...hiddenVaults, entry.path]);
    forgetPaths(entry);
    setActions(null);
    setNotice(
      "Vault removed from sidebar. Files are unchanged; restore it from Hidden vaults.",
    );
  };
  const changeRoot = async () => {
    if (!(await saveAll())) throw new Error("Save or recover your open drafts before changing the vaults folder.");
    if (!(await api.chooseRoot())) return;
    current.current.doc = null;
    current.current.draft = "";
    setDoc(null);
    setDraft("");
    secondaryRef.current = { doc: null, draft: "" };
    setSecondaryDoc(null);
    setSecondaryDraft("");
    setSecondaryBrowser(null);
    setSplitView(null);
    setActivePane("primary");
    setError("");
    setStatus("Saved");
    const next = await initializeWorkspace();
    setSnapshot(next);
    setStartupError("");
    setLoading(false);
    current.current.root = next.root;
    let hidden: string[] = [];
    try {
      const saved = JSON.parse(
        storage.get(`notus-hidden:${next.root}`) ?? "[]",
      );
      if (Array.isArray(saved))
        hidden = saved.filter(
          (value): value is string => typeof value === "string",
        );
    } catch {
      /* Ignore malformed UI preferences. */
    }
    setHiddenVaults(hidden);
    activeTabRef.current = detached ? 1 : 0;
    setActiveTab(detached ? 1 : 0);
    setTabs(detached ? [] : [{ id: 0, path: null, pinned: true }]);
    setVaultPath("");
    setInline(null);
    setActions(null);
    setHiddenPanel(null);
    setSelected(next.entries.find((e) => !hidden.includes(e.path))?.path ?? "");
    setCollapsed(new Set());
    expandedFolders.current.clear();
    setOrganizer(await api.organizer());
  };
  const recoverCopy = async () => {
    const state = current.current;
    if (!state.doc) return;
    const old = state.doc.path;
    const path = await api.create(
      parentOf(old),
      "note",
      `${stem(old)} recovered ${Date.now()}`,
    );
    const blank = await api.read(path);
    const next = await api.write(path, state.draft, blank.revision);
    storage.remove(draftKey(old));
    loadDocument(next);
    setSelected(path);
    setError("");
    await refresh();
  };
  const detachTab = async (id: number, atCursor: boolean) => {
    const tab = tabs.find((t) => t.id === id);
    if (!tab?.path || tab.pinned || !(await saveAll())) return;
    if (!(await api.detach(tab.path, atCursor))) return;
    await closeTab(id);
    if (detached && tabs.filter((t) => t.path).length === 1)
      await getCurrentWindow().destroy();
  };
  const finishTabDrag = async (id: number) => {
    const tab = tabs.find((item) => item.id === id);
    if (!tab?.path) return;
    const target = await api.tabDropTarget();
    if (target) {
      await emitTo(windowLabel, "notus-transfer-request", {
        source: windowLabel,
        id,
        path: tab.path,
        target: target.label,
        targetX: target.client_x,
      });
      return;
    }
    await detachTab(id, true);
  };
  const dropTab = async (transfer: TabTransfer, before?: number) => {
    if (transfer.source && transfer.source !== windowLabel) {
      await emitTo(transfer.source, "notus-transfer-request", {
        ...transfer,
        target: windowLabel,
      });
    } else if (transfer.source === windowLabel && transfer.id) {
      if (before === transfer.id) return;
      setTabs((previous) => {
        const moving = previous.find((t) => t.id === transfer.id);
        if (!moving || moving.pinned) return previous;
        const rest = previous.filter((t) => t.id !== transfer.id);
        if (before === 0) before = rest.find((tab) => !tab.pinned)?.id;
        const at = before
          ? rest.findIndex((t) => t.id === before)
          : rest.length;
        rest.splice(Math.max(0, at < 0 ? rest.length : at), 0, moving);
        return rest;
      });
    } else if (transfer.path) {
      if (transfer.targetId === 0) await openCurrentNote(transfer.path);
      else await openExtraTab(transfer.path, false, before);
    }
  };
  const moveTab = (
    id: number,
    targetId: number,
    placement: "before" | "after",
  ) => {
    setTabs((previous) => {
      const moving = previous.find((tab) => tab.id === id);
      const target = previous.find((tab) => tab.id === targetId);
      if (
        !moving ||
        !target ||
        moving.pinned ||
        target.pinned ||
        moving.id === target.id
      )
        return previous;
      // Compute the target index after removing the moving tab. This makes
      // before/after deterministic even for adjacent tabs.
      const rest = previous.filter((tab) => tab.id !== moving.id);
      const targetIndex = rest.findIndex((tab) => tab.id === target.id);
      if (targetIndex < 0) return previous;
      rest.splice(targetIndex + (placement === "after" ? 1 : 0), 0, moving);
      return rest;
    });
  };
  const returnTab = async (id: number) => {
    const tab = tabs.find((t) => t.id === id);
    if (!tab?.path || !(await saveAll())) return;
    if (await api.focusMain(tab.path)) {
      await closeTab(id);
      if (tabs.filter((t) => t.path).length === 1)
        await getCurrentWindow().destroy();
    } else
      await emitTo(windowLabel, "notus-transfer-request", {
        source: windowLabel,
        id,
        path: tab.path,
        target: "main",
      });
  };
  const beforeTabAt = (clientX: number) =>
    tabs.find((tab) => {
      const element = document.querySelector<HTMLElement>(
        `[data-tab-id="${tab.id}"]`,
      );
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      return clientX < rect.left + rect.width / 2;
    })?.id;
  const transferLive = useRef({ openExtraTab, closeTab, tabs, beforeTabAt });
  transferLive.current = { openExtraTab, closeTab, tabs, beforeTabAt };
  useEffect(() => {
    type Transfer = TabTransfer & { target: string };
    const listeners = [
      listen<{ old: string; next: string; source: string }>(
        "notus-path-moved",
        ({ payload }) => {
          if (payload.source === getCurrentWindow().label) return;
          moveNoteAppearance(current.current.root, payload.old, payload.next);
          // Active views block relocation; update inactive tabs in the other windows.
          setTabs((previous) =>
            previous.map((tab) =>
              tab.path &&
              (tab.path === payload.old ||
                tab.path.startsWith(payload.old + "/"))
                ? {
                    ...tab,
                    path: payload.next + tab.path.slice(payload.old.length),
                  }
                : tab,
            ),
          );
          setVaultPath((previous) =>
            previous === payload.old ? payload.next : previous,
          );
        },
      ),
      listen<Transfer>("notus-transfer-request", async ({ payload }) => {
        if (payload.source !== getCurrentWindow().label) return;
        if (!(await live.current.save())) return;
        const tab = transferLive.current.tabs.find(
          (t) => t.id === payload.id && t.path === payload.path,
        );
        if (!tab) return;
        await emitTo(payload.target, "notus-transfer-ready", payload);
      }),
      listen<Transfer>("notus-transfer-ready", async ({ payload }) => {
        if (payload.target !== getCurrentWindow().label) return;
        if (!payload.path) return;
        try {
          await transferLive.current.openExtraTab(
            payload.path,
            true,
            payload.targetX === undefined
              ? undefined
              : transferLive.current.beforeTabAt(payload.targetX),
          );
          await emitTo(payload.source!, "notus-transfer-complete", payload);
        } catch (e) {
          setError(String(e));
        }
      }),
      listen<Transfer>("notus-transfer-complete", async ({ payload }) => {
        if (payload.source !== getCurrentWindow().label) return;
        if (
          !transferLive.current.tabs.some(
            (tab) => tab.id === payload.id && tab.path === payload.path,
          )
        )
          return;
        const only =
          transferLive.current.tabs.filter((t) => t.path).length === 1;
        await transferLive.current.closeTab(payload.id!);
        if (
          getCurrentWindow().label !== "main" &&
          only &&
          (await live.current.save())
        )
          await getCurrentWindow().destroy();
      }),
    ];
    return () => {
      listeners.forEach((p) => void p.then((fn) => fn()));
    };
  }, []);
  const inlineEditor = (
    <InlineName
      value={name}
      error={dialogError}
      working={working}
      onChange={setName}
      onConfirm={() => void commitInline()}
      onCancel={cancelInline}
    />
  );
  const showActions = (entry: Entry, anchor: Anchor) => {
    if (inlineBusy.current) return;
    setInline(null);
    setHiddenPanel(null);
    setActions({ entry, anchor });
  };
  useEffect(() => {
    if (loading || !snapshot.root) return;
    void api
      .registerView(
        doc?.path ?? null,
        secondaryDoc?.path ? [secondaryDoc.path] : [],
      )
      .catch((e) => setError(String(e)));
  }, [doc?.path, secondaryDoc?.path, loading, snapshot.root]);

  useEffect(() => {
    const width = (event: Event) => {
      const e = event as CustomEvent<{ index: number; widths: number[] }>;
      if ((event.target as HTMLElement).closest(".secondary-pane"))
        setSecondaryAppearance({
          widths: {
            ...secondaryAppearance.widths,
            [e.detail.index]: e.detail.widths,
          },
        });
      else
        setAppearance({
          widths: { ...appearance.widths, [e.detail.index]: e.detail.widths },
        });
    };
    const link = (event: Event) =>
      run(() => openLink((event as CustomEvent<string>).detail));
    const click = (event: MouseEvent) => {
      const el = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-note-href]",
      );
      if (el && event.button === 0 && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        event.stopPropagation();
        run(() =>
          openLink(
            el.dataset.noteHref!,
            el.closest(".secondary-pane") ? "secondary" : "primary",
          ),
        );
      }
    };
    window.addEventListener("notus-table-widths", width);
    window.addEventListener("lotus-open-link", link);
    window.addEventListener("pointerdown", click, true);
    return () => {
      window.removeEventListener("notus-table-widths", width);
      window.removeEventListener("lotus-open-link", link);
      window.removeEventListener("pointerdown", click, true);
    };
  });

  return (
    <div
      className={`shell ${sidebar && !detached ? "" : "collapsed"} ${detached ? "detached-shell" : ""}`}
      style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
    >
      <a className="skip-link" href="#editor-workspace">
        Skip to workspace
      </a>
      <TitleBar
        settings={() => setSettings(true)}
        browser={() => run(openBrowser)}
        split={(button) => setSplitMenu(anchorAt(button))}
        tabContext={(id, e) =>
          setTabMenu({
            id,
            anchor: {
              ...anchorAt(e.currentTarget as HTMLElement),
              x: e.clientX,
              y: e.clientY,
            },
          })
        }
        sidebar={sidebar}
        toggleSidebar={() => {
          setSidebar((v) => !v);
          setActions(null);
          setHiddenPanel(null);
          if (!inlineBusy.current) setInline(null);
        }}
        tabs={tabs}
        active={activeTab}
        selectTab={(id) => run(() => selectTab(id))}
        closeTab={(id) => run(() => closeTab(id))}
        moveTab={moveTab}
        dropTab={(transfer, before) => run(() => dropTab(transfer, before))}
        finishTabDrag={(id) => run(() => finishTabDrag(id))}
        theme={theme}
        toggleTheme={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
        onError={setError}
        compact={detached}
      />
      {sidebar && !detached && (
        <aside className="sidebar">
          <div
            className="sidebar-resizer"
            role="separator"
            aria-label="Resize sidebar"
            aria-orientation="vertical"
            aria-valuemin={220}
            aria-valuemax={480}
            aria-valuenow={sidebarWidth}
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                return;
              event.preventDefault();
              setSidebarWidth((width) =>
                Math.min(
                  480,
                  Math.max(
                    220,
                    width + (event.key === "ArrowRight" ? 12 : -12),
                  ),
                ),
              );
            }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              const move = (next: PointerEvent) =>
                setSidebarWidth(Math.min(480, Math.max(220, next.clientX)));
              const stop = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", stop);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", stop);
            }}
          />
          <nav className="sidebar-navigation" aria-label="Sidebar sections">
            <button
              className="icon"
              title="Files"
              aria-label="Files"
              aria-pressed={!searchOpen && !bookmarksOpen && !organizerActive}
              onClick={() => {
                setSearchOpen(false);
                setBookmarksOpen(false);
                if (organizerActive) {
                  const tab = tabs.find((t) => t.path);
                  if (tab) run(() => selectTab(tab.id));
                }
              }}
            >
              <FolderOpen size={18} />
            </button>
            <button
              className="icon"
              title="Search (Ctrl+P)"
              aria-label="Find a note (Ctrl+P)"
              aria-pressed={searchOpen}
              onClick={() => {
                setBookmarksOpen(false);
                setSearchOpen(true);
                setTimeout(() => searchRef.current?.focus(), 0);
              }}
            >
              <Search size={18} />
            </button>
            <button
              className="icon"
              title="Bookmarks"
              aria-label="Bookmarks"
              aria-pressed={bookmarksOpen}
              onClick={() => {
                setSearchOpen(false);
                setBookmarksOpen(true);
              }}
            >
              <Bookmark size={18} />
            </button>
            <button
              className="icon"
              title="Organize workspace"
              aria-label="Organize workspace"
              aria-pressed={organizerActive}
              onClick={() => run(openOrganizer)}
            >
              <FolderTree size={18} />
            </button>
            <button
              className="icon"
              title={
                collapsed.size ? "Expand all folders" : "Collapse all folders"
              }
              aria-label={
                collapsed.size ? "Expand all folders" : "Collapse all folders"
              }
              aria-pressed={collapsed.size > 0}
              onClick={() => {
                if (collapsed.size) {
                  setCollapsed(new Set());
                  return;
                }
                setCollapsed(
                  new Set(
                    flatten(activeVault?.children ?? [])
                      .filter((entry) => entry.kind === "folder")
                      .map((entry) => entry.path),
                  ),
                );
              }}
            >
              <ChevronsUpDown size={18} />
            </button>
          </nav>
          <div className="files-toolbar">
            <span>
              {searchOpen ? "Search" : bookmarksOpen ? "Bookmarks" : "Files"}
            </span>
            <CreateMenu
              disabled={!activeVault || bookmarksOpen || searchOpen}
              create={(kind) =>
                activeVault && showCreate(kind, kind === "folder" ? activeVault.path : folder)
              }
            />
          </div>

          {searchOpen && (
            <label className="search-box">
              <Search size={16} />
              <input
                ref={searchRef}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setSearchOpen(false);
                    setQuery("");
                    document
                      .querySelector<HTMLElement>(
                        '[aria-label="Find a note (Ctrl+P)"]',
                      )
                      ?.focus();
                  }
                }}
                aria-label="Find a note or folder"
                placeholder="Find a note or folder…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                className="icon"
                aria-label="Close search"
                onClick={() => {
                  setSearchOpen(false);
                  setQuery("");
                }}
              >
                <X size={14} />
              </button>
            </label>
          )}
          <nav
            className={`file-tree ${externalDropTarget === activeVault?.path ? "drop-target" : ""}`}
            aria-label="Vaults and notes"
            data-vault-drop={
              !searchOpen && !bookmarksOpen ? activeVault?.path : undefined
            }
            data-path={
              !searchOpen && !bookmarksOpen ? activeVault?.path : undefined
            }
            data-kind={!searchOpen && !bookmarksOpen ? "vault" : undefined}
          >
            {bookmarksOpen ? (
              <div className="bookmarks-list">
                {flatten(snapshot.entries)
                  .filter(
                    (e) =>
                      e.kind === "note" && bookmarks.includes(e.path) && true,
                  )
                  .map((e) => (
                    <button
                      key={e.path}
                      title={e.path}
                      onClick={() => run(() => openNote(e.path))}
                    >
                      {stem(e.path)}
                      <small>{parentOf(e.path)}</small>
                    </button>
                  ))}
                {!bookmarks.length && (
                  <p className="muted">
                    Bookmark a note using the icon beside its lock.
                  </p>
                )}
              </div>
            ) : searchOpen ? (
              query.trim() ? (
                <NoteSearch
                  query={query}
                  open={(path) => run(() => openNote(path))}
                />
              ) : (
                <p className="muted search-empty">
                  Search note names and contents across your workspace.
                </p>
              )
            ) : (
              <div
                className="sidebar-tree-root"
                onContextMenu={(event) => {
                  if (
                    !activeVault ||
                    (event.target as HTMLElement).closest(".tree-row")
                  )
                    return;
                  event.preventDefault();
                  setActions({
                    entry: activeVault,
                    anchor: {
                      ...anchorAt(event.currentTarget),
                      x: event.clientX,
                      y: event.clientY,
                    },
                  });
                }}
              >
                <SidebarTree
                  entries={activeVault?.children ?? []}
                  parent={activeVault?.path ?? ""}
                  selected={selected}
                  collapsed={collapsed}
                  query=""
                  onToggle={(path) =>
                    setCollapsed((current) => {
                      const next = new Set(current);
                      if (next.has(path)) next.delete(path);
                      else next.add(path);
                      return next;
                    })
                  }
                  onSelect={(entry) => {
                    if (entry.kind === "note") run(() => openNote(entry.path));
                    else setSelected(entry.path);
                  }}
                  onMove={(source, parent) => run(() => move(source, parent))}
                  onReorder={(source, parent, before) =>
                    run(() => reorderNote(source, parent, before))
                  }
                  externalDropTarget={externalDropTarget}
                  onActions={showActions}
                  inline={
                    inline?.kind === "create" && inline.entryKind === "vault"
                      ? null
                      : inline
                  }
                  editor={inlineEditor}
                />
              </div>
            )}
            {inline?.kind === "create" && inline.entryKind === "vault" && (
              <div className="new-vault-inline">{inlineEditor}</div>
            )}
            {inline?.kind === "rename" &&
              inline.entry.kind === "vault" &&
              !actions?.settings && (
                <div className="new-vault-inline">{inlineEditor}</div>
              )}
            {!visibleEntries.length &&
              !loading &&
              directoryStatus("").state === "loaded" &&
              !inline && (
                <div className="sidebar-empty">
                  <p>No vaults yet.</p>
                  <button onClick={() => showCreate("vault")}>
                    <Plus size={15} />
                    Create your first vault
                  </button>
                </div>
              )}
          </nav>
          <footer className="sidebar-footer">
            <VaultSwitcher
              entries={visibleEntries}
              active={activeVault}
              state={organizer}
              choose={(path) => {
                setVaultPath(path);
                setSelected(path);
                setQuery("");
                setInline(null);
              }}
              create={() => showCreate("vault")}
              add={addVault}
              actions={(entry, anchor) =>
                setActions({ entry, anchor, settings: true })
              }
            />

            {hiddenVaults.length > 0 && (
              <button
                className="hidden-vaults-button"
                onClick={(event) => {
                  setActions(null);
                  setHiddenPanel(anchorAt(event.currentTarget));
                }}
              >
                <EyeOff size={15} />
                Hidden vaults ({hiddenVaults.length})
              </button>
            )}
          </footer>
        </aside>
      )}
      <section className="workspace">
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            {doc && (
              <button onClick={() => run(recoverCopy)}>
                Save recovery copy
              </button>
            )}
            <Icon label="Dismiss error" onClick={() => setError("")}>
              <X size={15} />
            </Icon>
          </div>
        )}
        {watcherError && (
          <div role="alert" className="error-banner">
            File watching stopped: {watcherError}{" "}
            <button
              onClick={() => {
                setWatcherError("");
                void api.retryWatcher();
              }}
            >
              Retry watching
            </button>
          </div>
        )}
        {snapshot.root &&
          (() => {
            const path = vaultPath || "";
            const state = directoryStatus(path);
            const age = state.started ? Date.now() - state.started : 0;
            void directoryTick;
            return state.state === "failed" ||
              (state.state === "loading" && age >= 3000) ? (
              <div role="status" className="error-banner">
                {state.error || "Updating files…"}
                {(state.state === "failed" || age >= 10000) && (
                  <button
                    onClick={() =>
                      void loadDirectory(path, false, true).catch(() => {})
                    }
                  >
                    Retry
                  </button>
                )}
              </div>
            ) : null;
          })()}
        <main id="editor-workspace" tabIndex={-1}>
          {loading || (!snapshot.root && !detached) ? (
            <div className="empty-note" role="status">
              <p>
                {startupError ||
                  (startupAge >= 3000
                    ? "Opening your workspace is taking longer than usual…"
                    : "Opening workspace…")}
              </p>
              {(startupError || startupAge >= 10000) && (
                <div>
                  <button
                    onClick={() => {
                      resetWorkspace();
                      setStartupAttempt((value) => value + 1);
                    }}
                  >
                    Retry
                  </button>
                  <button onClick={() => run(changeRoot)}>
                    Choose workspace
                  </button>
                </div>
              )}
            </div>
          ) : organizerActive && !snapshot.complete ? (
            <div className="empty-note" role="status">
              Loading workspace details…{" "}
              <button
                onClick={() =>
                  run(async () => {
                    await api.snapshot(true);
                  })
                }
              >
                Retry
              </button>
            </div>
          ) : organizerActive ? (
            <Suspense
              fallback={
                <div className="empty-note">
                  <p>Opening workspace…</p>
                </div>
              }
            >
              <WorkspaceOrganizer
                entries={snapshot.entries}
                createVault={() => showCreate("vault")}
                state={organizer}
                update={async (value) => {
                  setOrganizer(await api.saveOrganizer(value));
                }}
                move={move}
                open={openNote}
                actions={showActions}
              />
            </Suspense>
          ) : releaseActive ? (
            <section className="note-view release-history-view">
              <div
                className="document-scroll primary-pane"
                style={
                  {
                    "--note-font-size": `${fontSize}px`,
                    "--note-font-weight": fontWeight,
                    "--note-text-align": appearance.alignment,
                    "--note-font-family": `"${fontFamily}", sans-serif`,
                  } as React.CSSProperties
                }
              >
                <Suspense
                  fallback={
                    <div className="empty-note">
                      <p>Loading release history…</p>
                    </div>
                  }
                >
                  <MarkdownView
                    content={releaseHistory}
                    identity="lotus-release-history"
                    appearance={appearance}
                    openLink={(href) => run(() => openLink(href))}
                  />
                </Suspense>
              </div>
            </section>
          ) : browserActive && !splitView ? (
            <section className="note-view browser-note-view">
              <BrowserPane
                browser={browserActive}
                onError={setError}
                onClose={() =>
                  run(() => closeBrowserPane(browserActive.id, "primary"))
                }
                onAddress={(url) =>
                  setTabs((previous) =>
                    previous.map((tab) =>
                      tab.browser?.id === browserActive.id
                        ? {
                            ...tab,
                            browser: {
                              ...tab.browser,
                              url,
                              title: browserTitle(url),
                            },
                          }
                        : tab,
                    ),
                  )
                }
              />
            </section>
          ) : doc ? (
            <section className="note-view">
              <div className="note-ai-layout">
                <div
                  className={`editor-panes ${splitView ? `split-${splitView}` : ""}`}
                  style={
                    { "--pane-ratio": splitRatio / 100 } as React.CSSProperties
                  }
                >
                  <section
                    className={`primary-pane-wrap ${activePane === "primary" ? "pane-active" : ""}`}
                    aria-label="First note pane"
                    data-lotus-drop="primary-pane"
                    onFocusCapture={() => setActivePane("primary")}
                    onPointerDown={(e) => {
                      setActivePane("primary");
                      editorView.current?.dom.classList.toggle(
                        "table-interacting",
                        !!(e.target as HTMLElement).closest(".editable-table"),
                      );
                    }}
                  >
                    {primaryBrowser ? (
                      <BrowserPane
                        browser={browserActive!}
                        onError={setError}
                        onClose={() =>
                          run(() =>
                            closeBrowserPane(browserActive!.id, "primary"),
                          )
                        }
                        onAddress={(url) =>
                          setTabs((previous) =>
                            previous.map((tab) =>
                              tab.browser?.id === browserActive!.id
                                ? {
                                    ...tab,
                                    browser: {
                                      ...tab.browser,
                                      url,
                                      title: browserTitle(url),
                                    },
                                  }
                                : tab,
                            ),
                          )
                        }
                      />
                    ) : (
                      <>
                        <NoteHeader
                          note={doc}
                          status={status}
                          bookmarked={bookmarks.includes(doc.path)}
                          bookmark={() => toggleBookmark(doc.path)}
                          lock={() => run(() => toggleLock("primary"))}
                          appearance={(anchor) => {
                            setTextPane("primary");
                            setTextPanel(anchor);
                          }}
                          undo={() => {
                            if (editorView.current) undo(editorView.current);
                          }}
                          canUndo={
                            !!editorView.current &&
                            undoDepth(editorView.current.state) > 0
                          }
                          drop={(path) => run(() => openCurrentNote(path))}
                          dropTarget="primary-pane"
                          rename={(name) => renameNote(doc.path, name)}
                          ai={() => {
                            setAiPane("primary");
                            preserveNotePosition(
                              [editorView.current, secondaryEditor.current],
                              () => setAiOpen(true),
                            );
                          }}
                          close={
                            splitView ? () => run(closePrimaryPane) : undefined
                          }
                        />
                        <div
                          className="document-scroll primary-pane"
                          onFocusCapture={() => setActivePane("primary")}
                          onPointerDown={() => setActivePane("primary")}
                          onDragOver={(e) => {
                            if (e.dataTransfer.types.includes("notus-note"))
                              e.preventDefault();
                          }}
                          onDrop={(e) => {
                            const path =
                              e.dataTransfer.getData("text/notus-path");
                            if (path) {
                              e.preventDefault();
                              run(() => openExtraTab(path));
                            }
                          }}
                          onContextMenu={(e) => {
                            if (
                              (e.target as HTMLElement).closest(
                                ".diagram-widget",
                              )
                            )
                              return;
                            if (doc.locked) {
                              e.preventDefault();
                              menuPane.current = "primary";
                              menuTarget.current = readTarget(e.currentTarget);
                              setTableMenu({
                                anchor: {
                                  ...anchorAt(e.currentTarget),
                                  x: e.clientX,
                                  y: e.clientY,
                                },
                                position: 0,
                                path: doc.path,
                              });
                              return;
                            }
                            if (
                              !editorView.current ||
                              !(e.target as HTMLElement).closest(".cm-editor")
                            )
                              return;
                            e.preventDefault();
                            const view = editorView.current;
                            menuPane.current = "primary";
                            const pos =
                              view.posAtCoords({
                                x: e.clientX,
                                y: e.clientY,
                              }) ?? view.state.selection.main.head;
                            const selection = view.state.selection.main;
                            if (pos < selection.from || pos > selection.to)
                              view.dispatch({ selection: { anchor: pos } });
                            menuTarget.current = codeTarget(view);
                            setTableMenu({
                              anchor: {
                                ...anchorAt(e.currentTarget),
                                x: e.clientX,
                                y: e.clientY,
                              },
                              position: view.state.doc.lineAt(pos).to,
                              path: doc.path,
                            });
                          }}
                          style={
                            {
                              "--note-font-size": `${fontSize}px`,
                              "--note-font-weight": fontWeight,
                              "--note-text-align": appearance.alignment,
                              "--note-content-width":
                                appearance.textWidth === "wide"
                                  ? "1147.5px"
                                  : "850px",
                              "--note-font-family": `"${fontFamily}", sans-serif`,
                            } as React.CSSProperties
                          }
                        >
                          <PropertiesPanel
                            key={`properties:${doc.path}`}
                            content={draft}
                            locked={doc.locked}
                            onChange={edit}
                          />
                          {!doc.locked ? (
                            <Suspense
                              fallback={
                                <div
                                  className="reading-loading"
                                  aria-live="polite"
                                >
                                  Preparing editor…
                                </div>
                              }
                            >
                              <NoteEditor
                                path={doc.path}
                                value={splitFrontmatter(draft).body}
                                theme={theme}
                                identity={`${snapshot.root}:${doc.path}`}
                                appearance={appearance as NoteEditorAppearance}
                                onCreateEditor={(view) => {
                                  performance.mark("lotus-note-editable");
                                  editorView.current = view;
                                  const saved = viewPositions.current.get(
                                    doc.path,
                                  );
                                  if (saved)
                                    view.dispatch({
                                      selection: {
                                        anchor: Math.min(
                                          saved.anchor,
                                          view.state.doc.length,
                                        ),
                                        head: Math.min(
                                          saved.head,
                                          view.state.doc.length,
                                        ),
                                      },
                                    });
                                }}
                                onChange={(body) => {
                                  const parsed = splitFrontmatter(draft);
                                  edit(
                                    draft.slice(
                                      0,
                                      draft.length - parsed.body.length,
                                    ) + body,
                                  );
                                }}
                              />
                            </Suspense>
                          ) : (
                            <Suspense
                              fallback={
                                <div
                                  className="reading-loading"
                                  aria-live="polite"
                                >
                                  Preparing preview…
                                </div>
                              }
                            >
                              <MarkdownView
                                content={splitFrontmatter(draft).body}
                                identity={`${snapshot.root}:${doc?.path}`}
                                appearance={appearance}
                                openLink={(href) => run(() => openLink(href))}
                              />
                            </Suspense>
                          )}
                        </div>
                      </>
                    )}
                  </section>
                  {splitView && (secondaryNote || secondaryBrowser) && (
                    <>
                      <div
                        className="pane-divider"
                        role="separator"
                        aria-label="Resize split panes"
                        aria-orientation={
                          splitView === "right" ? "vertical" : "horizontal"
                        }
                        aria-valuenow={splitRatio}
                        aria-valuemin={20}
                        aria-valuemax={80}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (
                            [
                              "ArrowLeft",
                              "ArrowUp",
                              "ArrowRight",
                              "ArrowDown",
                            ].includes(e.key)
                          ) {
                            e.preventDefault();
                            setSplitRatio((r) =>
                              Math.max(
                                20,
                                Math.min(
                                  80,
                                  r +
                                    (["ArrowLeft", "ArrowUp"].includes(e.key)
                                      ? -5
                                      : 5),
                                ),
                              ),
                            );
                          }
                        }}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          const divider = e.currentTarget;
                          divider.setPointerCapture(e.pointerId);
                          const rect =
                            divider.parentElement!.getBoundingClientRect();
                          const move = (ev: PointerEvent) =>
                            setSplitRatio(
                              Math.max(
                                20,
                                Math.min(
                                  80,
                                  100 *
                                    (splitView === "right"
                                      ? (ev.clientX - rect.left) / rect.width
                                      : (ev.clientY - rect.top) / rect.height),
                                ),
                              ),
                            );
                          const stop = () => {
                            divider.removeEventListener("pointermove", move);
                            divider.removeEventListener("pointerup", stop);
                            divider.removeEventListener("pointercancel", stop);
                          };
                          divider.addEventListener("pointermove", move);
                          divider.addEventListener("pointerup", stop);
                          divider.addEventListener("pointercancel", stop);
                        }}
                      />
                      <section
                        className={`secondary-pane-wrap ${activePane === "secondary" ? "pane-active" : ""}`}
                        aria-label="Second note pane"
                        data-lotus-drop="secondary-pane"
                        onFocusCapture={() => setActivePane("secondary")}
                        onPointerDown={(e) => {
                          setActivePane("secondary");
                          secondaryEditor.current?.dom.classList.toggle(
                            "table-interacting",
                            !!(e.target as HTMLElement).closest(
                              ".editable-table",
                            ),
                          );
                        }}
                        onDragOver={(e) => {
                          if (e.dataTransfer.types.includes("notus-note")) {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "copy";
                          }
                        }}
                        onDrop={(e) => {
                          const path =
                            e.dataTransfer.getData("text/notus-path");
                          if (path) {
                            e.preventDefault();
                            run(() => openSecondary(path));
                          }
                        }}
                      >
                        {secondaryBrowser ? (
                          <BrowserPane
                            browser={secondaryBrowser}
                            onError={setError}
                            onClose={() =>
                              run(() =>
                                closeBrowserPane(
                                  secondaryBrowser.id,
                                  "secondary",
                                ),
                              )
                            }
                            onAddress={(url) => {
                              const updated = {
                                ...secondaryBrowser,
                                url,
                                title: browserTitle(url),
                              };
                              setSecondaryBrowser(updated);
                              setTabs((previous) =>
                                previous.map((tab) =>
                                  tab.browser?.id === updated.id
                                    ? { ...tab, browser: updated }
                                    : tab,
                                ),
                              );
                            }}
                          />
                        ) : (
                          secondaryNote && (
                            <>
                              <NoteHeader
                                note={secondaryNote}
                                status={
                                  secondaryNote.path === doc.path
                                    ? status
                                    : secondaryValue === secondaryNote.content
                                      ? "Saved"
                                      : secondarySaveError
                                        ? "Save failed"
                                        : "Unsaved draft"
                                }
                                bookmarked={bookmarks.includes(
                                  secondaryNote.path,
                                )}
                                bookmark={() =>
                                  toggleBookmark(secondaryNote.path)
                                }
                                lock={() => run(() => toggleLock("secondary"))}
                                appearance={(anchor) => {
                                  setTextPane("secondary");
                                  setTextPanel(anchor);
                                }}
                                undo={() => {
                                  if (secondaryEditor.current)
                                    undo(secondaryEditor.current);
                                }}
                                canUndo={
                                  !!secondaryEditor.current &&
                                  undoDepth(secondaryEditor.current.state) > 0
                                }
                                drop={(path) => run(() => openSecondary(path))}
                                dropTarget="secondary-pane"
                                rename={(name) =>
                                  renameNote(secondaryNote.path, name)
                                }
                                ai={() => {
                                  setAiPane("secondary");
                                  preserveNotePosition(
                                    [
                                      editorView.current,
                                      secondaryEditor.current,
                                    ],
                                    () => setAiOpen(true),
                                  );
                                }}
                                close={() => run(closeSplit)}
                              />
                              <div
                                className="document-scroll secondary-pane"
                                style={
                                  {
                                    "--note-font-size": `${fontSize}px`,
                                    "--note-font-weight": fontWeight,
                                    "--note-text-align":
                                      secondaryAppearance.alignment,
                                    "--note-content-width":
                                      secondaryAppearance.textWidth === "wide"
                                        ? "1147.5px"
                                        : "850px",
                                    "--note-font-family": `"${fontFamily}", sans-serif`,
                                  } as React.CSSProperties
                                }
                                onContextMenu={(e) => {
                                  if (
                                    (e.target as HTMLElement).closest(
                                      ".editable-table, .diagram-widget",
                                    )
                                  )
                                    return;
                                  e.preventDefault();
                                  menuPane.current = "secondary";
                                  const view = secondaryEditor.current;
                                  if (view && !secondaryNote.locked) {
                                    const pos =
                                      view.posAtCoords({
                                        x: e.clientX,
                                        y: e.clientY,
                                      }) ?? view.state.selection.main.head;
                                    const sel = view.state.selection.main;
                                    if (pos < sel.from || pos > sel.to)
                                      view.dispatch({
                                        selection: { anchor: pos },
                                      });
                                    menuTarget.current = codeTarget(view);
                                  } else
                                    menuTarget.current = readTarget(
                                      e.currentTarget,
                                    );
                                  setTableMenu({
                                    anchor: {
                                      ...anchorAt(e.currentTarget),
                                      x: e.clientX,
                                      y: e.clientY,
                                    },
                                    position:
                                      view?.state.selection.main.head ?? 0,
                                    path: secondaryNote.path,
                                  });
                                }}
                              >
                                <PropertiesPanel
                                  key={`properties:${secondaryNote.path}`}
                                  content={secondaryValue}
                                  locked={secondaryNote.locked}
                                  onChange={editSecondary}
                                />
                                {!secondaryNote.locked ? (
                                  <Suspense
                                    fallback={
                                      <div
                                        className="reading-loading"
                                        aria-live="polite"
                                      >
                                        Preparing editor…
                                      </div>
                                    }
                                  >
                                    <NoteEditor
                                      path={secondaryNote.path}
                                      value={
                                        splitFrontmatter(secondaryValue).body
                                      }
                                      theme={theme}
                                      identity={`${snapshot.root}:${secondaryNote.path}`}
                                      appearance={
                                        secondaryAppearance as NoteEditorAppearance
                                      }
                                      onCreateEditor={(view) => {
                                        performance.mark("lotus-note-editable");
                                        secondaryEditor.current = view;
                                      }}
                                      onChange={(body) => {
                                        const value =
                                          secondaryRef.current.doc?.path ===
                                          current.current.doc?.path
                                            ? current.current.draft
                                            : secondaryRef.current.draft;
                                        const parsed = splitFrontmatter(value);
                                        editSecondary(
                                          value.slice(
                                            0,
                                            value.length - parsed.body.length,
                                          ) + body,
                                        );
                                      }}
                                    />
                                  </Suspense>
                                ) : (
                                  <Suspense
                                    fallback={
                                      <div
                                        className="reading-loading"
                                        aria-live="polite"
                                      >
                                        Preparing preview…
                                      </div>
                                    }
                                  >
                                    <MarkdownView
                                      content={
                                        splitFrontmatter(secondaryValue).body
                                      }
                                      identity={`${snapshot.root}:${secondaryDoc?.path}`}
                                      appearance={secondaryAppearance}
                                      openLink={(href) =>
                                        run(() => openLink(href))
                                      }
                                    />
                                  </Suspense>
                                )}
                              </div>
                            </>
                          )
                        )}
                      </section>
                    </>
                  )}
                </div>
                {aiMounted && (
                  <FeatureBoundary>
                    <Suspense fallback={<p role="status">Opening chat…</p>}>
                      <AIChat
                        open={aiOpen}
                        close={() => {
                          preserveNotePosition(
                            [editorView.current, secondaryEditor.current],
                            () => setAiOpen(false),
                          );
                        }}
                        settings={() => {
                          setAiSettings(true);
                          setSettings(true);
                        }}
                        noteName={
                          (aiPane === "primary"
                            ? doc?.path
                            : secondaryDoc?.path) ?? "No note"
                        }
                        capture={() => {
                          const state =
                            aiPane === "primary"
                              ? current.current
                              : secondaryRef.current;
                          if (!state.doc) return null;
                          const value =
                            state.doc.path === current.current.doc?.path
                              ? current.current.draft
                              : state.draft;
                          const body = splitFrontmatter(value).body;
                          const view =
                            aiPane === "primary"
                              ? editorView.current
                              : secondaryEditor.current;
                          const selection = view?.state.selection.main;
                          return {
                            root: latestSnapshot.current.root,
                            path: state.doc.path,
                            original: value,
                            body,
                            from: selection?.from ?? 0,
                            to: selection?.to ?? 0,
                            locked: state.doc.locked,
                            pane: aiPane,
                          };
                        }}
                        apply={async (
                          note: NoteContext,
                          replacement: string,
                        ) => {
                          const valid = () => {
                            const state =
                              note.pane === "primary"
                                ? current.current
                                : secondaryRef.current;
                            const value =
                              state.doc?.path === current.current.doc?.path
                                ? current.current.draft
                                : state.draft;
                            if (
                              latestSnapshot.current.root !== note.root ||
                              state.doc?.path !== note.path ||
                              value !== note.original ||
                              state.doc.locked
                            )
                              throw new Error(
                                "This note changed, was locked, or is no longer open. Request a fresh edit; nothing was replaced.",
                              );
                            return state.doc;
                          };
                          valid();
                          const disk = await api.read(note.path);
                          const liveDoc = valid();
                          if (disk.locked || disk.revision !== liveDoc.revision)
                            throw new Error(
                              "The file changed on disk. Refresh it before requesting another edit.",
                            );
                          const view =
                            note.pane === "primary"
                              ? editorView.current
                              : secondaryEditor.current;
                          if (!view || view.state.doc.toString() !== note.body)
                            throw new Error(
                              "The editor changed. Request a fresh edit.",
                            );
                          const change = minimalChange(
                            note.body,
                            editedBody(note, replacement),
                          );
                          codeTarget(view).replace(
                            change.from,
                            change.to,
                            change.insert,
                          );
                        }}
                      />
                    </Suspense>
                  </FeatureBoundary>
                )}
              </div>
              <footer className="note-footer">
                <span>
                  {draft.trim() ? draft.trim().split(/\s+/).length : 0} words
                </span>
                <span>Markdown · UTF-8</span>
              </footer>
            </section>
          ) : null}
        </main>
      </section>
      {(tableActions || tableMenu) && (
        <ContextMenu
          anchor={
            tableActions
              ? {
                  x: tableActions.x,
                  y: tableActions.y,
                  trigger: tableActions.trigger,
                }
              : tableMenu!.anchor
          }
          label={tableActions ? "Table actions" : "Note actions"}
          onClose={() => {
            setTableActions(null);
            setTableMenu(null);
          }}
          items={[
            ...(tableActions
              ? [
                  ...tableActions.actions.filter(
                    (a) => a.label === "Fit to note width",
                  ),
                  {
                    label: "Rows",
                    children: tableActions.actions.filter((a) =>
                      a.label.toLowerCase().includes("row"),
                    ),
                  },
                  {
                    label: "Columns",
                    children: tableActions.actions.filter(
                      (a) =>
                        a.label.toLowerCase().includes("column") &&
                        !a.label.startsWith("Align"),
                    ),
                  },
                  {
                    label: "Column alignment",
                    children: tableActions.actions.filter((a) =>
                      a.label.startsWith("Align"),
                    ),
                  },
                  {
                    label: (menuPane.current === "secondary"
                      ? secondaryAppearance
                      : appearance
                    ).highlights.includes(tableActions.index)
                      ? "Remove first column highlight"
                      : "Highlight first column",
                    run: () => {
                      const value =
                        menuPane.current === "secondary"
                          ? secondaryAppearance
                          : appearance;
                      const update =
                        menuPane.current === "secondary"
                          ? setSecondaryAppearance
                          : setAppearance;
                      update({
                        highlights: value.highlights.includes(
                          tableActions.index,
                        )
                          ? value.highlights.filter(
                              (i) => i !== tableActions.index,
                            )
                          : [...value.highlights, tableActions.index],
                      });
                    },
                  },
                ]
              : []),
            ...editorItems(tableActions?.target ?? menuTarget.current, {
              locked:
                (menuPane.current === "secondary"
                  ? secondaryDoc?.locked
                  : doc?.locked) ?? true,
              lock: () => run(() => toggleLock(menuPane.current)),
              bookmarked: bookmarks.includes(
                (menuPane.current === "secondary"
                  ? secondaryDoc?.path
                  : doc?.path) || "",
              ),
              bookmark: () => {
                const path =
                  menuPane.current === "secondary"
                    ? secondaryDoc?.path
                    : doc?.path;
                if (path) toggleBookmark(path);
              },
              link: () => {
                const target = tableActions?.target ?? menuTarget.current;
                if (target) showLink(target);
              },
              table: () => {
                if (tableMenu) setTableInsert(tableMenu);
              },
              search: (text) => {
                setQuery(text);
                setSidebar(true);
                setSearchOpen(true);
                setTimeout(() => searchRef.current?.focus(), 0);
              },
              error: setError,
            }),
          ]}
        />
      )}
      {linkDialog && (
        <Modal title="Add or edit link" onClose={() => setLinkDialog(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const { target, label, url } = linkDialog;
              if (!label.trim() || !url.trim()) return;
              target.replace(
                target.from,
                target.to,
                "[" +
                  label.replaceAll("]", "\\]") +
                  "](" +
                  url.replaceAll(" ", "%20").replaceAll(")", "%29") +
                  ")",
              );
              setLinkDialog(null);
            }}
          >
            <label>
              Display text
              <input
                required
                value={linkDialog.label}
                onChange={(e) =>
                  setLinkDialog({ ...linkDialog, label: e.target.value })
                }
              />
            </label>
            <label>
              Website or note path
              <input
                required
                value={linkDialog.url}
                placeholder="https://…"
                onChange={(e) =>
                  setLinkDialog({ ...linkDialog, url: e.target.value })
                }
              />
            </label>
            <label>
              Find a note
              <input
                value={linkDialog.query}
                onChange={(e) =>
                  setLinkDialog({ ...linkDialog, query: e.target.value })
                }
              />
            </label>
            {!snapshot.complete && (
              <p role="status">Loading note suggestions…</p>
            )}
            <div className="link-note-options">
              {files
                .filter(
                  (e) =>
                    e.kind === "note" &&
                    e.path
                      .toLowerCase()
                      .includes(linkDialog.query.toLowerCase()),
                )
                .slice(0, 40)
                .map((note) => (
                  <button
                    type="button"
                    key={note.path}
                    onClick={() =>
                      setLinkDialog({
                        ...linkDialog,
                        url: relativeNoteLink(
                          (menuPane.current === "secondary"
                            ? secondaryDoc?.path
                            : doc?.path) ?? "",
                          note.path,
                        ),
                        label: linkDialog.label || stem(note.path),
                      })
                    }
                  >
                    {stem(note.path)}
                    <small>{parentOf(note.path)}</small>
                  </button>
                ))}
            </div>
            <footer className="link-dialog-footer">
              <button className="primary">Save link</button>
            </footer>
          </form>
        </Modal>
      )}
      {splitMenu && (
        <ContextMenu
          anchor={splitMenu}
          onClose={() => setSplitMenu(null)}
          label="Split view"
          items={[
            {
              label: "Side by side",
              disabled: !doc,
              run: () => run(() => startSplit("right")),
            },
            {
              label: "Top and bottom",
              disabled: !doc,
              run: () => run(() => startSplit("down")),
            },
            {
              label: "Close split",
              disabled: !splitView,
              run: () => run(closeSplit),
            },
          ]}
        />
      )}
      {tabMenu && (
        <ContextMenu
          anchor={tabMenu.anchor}
          onClose={() => setTabMenu(null)}
          label="Tab actions"
          items={[
            {
              label: "Split right",
              disabled: !tabs.find((t) => t.id === tabMenu.id)?.path,
              run: () =>
                run(async () => {
                  await selectTab(tabMenu.id);
                  await startSplit("right");
                }),
            },
            {
              label: "Split down",
              disabled: !tabs.find((t) => t.id === tabMenu.id)?.path,
              run: () =>
                run(async () => {
                  await selectTab(tabMenu.id);
                  await startSplit("down");
                }),
            },
            {
              label: "Show in second pane",
              disabled:
                !splitView || !tabs.find((t) => t.id === tabMenu.id)?.browser,
              run: () => {
                const browser = tabs.find((t) => t.id === tabMenu.id)?.browser;
                if (!browser) return;
                setSecondaryBrowser(browser);
                if (activeTabRef.current === browser.id) {
                  activeTabRef.current = 0;
                  setActiveTab(0);
                }
              },
            },
            {
              label: "Open in new window",
              disabled: !tabs.find((t) => t.id === tabMenu.id)?.path,
              run: () => run(() => detachTab(tabMenu.id, false)),
            },
            { label: "Close tab", run: () => run(() => closeTab(tabMenu.id)) },
            {
              label: "Close additional tabs",
              disabled: detached,
              run: () => run(closeAdditionalTabs),
            },
            { label: "Close all tabs", run: () => run(closeAll) },
          ]}
        />
      )}
      {conversion && (
        <Modal
          title="Convert vault to a folder"
          onClose={() => {
            if (!conversion.busy) setConversion(null);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setConversion({ ...conversion, busy: true, error: "" });
              run(async () => {
                try {
                  if (!(await saveAll()))
                    throw new Error(
                      "Save or recover drafts before converting.",
                    );
                  if (!conversion.preview) {
                    const preview = await api.previewConversion(
                      conversion.source.path,
                      conversion.parent,
                      conversion.name,
                    );
                    setConversion({
                      ...conversion,
                      preview,
                      busy: false,
                      error: "",
                    });
                  } else {
                    const result = await api.convertVault(
                      conversion.source.path,
                      conversion.parent,
                      conversion.name,
                      conversion.preview.revision,
                    );
                    for (const [old, next] of result.files)
                      await afterRelocate(old, next);
                    setVaultPath(conversion.parent);
                    await refresh();
                    setConversion(null);
                    setNotice(
                      "Converted. The original vault is retained in Trash.",
                    );
                  }
                } catch (error) {
                  setConversion({
                    ...conversion,
                    busy: false,
                    preview: null,
                    error: String(error),
                  });
                }
              });
            }}
          >
            <p>
              Keep Vault → Folder → Note. Existing folder names become filename
              prefixes. No files are overwritten; the original vault is retained
              in Trash.
            </p>
            <label>
              Destination vault
              <select
                required
                disabled={conversion.busy}
                value={conversion.parent}
                onChange={(e) =>
                  setConversion({
                    ...conversion,
                    parent: e.target.value,
                    preview: null,
                  })
                }
              >
                <option value="">Choose vault…</option>
                {snapshot.entries
                  .filter((v) => v.path !== conversion.source.path)
                  .map((v) => (
                    <option key={v.path} value={v.path}>
                      {v.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Folder name
              <input
                required
                disabled={conversion.busy}
                value={conversion.name}
                onChange={(e) =>
                  setConversion({
                    ...conversion,
                    name: e.target.value,
                    preview: null,
                  })
                }
              />
            </label>
            {conversion.preview && (
              <div className="conversion-preview">
                <p>
                  {conversion.preview.files.length} files →{" "}
                  {conversion.preview.destination}
                </p>
                {conversion.preview.files.map(([from, to]) => (
                  <p key={from}>
                    <small>{from}</small>
                    <br />→ {to}
                  </p>
                ))}
                <p>Empty folders will not become nested folders.</p>
              </div>
            )}
            {conversion.error && <p role="alert">{conversion.error}</p>}
            <button className="primary" disabled={conversion.busy}>
              {conversion.busy
                ? "Working…"
                : conversion.preview
                  ? "Confirm conversion"
                  : "Preview changes"}
            </button>
          </form>
        </Modal>
      )}
      {tableInsert && (
        <Modal title="Insert table" onClose={() => setTableInsert(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const view =
                menuPane.current === "secondary"
                  ? secondaryEditor.current
                  : editorView.current;
              const note =
                menuPane.current === "secondary"
                  ? secondaryRef.current.doc
                  : current.current.doc;
              if (!view || note?.path !== tableInsert.path || note?.locked)
                return;
              const pos = Math.min(tableInsert.position, view.state.doc.length);
              const insertedIndex = findTables(
                view.state.doc.toString(),
              ).filter((t) => t.from < pos).length;
              const tableAppearance =
                menuPane.current === "secondary"
                  ? secondaryAppearance
                  : appearance;
              (menuPane.current === "secondary"
                ? setSecondaryAppearance
                : setAppearance)({
                widths: Object.fromEntries(
                  Object.entries(tableAppearance.widths).map(([i, widths]) => [
                    Number(i) >= insertedIndex ? Number(i) + 1 : Number(i),
                    widths,
                  ]),
                ),
                highlights: tableAppearance.highlights.map((i) =>
                  i >= insertedIndex ? i + 1 : i,
                ),
              });
              const rows = Array.from({ length: tableRows + 1 }, (_, r) =>
                Array.from({ length: tableColumns }, (_, c) =>
                  r === 0 ? `Column ${c + 1}` : "",
                ),
              );
              view.dispatch({
                changes: {
                  from: pos,
                  insert: "\n\n" + serializeTable(rows) + "\n\n",
                },
              });
              setTableInsert(null);
            }}
          >
            <label>
              Rows
              <input
                aria-label="Table rows"
                type="number"
                min={1}
                max={100}
                value={tableRows}
                onChange={(e) =>
                  setTableRows(
                    Math.max(1, Math.min(100, Number(e.target.value))),
                  )
                }
              />
            </label>
            <label>
              Columns
              <input
                aria-label="Table columns"
                type="number"
                min={1}
                max={30}
                value={tableColumns}
                onChange={(e) =>
                  setTableColumns(
                    Math.max(1, Math.min(30, Number(e.target.value))),
                  )
                }
              />
            </label>
            <footer className="dialog-footer">
              <button type="button" onClick={() => setTableInsert(null)}>
                Cancel
              </button>
              <button>Insert table</button>
            </footer>
          </form>
        </Modal>
      )}
      {vaultSetup && (
        <Modal
          title={
            vaultSetup === "create" ? "Create vault" : "Add existing vault"
          }
          onClose={() => {
            if (!vaultSetupBusy) setVaultSetup(null);
          }}
        >
          <VaultSetup
            onBusy={setVaultSetupBusy}
            kind={vaultSetup}
            cancel={() => setVaultSetup(null)}
            complete={async (path, state) => {
              setOrganizer(state);
              await refresh();
              setVaultPath(path);
              setSelected(path);
              setVaultSetup(null);
              setNotice("Vault ready.");
            }}
          />
        </Modal>
      )}
      {textPanel && (
        <AnchoredPanel
          anchor={textPanel}
          label="Text appearance"
          onClose={() => setTextPanel(null)}
        >
          <h2>Text appearance</h2>
          <label className="preference-field">
            This note’s alignment
            <select
              aria-label="Note alignment"
              value={
                (textPane === "secondary" ? secondaryAppearance : appearance)
                  .alignment
              }
              onChange={(e) =>
                (textPane === "secondary"
                  ? setSecondaryAppearance
                  : setAppearance)({
                  alignment: e.target.value as typeof appearance.alignment,
                })
              }
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
              <option value="justify">Justified</option>
            </select>
          </label>
          <label className="preference-field">
            Text width
            <select
              aria-label="Text width"
              value={
                (textPane === "secondary" ? secondaryAppearance : appearance)
                  .textWidth
              }
              onChange={(e) =>
                (textPane === "secondary"
                  ? setSecondaryAppearance
                  : setAppearance)({
                  textWidth: e.target.value as "comfortable" | "wide",
                })
              }
            >
              <option value="comfortable">Comfortable</option>
              <option value="wide">Wide (+35%)</option>
            </select>
          </label>
          <label className="preference-field">
            Font family
            <select
              aria-label="Font family"
              value={fontFamily}
              onChange={(e) => setFontFamily(e.target.value)}
            >
              {[
                "Segoe UI",
                "Calibri",
                "Georgia",
                "Cambria",
                "Cascadia Code",
              ].map((font) => (
                <option key={font} style={{ fontFamily: font }}>
                  {font}
                </option>
              ))}
            </select>
          </label>
          <p className="font-preview" style={{ fontFamily, fontWeight }}>
            A quiet space for your thoughts.
          </p>
          <label className="preference-field">
            Font size <output>{fontSize} px</output>
            <input
              aria-label="Font size"
              type="range"
              min="12"
              max="28"
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
            />
          </label>
          <label className="preference-field">
            Font weight
            <select
              aria-label="Font weight"
              value={fontWeight}
              onChange={(e) => setFontWeight(Number(e.target.value))}
            >
              <option value={400}>Regular</option>
              <option value={500}>Medium</option>
              <option value={600}>Semibold</option>
              <option value={700}>Bold</option>
            </select>
          </label>
          <p className="dialog-hint">
            Font settings apply to all notes. Width and alignment apply to this
            note. Markdown files stay unchanged.
          </p>
          <button
            onClick={() => {
              setFontFamily("Segoe UI");
              setFontSize(16);
              setFontWeight(400);
            }}
          >
            Reset appearance
          </button>
        </AnchoredPanel>
      )}
      {actions && (
        <AnchoredPanel
          key={actions.settings ? "settings" : "menu"}
          anchor={actions.anchor}
          label={
            actions.settings
              ? "Vault settings"
              : `Actions for ${actions.entry.name}`
          }
          menu={!actions.settings}
          onClose={() => {
            if (actions.settings && inline?.kind === "rename") setInline(null);
            setActions(null);
          }}
        >
          {actions.settings ? (
            <>
              <header>
                <h2>Vault settings</h2>
                <Icon
                  label="Close vault settings"
                  onClick={() => {
                    if (inline?.kind === "rename") setInline(null);
                    setActions(null);
                  }}
                >
                  <X size={16} />
                </Icon>
              </header>
              <div className="vault-name-edit">
                {inline?.kind === "rename" &&
                inline.entry.path === actions.entry.path ? (
                  inlineEditor
                ) : (
                  <>
                    <strong>{actions.entry.name}</strong>
                    <button
                      className="icon"
                      aria-label="Rename vault"
                      onClick={() => {
                        setName(actions.entry.name);
                        setDialogError("");
                        setInline({ kind: "rename", entry: actions.entry });
                      }}
                    >
                      <Pencil size={15} />
                    </button>
                  </>
                )}
              </div>
              <label className="preference-field">
                Area
                <div className="vault-area-control">
                  <AreaIcon
                    icon={
                      organizer.areas.find(
                        (area) =>
                          area.id === organizer.assignments[actions.entry.path],
                      )?.icon
                    }
                  />
                  <select
                    aria-label="Vault area"
                    value={organizer.assignments[actions.entry.path] || ""}
                    onChange={(e) => {
                      const assignments = { ...organizer.assignments };
                      if (e.target.value)
                        assignments[actions.entry.path] = e.target.value;
                      else delete assignments[actions.entry.path];
                      run(async () =>
                        setOrganizer(
                          await api.saveOrganizer({
                            ...organizer,
                            assignments,
                          }),
                        ),
                      );
                    }}
                  >
                    <option value="">Uncategorized</option>
                    {organizer.areas.map((area) => (
                      <option key={area.id} value={area.id}>
                        {area.name}
                      </option>
                    ))}
                  </select>
                </div>
              </label>

              <div className="vault-location-row">
                <p
                  className="vault-location"
                  title={snapshot.root + "/" + actions.entry.path}
                >
                  {snapshot.root + "/" + actions.entry.path}
                </p>
                <button
                  className="icon"
                  aria-label="Open vault folder"
                  title="Open vault folder"
                  onClick={() => run(() => api.reveal(actions.entry.path))}
                >
                  <FolderOpen size={16} />
                </button>
              </div>
              <hr />
              <button
                title="Keeps files on disk. Restore through Hidden vaults."
                onClick={() => run(() => hideVault(actions.entry))}
              >
                <EyeOff size={15} />
                Hide from sidebar
              </button>
              <hr />
              <button
                className="danger"
                onClick={() => deleteEntry(actions.entry)}
              >
                <Trash2 size={15} />
                Move to Trash…
              </button>
            </>
          ) : (
            <>
              {actions.entry.kind !== "note" && (
                <>
                  {actions.entry.kind === "vault" && (
                    <>
                      <button
                        role="menuitem"
                        onClick={() => showCreate("folder", actions.entry.path)}
                      >
                        <FolderPlus size={15} />
                        Create folder
                      </button>
                      <button
                        role="menuitem"
                        onClick={() => showCreate("note", actions.entry.path)}
                      >
                        Create note…
                      </button>
                      <button
                        role="menuitem"
                        onClick={() => {
                          setConversion({
                            source: actions.entry,
                            parent: "",
                            name: actions.entry.name,
                            preview: null,
                            error: "",
                            busy: false,
                          });
                          setActions(null);
                        }}
                      >
                        Convert to folder…
                      </button>
                    </>
                  )}
                  {actions.entry.kind === "folder" && (
                    <>
                      <button
                        role="menuitem"
                        onClick={() => showCreate("note", actions.entry.path)}
                      >
                        <FilePlus2 size={15} />
                        New note
                      </button>
                      <button
                        role="menuitem"
                        onClick={() => showCreate("folder", actions.entry.path)}
                      >
                        <FolderPlus size={15} />
                        New folder
                      </button>
                      {organizer.orders[actions.entry.path] && (
                        <button
                          role="menuitem"
                          onClick={() => {
                            const parent = actions.entry.path;
                            setActions(null);
                            run(() => resetNoteOrder(parent));
                          }}
                        >
                          Reset note order
                        </button>
                      )}
                    </>
                  )}
                </>
              )}
              {actions.entry.kind === "note" && (
                <>
                  <button
                    role="menuitem"
                    onClick={() => {
                      const path = actions.entry.path;
                      setActions(null);
                      run(() => openExtraTab(path));
                    }}
                  >
                    <FilePlus2 size={15} />
                    Open in new tab
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      const path = actions.entry.path;
                      setActions(null);
                      run(async () => {
                        if (await saveAll()) await api.detach(path, false);
                      });
                    }}
                  >
                    <FolderOpen size={15} />
                    Open in new window
                  </button>
                </>
              )}
              {actions.entry.kind === "vault" ? (
                <button
                  role="menuitem"
                  onClick={() => setActions({ ...actions, settings: true })}
                >
                  <Settings size={15} />
                  Vault settings
                </button>
              ) : (
                <>
                  <button
                    role="menuitem"
                    onClick={() => renameEntry(actions.entry)}
                  >
                    <Pencil size={15} />
                    Rename
                  </button>
                  <button
                    role="menuitem"
                    className="danger"
                    onClick={() => deleteEntry(actions.entry)}
                  >
                    <Trash2 size={15} />
                    Delete
                  </button>
                </>
              )}
            </>
          )}
        </AnchoredPanel>
      )}
      {hiddenPanel && (
        <AnchoredPanel
          anchor={hiddenPanel}
          label="Hidden vaults"
          onClose={() => setHiddenPanel(null)}
        >
          <header>
            <h2>Hidden vaults</h2>
            <Icon
              label="Close hidden vaults"
              onClick={() => setHiddenPanel(null)}
            >
              <X size={16} />
            </Icon>
          </header>
          <p className="dialog-hint">Files have not been moved or deleted.</p>
          {hiddenVaults.map((path) => (
            <button
              key={path}
              onClick={() => {
                updateHidden(hiddenVaults.filter((p) => p !== path));
                setHiddenPanel(null);
              }}
            >
              Restore {path}
            </button>
          ))}
        </AnchoredPanel>
      )}
      {dialog && (
        <Modal
          title="Move to Trash?"
          onClose={() => {
            if (!working) setDialog(null);
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void commitDialog();
            }}
          >
            <p className="delete-description">
              “{dialog.entry.name}”
              {dialog.entry.kind !== "note" ? " and everything inside it" : ""}{" "}
              will move to Lotus Trash. You can restore it from Settings.
            </p>
            {dialogError && (
              <p className="dialog-error" role="alert">
                {dialogError}
              </p>
            )}
            <footer className="dialog-footer">
              <button
                type="button"
                onClick={() => setDialog(null)}
                disabled={working}
              >
                Cancel
              </button>
              <button
                className="primary danger-button"
                type="submit"
                disabled={working}
              >
                {working ? "Working…" : "Move to Trash"}
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {settings && (
        <Suspense fallback={null}>
          <AppSettings
            initialTab={aiSettings ? "AI models" : undefined}
            root={snapshot.root}
            beforeTransfer={saveAll}
            theme={theme}
            setTheme={setTheme}
            onClose={() => {
              setSettings(false);
              setAiSettings(false);
            }}
            changeRoot={changeRoot}
            refresh={refresh}
            openReleaseHistory={openReleaseHistory}
          />
        </Suspense>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={15} />
          {notice}
        </div>
      )}
    </div>
  );
}
