import { useState } from "react";
import {
  ChevronDown,
  Import,
  FolderPlus,
  Settings,
  Plus,
  ArrowLeft,
} from "lucide-react";
import { AnchoredPanel } from "./AnchoredPanel";
import { anchorAt, type Anchor } from "./sidebarTypes";
import { AreaIcon } from "./AreaIcons";
import type { Entry, OrganizerState } from "./notus";

export function VaultSwitcher({
  entries,
  active,
  choose,
  create,
  add,
  actions,
  state,
}: {
  entries: Entry[];
  active?: Entry;
  choose: (path: string) => void;
  create: () => void;
  add: () => Promise<void>;
  actions: (entry: Entry, anchor: Anchor) => void;
  state: OrganizerState;
}) {
  const [panel, setPanel] = useState<{
    anchor: Anchor;
    kind: "choose" | "add";
  } | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const area = (path?: string) =>
    state.areas.find((a) => a.id === state.assignments[path ?? ""]);
  return (
    <div className="vault-switcher">
      <button
        className="vault-choice"
        data-vault-drop={active?.path}
        data-path={active?.path}
        data-kind="vault"
        aria-label="Choose vault"
        aria-expanded={!!panel}
        onClick={(e) => {
          setQuery("");
          setError("");
          setPanel(
            panel
              ? null
              : { anchor: anchorAt(e.currentTarget), kind: "choose" },
          );
        }}
      >
        <AreaIcon icon={area(active?.path)?.icon} />
        <span className="vault-name-label">
          <strong>{active?.name ?? "Choose vault"}</strong>
          <small>{area(active?.path)?.name ?? "Uncategorized"}</small>
        </span>
        <ChevronDown size={15} />
      </button>
      {panel && (
        <AnchoredPanel
          anchor={panel.anchor}
          label={panel.kind === "choose" ? "Choose vault" : "Add vault"}
          className="vault-picker-popup"
          onClose={() => {
            if (!busy) setPanel(null);
          }}
        >
          {panel.kind === "choose" ? (
            <>
              <div className="vault-picker-heading">
                <label htmlFor="vault-search">Find a vault</label>
                <button
                  className="icon"
                  title="Create or add vault"
                  aria-label="Create or add vault"
                  onClick={() => setPanel({ ...panel, kind: "add" })}
                >
                  <Plus size={17} />
                </button>
              </div>
              <input
                id="vault-search"
                autoFocus
                aria-label="Find a vault"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="vault-options">
                {entries
                  .filter((e) =>
                    e.name.toLowerCase().includes(query.toLowerCase()),
                  )
                  .map((entry) => (
                    <div
                      key={entry.path}
                      className="vault-option-row"
                      data-current={entry.path === active?.path}
                    >
                      <button
                        className="vault-option-settings icon"
                        aria-label={`Settings for ${entry.name}`}
                        title={`Settings for ${entry.name}`}
                        onClick={(e) => {
                          const peer = e.currentTarget.closest<HTMLElement>(
                            ".vault-picker-popup",
                          )!;
                          const rect = peer.getBoundingClientRect();
                          actions(entry, {
                            x: rect.right + 8,
                            y: rect.top,
                            trigger: e.currentTarget,
                            beside: peer,
                          });
                        }}
                      >
                        <Settings size={15} />
                      </button>
                      <button
                        className="vault-option-name"
                        data-vault-drop={entry.path}
                        data-path={entry.path}
                        data-kind="vault"
                        aria-current={
                          entry.path === active?.path ? "true" : undefined
                        }
                        onClick={() => {
                          choose(entry.path);
                          setPanel(null);
                        }}
                      >
                        <AreaIcon icon={area(entry.path)?.icon} />
                        <span>{entry.name}</span>
                      </button>
                    </div>
                  ))}
                {!entries.some((e) =>
                  e.name.toLowerCase().includes(query.toLowerCase()),
                ) && <p className="muted">No vaults found.</p>}
              </div>
            </>
          ) : (
            <>
              <button
                onClick={() => setPanel({ ...panel, kind: "choose" })}
                disabled={busy}
              >
                <ArrowLeft size={15} />
                Vaults
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setPanel(null);
                  create();
                }}
              >
                <FolderPlus size={16} />
                Create vault
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void add()
                    .then(() => setPanel(null))
                    .catch((e) => setError(String(e)))
                    .finally(() => setBusy(false));
                }}
              >
                <Import size={16} />
                {busy ? "Adding vault…" : "Add existing vault…"}
              </button>
              <p className="dialog-hint">
                Existing vaults are copied into this workspace. Originals stay
                unchanged.
              </p>
            </>
          )}
          {error && (
            <p role="alert" className="dialog-error">
              {error}
            </p>
          )}
        </AnchoredPanel>
      )}
    </div>
  );
}
