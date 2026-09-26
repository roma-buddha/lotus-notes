import { useOrganizerDrag } from "./useOrganizerDrag";
import { externalMoves } from "./core/fileChanges";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Pencil,
  ChevronsDownUp,
  ChevronsUpDown,
  Ellipsis,
} from "lucide-react";
import { anchorAt, type Anchor } from "./sidebarTypes";
import { AreaIcon, AreaIconPicker } from "./AreaIcons";
import { parentOf, stem, type Entry, type OrganizerState } from "./notus";

export function WorkspaceOrganizer({
  entries,
  state,
  update,
  move,
  open,
  actions,
  createVault,
}: {
  createVault: () => void;
  entries: Entry[];
  state: OrganizerState;
  update: (value: OrganizerState) => Promise<void>;
  move: (source: string, parent: string) => Promise<void>;
  open: (path: string) => Promise<void>;
  actions: (entry: Entry, anchor: Anchor) => void;
}) {
  const noteRow = (note: Entry) => (
    <li
      key={note.path}
      onContextMenu={(e) => {
        e.preventDefault();
        actions(note, {
          ...anchorAt(e.currentTarget),
          x: e.clientX,
          y: e.clientY,
        });
      }}
      className={drag.source === note.path ? "organizer-dragging" : undefined}
    >
      <button
        {...drag.handlers(note.path)}
        className="organizer-note"
        title={note.path}
        disabled={busy}
        onClick={() => void run(() => open(note.path))}
      >
        {stem(note.name)}
      </button>
    </li>
  );
  const [name, setName] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const previousEntries = useRef(entries);
  useEffect(() => {
    const moves = externalMoves(previousEntries.current, entries);
    previousEntries.current = entries;
    if (moves.size)
      setExpanded(
        (previous) => new Set([...previous].map((p) => moves.get(p) ?? p)),
      );
  }, [entries]);
  const toggle = (path: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  const [icon, setIcon] = useState("briefcase");
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [undo, setUndo] = useState<{ source: string; parent: string } | null>(
    null,
  );
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
  const relocate = async (source: string, parent: string) => {
    if (parentOf(source) === parent) return;
    await move(source, parent);
    setUndo({
      source: `${parent}/${source.split("/").at(-1)!}`,
      parent: parentOf(source),
    });
    setExpanded((current) => new Set([...current, parent.split("/")[0], parent]));
    setMessage("Note moved.");
  };
  const drag = useOrganizerDrag(
    busy,
    (source, destination) => void run(() => relocate(source, destination)),
    (destination) => setExpanded((current) => new Set([...current, destination])),
  );
  const matches = (e: Entry): boolean =>
    e.name.toLowerCase().includes(query.toLowerCase()) ||
    e.children.some(matches);
  const expandablePaths = useMemo(() => {
    const collect = (items: Entry[]): string[] =>
      items.flatMap((item) =>
        item.kind === "note" ? [] : [item.path, ...collect(item.children)],
      );
    return collect(entries);
  }, [entries]);
  const allExpanded = expandablePaths.length > 0 && expandablePaths.every((path) => expanded.has(path));
  const areaGroups = (() => {
    const areas = new Map(state.areas.map((area) => [area.id, area]));
    const groups = new Map<string, { name: string; icon?: string; vaults: Entry[] }>();
    for (const area of state.areas)
      groups.set(area.id, { name: area.name, icon: area.icon, vaults: [] });
    groups.set("uncategorized", { name: "Uncategorized", vaults: [] });
    for (const vault of entries.filter(matches)) {
      const areaId = state.assignments[vault.path];
      const target = areaId && areas.has(areaId) ? areaId : "uncategorized";
      groups.get(target)!.vaults.push(vault);
    }
    return [
      ...state.areas.map((area) => [area.id, groups.get(area.id)!] as const),
      ["uncategorized", groups.get("uncategorized")!] as const,
    ].filter(([id, group]) =>
      query ? group.vaults.length > 0 : id !== "uncategorized" || group.vaults.length > 0,
    );
  })();
  return (
    <section
      ref={drag.root}
      className="organizer compact-organizer"
      aria-label="Workspace organizer"
      aria-busy={busy}
    >
      <div className="organizer-content">
        <h1>Organize workspace</h1>
        <section
          className="area-management organizer-section"
          aria-label="Manage areas"
        >
          <header>
            <h2>Areas</h2>
            <button
              disabled={busy}
              onClick={() => {
                setForm(true);
                setEditing(null);
                setName("");
                setIcon("briefcase");
              }}
            >
              <Plus size={15} />
              Create area
            </button>
          </header>
          {form && (
            <form
              className="area-form"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const area = {
                    id: editing ?? crypto.randomUUID(),
                    name: name.trim(),
                    icon,
                  };
                  await update({
                    ...state,
                    areas: editing
                      ? state.areas.map((a) => (a.id === editing ? area : a))
                      : [...state.areas, area],
                  });
                  setForm(false);
                });
              }}
            >
              <label>
                Area name
                <input
                  autoFocus
                  required
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <AreaIconPicker value={icon} onChange={setIcon} />
              <button disabled={busy}>
                {editing ? "Save area" : "Create area"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setForm(false)}
              >
                Cancel
              </button>
              {editing && (
                <button
                  className="danger"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await update({
                        ...state,
                        areas: state.areas.filter((a) => a.id !== editing),
                        assignments: Object.fromEntries(
                          Object.entries(state.assignments).filter(
                            ([, id]) => id !== editing,
                          ),
                        ),
                      });
                      setForm(false);
                      setMessage(
                        "Area removed; its vaults are now Uncategorized. Files are unchanged.",
                      );
                    })
                  }
                >
                  Remove label only
                </button>
              )}
            </form>
          )}
          <ul className="area-list">
            {state.areas.map((area) => (
              <li key={area.id}>
                <AreaIcon icon={area.icon} />
                <span>{area.name}</span>
                <small>
                  {
                    Object.values(state.assignments).filter(
                      (id) => id === area.id,
                    ).length
                  }{" "}
                  vaults
                </small>
                <button
                  disabled={busy}
                  className="icon"
                  aria-label={`Edit area ${area.name}`}
                  onClick={() => {
                    setEditing(area.id);
                    setName(area.name);
                    setIcon(area.icon);
                    setForm(true);
                  }}
                >
                  <Pencil size={14} />
                </button>
              </li>
            ))}
          </ul>
          {!state.areas.length && (
            <p className="muted">
              Create an area, then choose it when creating or adding a vault.
            </p>
          )}
        </section>
        <section
          className="files-management organizer-section"
          aria-label="Organize files"
        >
          <input
            className="organizer-search"
            aria-label="Filter organizer"
            placeholder="Find a vault, folder or note…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <header className="explorer-heading">
            <button
              className="icon"
              aria-label={allExpanded ? "Collapse all" : "Expand all"}
              title={allExpanded ? "Collapse all" : "Expand all"}
              aria-pressed={allExpanded}
              onClick={() => setExpanded(allExpanded ? new Set() : new Set(expandablePaths))}
            >
              {allExpanded ? <ChevronsDownUp size={16} /> : <ChevronsUpDown size={16} />}
            </button>
            <button onClick={createVault}>
              <Plus size={15} />
              Create vault
            </button>
          </header>
          {error && (
            <p role="alert" className="dialog-error">
              {error}
            </p>
          )}
          {message && <p role="status">{message}</p>}
          {undo && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await move(undo.source, undo.parent);
                  setUndo(null);
                  setMessage("Move undone.");
                })
              }
            >
              Undo last move
            </button>
          )}
          <div
            className="organizer-tree"
            aria-label="All vaults, folders and notes"
          >
            {areaGroups.map(([areaId, area]) => (
              <section className="organizer-area-group" aria-labelledby={`area-${areaId}`} key={areaId}>
                <h3 id={`area-${areaId}`}><AreaIcon icon={area.icon} />{area.name}<small>{area.vaults.length} {area.vaults.length === 1 ? "vault" : "vaults"}</small></h3>
                {area.vaults.map((vault) => (
              <details
                open={!!query || expanded.has(vault.path)}
                className="explorer-vault"
                key={vault.path}
              >
                <summary
                  data-organizer-destination={vault.path}
                  className={drag.over === vault.path ? "drop-target" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    toggle(vault.path);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    actions(vault, {
                      ...anchorAt(e.currentTarget),
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }}
                >
                  <strong>{vault.name}</strong>
                  <button
                    className="icon organizer-actions"
                    aria-label={`Actions for ${vault.name}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      actions(vault, anchorAt(e.currentTarget));
                    }}
                  >
                    <Ellipsis size={15} />
                  </button>
                </summary>
                <ul>
                  {vault.children.filter((n) => n.kind === "note" &&
                    (vault.name.toLowerCase().includes(query.toLowerCase()) || matches(n)))
                    .map(noteRow)}
                </ul>
                {vault.children.filter((entry) => entry.kind === "folder")
                  .filter(
                    (f) =>
                      vault.name.toLowerCase().includes(query.toLowerCase()) ||
                      matches(f),
                  )
                  .map((folder) => (
                    <details
                      open={!!query || expanded.has(folder.path)}
                      key={folder.path}
                      data-folder={folder.path}
                      className={`explorer-folder ${drag.over === folder.path ? "drop-target" : ""}`}
                      data-organizer-destination={folder.path}

                    >
                      <summary
                        onClick={(e) => {
                          e.preventDefault();
                          toggle(folder.path);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          actions(folder, {
                            ...anchorAt(e.currentTarget),
                            x: e.clientX,
                            y: e.clientY,
                          });
                        }}
                      >
                        <span>{folder.name}</span>
                        <small>{folder.children.length}</small>
                        <button
                          className="icon organizer-actions"
                          aria-label={`Actions for ${folder.name}`}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            actions(folder, anchorAt(e.currentTarget));
                          }}
                        >
                          <Ellipsis size={14} />
                        </button>
                      </summary>
                      <ul>
                        {folder.children
                          .filter(
                            (n) =>
                              !query ||
                              vault.name
                                .toLowerCase()
                                .includes(query.toLowerCase()) ||
                              folder.name
                                .toLowerCase()
                                .includes(query.toLowerCase()) ||
                              matches(n),
                          )
                          .map(noteRow)}
                      </ul>
                    </details>
                  ))}
                {!vault.children.length && (
                  <p className="folder-empty">No notes or folders yet</p>
                )}
              </details>
                ))}
                {!area.vaults.length && <p className="organizer-area-empty">No vaults assigned yet.</p>}
              </section>
            ))}
            {!areaGroups.length && (
              <p className="muted">No matching vaults.</p>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
