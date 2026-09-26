import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  FolderOpen,
  Moon,
  Sun,
  Trash2,
  RotateCcw,
  X,
  FileText,
  Folder,
  BookOpen,
} from "lucide-react";
import { exportSettings, importSettings } from "./portableSettings";
import { AISettings } from "./AISettings";
import { api, type BackupPreview, type TrashItem } from "./notus";
import release from "../package.json";

export function AppSettings({
  root,
  beforeTransfer,
  theme,
  setTheme,
  onClose,
  changeRoot,
  refresh,
  openReleaseHistory,
  initialTab,
}: {
  root: string;
  beforeTransfer: () => Promise<boolean>;
  theme: "light" | "dark";
  setTheme: (value: "light" | "dark") => void;
  onClose: () => void;
  changeRoot: () => Promise<void>;
  refresh: () => Promise<unknown>;
  openReleaseHistory: () => Promise<void>;
  initialTab?: "AI models";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<
    "Appearance" | "Workspace" | "Trash" | "Export / Import" | "AI models" | "About"
  >(initialTab ?? "Appearance");
  const [vaults, setVaults] = useState(true);
  const [trash, setTrash] = useState(false);
  const [restoreSettings, setRestoreSettings] = useState(true);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [items, setItems] = useState<TrashItem[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<TrashItem[] | null>(null);
  useLayoutEffect(() => {
    const trigger = document.activeElement as HTMLElement;
    const dialog = ref.current!;
    dialog.showModal();
    return () => {
      dialog.close();
      trigger?.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (tab === "Trash")
      void api
        .listTrash()
        .then(setItems)
        .catch((e) => setError(String(e)));
  }, [tab]);
  const run = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await task();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    if (!busy) {
      if (confirm) setConfirm(null);
      else onClose();
    }
  };
  return (
    <dialog
      ref={ref}
      className="app-settings"
      aria-label="Lotus settings"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header>
        <h2>Settings</h2>
        <button
          className="icon"
          aria-label="Close settings"
          onClick={close}
          disabled={busy}
        >
          <X size={18} />
        </button>
      </header>
      <div className="settings-layout">
        <nav className="settings-tabs" aria-label="Settings sections">
          {(
            [
              "Appearance",
              "Workspace",
              "AI models",
              "Export / Import",
              "About",
              "Trash",
            ] as const
          ).map((value) => (
            <button
              key={value}
              aria-current={tab === value ? "page" : undefined}
              disabled={busy || !!confirm}
              onClick={() => {
                setTab(value);
                setError("");
                setMessage("");
              }}
            >
              {value}
            </button>
          ))}
        </nav>
        <section className="settings-content" aria-busy={busy}>
          {confirm ? (
            <>
              <h3>
                {confirm.length === 1
                  ? `Permanently delete “${confirm[0].name}”?`
                  : `Empty Trash (${confirm.length} items)?`}
              </h3>
              <p>
                This permanently removes these files and everything inside these
                folders. This cannot be undone.
              </p>
              <footer className="dialog-footer">
                <button
                  autoFocus
                  disabled={busy}
                  onClick={() => setConfirm(null)}
                >
                  Cancel
                </button>
                <button
                  className="danger-button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api.purge(confirm.map((item) => item.id));
                      setConfirm(null);
                      setItems(await api.listTrash());
                      setMessage("Permanently deleted.");
                    })
                  }
                >
                  {busy ? "Deleting…" : "Permanently delete"}
                </button>
              </footer>
            </>
          ) : tab === "AI models" ? (
            <AISettings />
          ) : tab === "About" ? (
            <section className="about-lotus">
              <h3>About Lotus</h3>
              <p>Lotus is a local-first workspace for Markdown notes. Your notes remain in the folders you choose on this computer.</p>
              <h4>Project</h4>
              <p>Lotus is an educational project by VISTU LABS.</p>
              <h4>License</h4>
              <p>© 2026 VISTU LABS. Lotus is licensed under the MIT License.</p>
              <p className="muted">You may use, copy, modify, publish, distribute, sublicense, and sell copies of Lotus, provided its copyright and MIT license notice are retained. It is provided without warranty. See the bundled LICENSE file for the complete terms.</p>
              <h4>Release</h4>
              <p>Lotus {release.version}</p>
              <button
                type="button"
                className="release-history-link"
                onClick={() => void openReleaseHistory()}
              >
                View complete release history
              </button>
              <h4>Privacy</h4>
              <p>Lotus does not run its own cloud for your notes or store their contents elsewhere. It reads and writes only the local vault you open.</p>
              <h4>AI models</h4>
              <p>You can use a model running locally in Lotus or connect a model provider with your own API key. Lotus sends only the chat and note context you explicitly choose to the selected provider. Local models run on this computer.</p>
              <p className="muted">Review AI suggestions before applying them to a note.</p>
            </section>
          ) : tab === "Appearance" ? (
            <>
              <h3>Appearance</h3>
              <p className="muted">A quiet space for your notes.</p>
              <div className="theme-choices">
                <button
                  aria-pressed={theme === "light"}
                  onClick={() => setTheme("light")}
                >
                  <Sun size={22} />
                  <span>Light</span>
                </button>
                <button
                  aria-pressed={theme === "dark"}
                  onClick={() => setTheme("dark")}
                >
                  <Moon size={22} />
                  <span>Dark</span>
                </button>
              </div>
            </>
          ) : tab === "Export / Import" ? (
            <>
              <h3>Export</h3>
              <p className="muted">
                A portable ZIP for another computer. Settings are included;
                caches and credentials are not.
              </p>
              <div className="transfer-options">
                <label>
                  <input
                    type="checkbox"
                    checked={vaults}
                    disabled={busy}
                    onChange={(e) => setVaults(e.target.checked)}
                  />
                  Include vaults, notes and attachments
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={trash}
                    disabled={busy}
                    onChange={(e) => setTrash(e.target.checked)}
                  />
                  Include Trash
                </label>
              </div>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (!(await beforeTransfer()))
                      throw Error("Resolve unsaved changes before exporting.");
                    const path = await api.exportBackup(
                      exportSettings(root),
                      vaults,
                      trash,
                    );
                    if (path) setMessage("Exported to " + path);
                  })
                }
              >
                {busy ? "Working…" : "Export ZIP…"}
              </button>
              <hr />
              <h3>Import</h3>
              <p className="muted">
                Restore into a separate Lotus folder. Existing files are never
                overwritten.
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => setPreview(await api.previewBackup()))
                }
              >
                Choose backup…
              </button>
              {preview && (
                <>
                  <p>
                    {preview.manifest.files.length} files ·{" "}
                    {Math.round(
                      preview.manifest.files.reduce(
                        (sum, f) => sum + f.size,
                        0,
                      ) / 1024,
                    )}{" "}
                    KB ·{" "}
                    {preview.manifest.include_vaults
                      ? "Vaults included"
                      : "Settings only"}
                  </p>
                  <details>
                    <summary>Preview contents</summary>
                    <ul>
                      {preview.manifest.files.slice(0, 100).map((f) => (
                        <li key={f.path}>{f.path}</li>
                      ))}
                    </ul>
                    {preview.manifest.files.length > 100 && (
                      <p>First 100 files shown.</p>
                    )}
                  </details>
                  <div className="transfer-options">
                    <label>
                      <input
                        type="checkbox"
                        checked={restoreSettings}
                        disabled={busy}
                        onChange={(e) => setRestoreSettings(e.target.checked)}
                      />
                      Restore settings and organization
                    </label>
                  </div>
                  <button
                    disabled={
                      busy ||
                      (!restoreSettings && !preview.manifest.include_vaults)
                    }
                    onClick={() =>
                      void run(async () => {
                        if (!(await beforeTransfer()))
                          throw Error(
                            "Resolve unsaved changes before importing.",
                          );
                        const restored = await api.importBackup(
                          preview,
                          restoreSettings,
                        );
                        if (restored) {
                          importSettings(
                            restored.settings,
                            restored.source_root,
                            restored.root,
                          );
                          window.location.reload();
                        }
                      })
                    }
                  >
                    Choose location and import…
                  </button>
                </>
              )}
            </>
          ) : tab === "Workspace" ? (
            <>
              <h3>Workspace folder</h3>
              <p>
                Vaults and their contents live here. Internal state and Trash
                are kept separately in the parent Lotus folder.
              </p>
              <p className="settings-path">{root}</p>
              <div className="settings-buttons">
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api.reveal("");
                    })
                  }
                >
                  <FolderOpen size={16} />
                  Open in File Explorer
                </button>
                <button disabled={busy} onClick={() => void run(changeRoot)}>
                  Change workspace…
                </button>
              </div>
              <p className="muted">
                Notes live in vaults, optionally inside a folder. Imported nested folders are safely
                flattened into uniquely named folders.
              </p>
            </>
          ) : (
            <>
              <div className="trash-heading">
                <div>
                  <h3>Trash</h3>
                  <p className="muted">
                    {items.length} {items.length === 1 ? "item" : "items"} ·
                    stored in .lotus-trash
                  </p>
                </div>
                <button
                  className="danger"
                  disabled={!items.length || busy}
                  onClick={() => setConfirm(items)}
                >
                  Empty Trash…
                </button>
              </div>
              {!items.length && (
                <div className="trash-empty">
                  <Trash2 size={28} />
                  <p>Trash is empty.</p>
                  <small>Deleted notes, folders and vaults appear here.</small>
                </div>
              )}
              <ul className="trash-list">
                {items.map((item) => (
                  <li key={item.id}>
                    {item.kind === "note" ? (
                      <FileText size={18} />
                    ) : item.kind === "vault" ? (
                      <BookOpen size={18} />
                    ) : (
                      <Folder size={18} />
                    )}
                    <div>
                      <strong>{item.name}</strong>
                      <span title={item.original}>{item.original}</span>
                      <small>{new Date(item.deleted).toLocaleString()}</small>
                    </div>
                    <button
                      className="icon"
                      disabled={busy}
                      aria-label={`Restore ${item.name}`}
                      title="Restore"
                      onClick={() =>
                        void run(async () => {
                          await api.restore(item.id);
                          setItems(await api.listTrash());
                          await refresh();
                          setMessage(`Restored ${item.name}.`);
                        })
                      }
                    >
                      <RotateCcw size={16} />
                    </button>
                    <button
                      className="icon danger"
                      disabled={busy}
                      aria-label={`Permanently delete ${item.name}`}
                      title="Permanently delete"
                      onClick={() => setConfirm([item])}
                    >
                      <Trash2 size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {error && (
            <p className="dialog-error" role="alert">
              {error}
            </p>
          )}
          {message && (
            <p className="settings-message" role="status">
              {message}
            </p>
          )}
        </section>
      </div>
    </dialog>
  );
}
