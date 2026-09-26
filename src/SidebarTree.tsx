import { useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Ellipsis } from "lucide-react";
import { directoryStatus, loadDirectory } from "./workspaceClient";
import { stem, type Entry } from "./notus";

import { anchorAt, type Anchor, type InlineEdit } from "./sidebarTypes";

const INITIAL_NOTE_ROWS = 250;
const NOTE_ROW_STEP = 250;
type DragPayload = { path: string; kind: Entry["kind"] };
const lotusPayload = (event: React.DragEvent): DragPayload | null => {
  const raw =
    event.dataTransfer.getData("application/x-lotus-note") ||
    event.dataTransfer.getData("text/plain");
  try {
    const value = raw ? (JSON.parse(raw) as Partial<DragPayload>) : null;
    if (
      value &&
      typeof value.path === "string" &&
      ["vault", "folder", "note"].includes(value.kind ?? "")
    )
      return value as DragPayload;
  } catch {
    // Old WebView2 builds may expose only Lotus' legacy custom fields.
  }
  const path = event.dataTransfer.getData("text/notus-path");
  const kind = event.dataTransfer.getData("text/notus-kind") as Entry["kind"];
  return path && ["vault", "folder", "note"].includes(kind)
    ? { path, kind }
    : null;
};
const mayBeLotusDrag = (event: React.DragEvent) =>
  ["application/x-lotus-note", "notus-note", "notus-folder", "text/plain"].some(
    (type) => event.dataTransfer.types.includes(type),
  );
const paneAt = (clientX: number, clientY: number) => {
  // A browser pane is a native WebView2 child, which sits above DOM hit
  // testing. Pane geometry remains available, so pointer drags can still
  // replace it with a note just like they replace an ordinary note pane.
  for (const target of ["primary-pane", "secondary-pane"] as const) {
    const pane = [
      ...document.querySelectorAll<HTMLElement>(
        `[data-lotus-drop="${target}"]`,
      ),
    ].find((element) => {
      const rect = element.getBoundingClientRect();
      return (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      );
    });
    if (pane) return target;
  }
  return undefined;
};
export function InlineName({
  value,
  error,
  working,
  onChange,
  onConfirm,
  onCancel,
}: {
  value: string;
  error: string;
  working: boolean;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    ref.current?.focus();
    ref.current?.select();
    ref.current?.scrollIntoView({ block: "nearest" });
  }, []);
  return (
    <form
      className="inline-name"
      onSubmit={(e) => {
        e.preventDefault();
        onConfirm();
      }}
    >
      <input
        ref={ref}
        aria-label="Name"
        aria-invalid={!!error}
        aria-describedby={error ? "inline-name-error" : undefined}
        value={value}
        disabled={working}
        maxLength={160}
        placeholder="Name…"
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      {error && (
        <span id="inline-name-error" className="inline-error" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}
type Props = {
  entries: Entry[];
  selected: string;
  collapsed: Set<string>;
  query: string;
  depth?: number;
  parent?: string;
  onToggle: (path: string) => void;
  onSelect: (entry: Entry) => void;
  onMove: (source: string, parent: string) => void;
  onReorder: (source: string, parent: string, before: string | null) => void;
  onActions: (entry: Entry, anchor: Anchor) => void;
  inline: InlineEdit | null;
  editor: React.ReactNode;
  externalDropTarget?: string;
};
export function SidebarTree(props: Props) {
  const {
    entries,
    selected,
    collapsed,
    query,
    onToggle,
    onSelect,
    onMove,
    onReorder,
    onActions,
    inline,
    editor,
    externalDropTarget,
    depth = 0,
    parent = "",
  } = props;
  const [over, setOver] = useState("");
  const [insert, setInsert] = useState<{
    path: string;
    before: boolean;
  } | null>(null);
  const [noteRows, setNoteRows] = useState(INITIAL_NOTE_ROWS);
  const pointerDrag = useRef<{
    path: string;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const [pointerDragging, setPointerDragging] = useState("");
  const matches = (entry: Entry): boolean =>
    entry.name.toLowerCase().includes(query.toLowerCase()) ||
    entry.children.some(matches);
  return (
    <>
      {(() => {
        const matching = entries.filter(matches);
        // Folders stay visible, while a very large note folder is progressively
        // rendered. This bounds DOM work even for vaults with thousands of files.
        const folders = matching.filter((entry) => entry.kind !== "note");
        const notes = matching.filter((entry) => entry.kind === "note");
        const shown = query
          ? matching
          : [...folders, ...notes.slice(0, noteRows)];
        return shown.map((entry) => {
          const folder = entry.kind !== "note";
          const open = !collapsed.has(entry.path) || !!query;
          const renaming =
            inline?.kind === "rename" && inline.entry.path === entry.path;
          return (
            <div
              key={entry.path}
              className={
                entry.kind === "vault" ? "vault-group" : "folder-group"
              }
            >
              <div
                data-path={entry.path}
                data-kind={entry.kind}
                data-parent={parent}
                className={`tree-row kind-${entry.kind} ${pointerDragging === entry.path ? "pointer-dragging" : ""} ${selected === entry.path ? "selected" : ""} ${over === entry.path || externalDropTarget === entry.path ? "drop-target" : ""} ${insert?.path === entry.path ? (insert.before ? "drop-insert-before" : "drop-insert-after") : ""}`}
                style={{ paddingLeft: 6 + depth * 16 }}
                // Notes use pointer capture below.  Native HTML dragging is not
                // reliable in WebView2: it may never enter the drop targets.
                draggable={entry.kind === "folder" && !inline}
                onPointerDown={(event) => {
                  if (
                    entry.kind !== "note" ||
                    inline ||
                    event.button !== 0 ||
                    (event.target as HTMLElement).closest(
                      ".twisty, .row-actions, input",
                    )
                  )
                    return;
                  pointerDrag.current = {
                    path: entry.path,
                    pointerId: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    active: false,
                  };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  const drag = pointerDrag.current;
                  if (!drag || drag.pointerId !== event.pointerId) return;
                  if (!drag.active) {
                    if (
                      Math.hypot(
                        event.clientX - drag.startX,
                        event.clientY - drag.startY,
                      ) < 7
                    )
                      return;
                    drag.active = true;
                    suppressClick.current = true;
                    setPointerDragging(drag.path);
                  }
                  const pane = paneAt(event.clientX, event.clientY);
                  const target = document
                    .elementFromPoint(event.clientX, event.clientY)
                    ?.closest<HTMLElement>(
                      "[data-path], [data-tab-id], [data-lotus-drop]",
                    );
                  document
                    .querySelectorAll(
                      ".pointer-drop-before, .pointer-drop-after, .pointer-drop-target",
                    )
                    .forEach((element) =>
                      element.classList.remove(
                        "pointer-drop-before",
                        "pointer-drop-after",
                        "pointer-drop-target",
                      ),
                    );
                  if (pane) {
                    document
                      .querySelector<HTMLElement>(`[data-lotus-drop="${pane}"]`)
                      ?.classList.add("pointer-drop-target");
                    return;
                  }
                  if (!target || target.dataset.path === drag.path) return;
                  if (target.dataset.lotusDrop) {
                    target.classList.add("pointer-drop-target");
                  } else if (target.dataset.kind === "note") {
                    const rect = target.getBoundingClientRect();
                    target.classList.add(
                      event.clientY < rect.top + rect.height / 2
                        ? "pointer-drop-before"
                        : "pointer-drop-after",
                    );
                  } else if (
                    target.dataset.kind === "folder" ||
                    target.dataset.kind === "vault"
                  ) {
                    target.classList.add("pointer-drop-target");
                  }
                }}
                onPointerUp={(event) => {
                  const drag = pointerDrag.current;
                  if (!drag || drag.pointerId !== event.pointerId) return;
                  pointerDrag.current = null;
                  if (event.currentTarget.hasPointerCapture(event.pointerId))
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  document
                    .querySelectorAll(
                      ".pointer-drop-before, .pointer-drop-after, .pointer-drop-target",
                    )
                    .forEach((element) =>
                      element.classList.remove(
                        "pointer-drop-before",
                        "pointer-drop-after",
                        "pointer-drop-target",
                      ),
                    );
                  setPointerDragging("");
                  if (!drag.active) {
                    // WebView2 can lose the nested button's synthetic `click`
                    // after this row captures a pointer for drag-and-drop. A
                    // pointer release without a drag is always a note selection.
                    // Suppress the button's later click so the open operation
                    // runs exactly once in browsers that do dispatch it.
                    suppressClick.current = true;
                    onSelect(entry);
                    window.setTimeout(() => {
                      suppressClick.current = false;
                    }, 0);
                    return;
                  }
                  const pane = paneAt(event.clientX, event.clientY);
                  const target = document
                    .elementFromPoint(event.clientX, event.clientY)
                    ?.closest<HTMLElement>(
                      "[data-path], [data-tab-id], [data-lotus-drop]",
                    );
                  const tabId = Number(target?.dataset.tabId);
                  const paneTarget = pane ?? target?.dataset.lotusDrop;
                  if (paneTarget || Number.isInteger(tabId)) {
                    window.dispatchEvent(
                      new CustomEvent("lotus-note-pointer-drop", {
                        detail: {
                          path: drag.path,
                          target: paneTarget,
                          tabId: Number.isInteger(tabId) ? tabId : undefined,
                        },
                      }),
                    );
                  } else if (target?.dataset.kind === "note") {
                    const targetPath = target.dataset.path!;
                    const targetParent = target.dataset.parent ?? "";
                    const rect = target.getBoundingClientRect();
                    const before =
                      event.clientY < rect.top + rect.height / 2
                        ? targetPath
                        : (() => {
                            const rows = [
                              ...document.querySelectorAll<HTMLElement>(
                                `[data-kind='note'][data-parent='${CSS.escape(targetParent)}']`,
                              ),
                            ];
                            return (
                              rows[
                                rows.findIndex(
                                  (row) => row.dataset.path === targetPath,
                                ) + 1
                              ]?.dataset.path ?? null
                            );
                          })();
                    if (targetPath !== drag.path)
                      onReorder(drag.path, targetParent, before);
                  } else if (
                    target?.dataset.kind === "folder" ||
                    target?.dataset.kind === "vault"
                  ) {
                    const destination = target.dataset.path;
                    if (destination) onMove(drag.path, destination);
                  }
                  window.setTimeout(() => {
                    suppressClick.current = false;
                  }, 0);
                }}
                onPointerCancel={() => {
                  pointerDrag.current = null;
                  suppressClick.current = false;
                  setPointerDragging("");
                  document
                    .querySelectorAll(
                      ".pointer-drop-before, .pointer-drop-after, .pointer-drop-target",
                    )
                    .forEach((element) =>
                      element.classList.remove(
                        "pointer-drop-before",
                        "pointer-drop-after",
                        "pointer-drop-target",
                      ),
                    );
                }}
                onContextMenu={(event) => {
                  if ((event.target as HTMLElement).closest("input")) return;
                  event.preventDefault();
                  const trigger =
                    event.currentTarget.querySelector<HTMLElement>(
                      ".row-actions",
                    )!;
                  onActions(entry, anchorAt(trigger));
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "ContextMenu" ||
                    (event.shiftKey && event.key === "F10")
                  ) {
                    event.preventDefault();
                    onActions(
                      entry,
                      anchorAt(
                        event.currentTarget.querySelector<HTMLElement>(
                          ".row-actions",
                        )!,
                      ),
                    );
                  }
                }}
                onDragStart={(event) => {
                  const payload = JSON.stringify({
                    path: entry.path,
                    kind: entry.kind,
                  });
                  event.dataTransfer.setData(
                    "application/x-lotus-note",
                    payload,
                  );
                  event.dataTransfer.setData("text/notus-path", entry.path);
                  event.dataTransfer.setData("text/notus-kind", entry.kind);
                  event.dataTransfer.setData(`notus-${entry.kind}`, "1");
                  event.dataTransfer.setData("text/plain", payload);
                  event.dataTransfer.effectAllowed = "copyMove";
                }}
                onDragOver={(event) => {
                  if (entry.kind === "note" && mayBeLotusDrag(event)) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setInsert({
                      path: entry.path,
                      before:
                        event.clientY <
                        event.currentTarget.getBoundingClientRect().top +
                          event.currentTarget.getBoundingClientRect().height /
                            2,
                    });
                    setOver("");
                    return;
                  }
                  if (
                    (entry.kind === "folder" || entry.kind === "vault") &&
                    mayBeLotusDrag(event)
                  ) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setOver(entry.path);
                  }
                }}
                onDragLeave={(event) => {
                  if (
                    !event.currentTarget.contains(event.relatedTarget as Node)
                  ) {
                    setOver("");
                    setInsert((current) =>
                      current?.path === entry.path ? null : current,
                    );
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setOver("");
                  const payload = lotusPayload(event);
                  const path = payload?.path;
                  const kind = payload?.kind;
                  if (entry.kind === "note" && kind === "note" && path) {
                    const current = insert;
                    const notes = matching.filter(
                      (candidate) => candidate.kind === "note",
                    );
                    const index = notes.findIndex(
                      (candidate) => candidate.path === entry.path,
                    );
                    const before = current?.before
                      ? entry.path
                      : (notes[index + 1]?.path ?? null);
                    setInsert(null);
                    onReorder(path, parent, before);
                    return;
                  }
                  setInsert(null);
                  if (
                    path &&
                    ((entry.kind === "folder" && kind === "note") ||
                      (entry.kind === "vault" &&
                        (kind === "folder" || kind === "note")))
                  )
                    onMove(path, entry.path);
                }}
              >
                {folder ? (
                  <button
                    className="twisty"
                    aria-label={`${open ? "Collapse" : "Expand"} ${entry.name}`}
                    aria-expanded={open}
                    onClick={() => onToggle(entry.path)}
                  >
                    {open ? (
                      <ChevronDown size={13} />
                    ) : (
                      <ChevronRight size={13} />
                    )}
                  </button>
                ) : (
                  <span className="twisty-spacer" />
                )}
                {renaming ? (
                  editor
                ) : (
                  <>
                    <button
                      className="tree-select"
                      title={entry.path}
                      aria-current={
                        selected === entry.path ? "page" : undefined
                      }
                      onClick={(event) => {
                        if (suppressClick.current) {
                          event.preventDefault();
                          event.stopPropagation();
                          return;
                        }
                        onSelect(entry);
                      }}
                    >
                      <span>
                        {entry.kind === "note" ? stem(entry.name) : entry.name}
                      </span>
                    </button>
                    <button
                      className="row-actions"
                      aria-label={`Actions for ${entry.name}`}
                      aria-haspopup="menu"
                      onClick={(event) =>
                        onActions(entry, anchorAt(event.currentTarget))
                      }
                    >
                      <Ellipsis size={15} />
                    </button>
                  </>
                )}
              </div>
              {folder &&
                open &&
                directoryStatus(entry.path).state !== "loaded" && (
                  <div
                    className="muted"
                    role="status"
                    style={{ paddingLeft: (depth + 1) * 12 + 20 }}
                  >
                    {directoryStatus(entry.path).state === "failed"
                      ? "Could not load folder."
                      : "Loading folder…"}
                    {(directoryStatus(entry.path).state === "failed" ||
                      Date.now() -
                        (directoryStatus(entry.path).started ?? Date.now()) >=
                        10000) && (
                      <button
                        onClick={() =>
                          void loadDirectory(entry.path, false, true).catch(
                            () => {},
                          )
                        }
                      >
                        Retry
                      </button>
                    )}
                  </div>
                )}
              {folder && open && (
                <SidebarTree
                  {...props}
                  entries={entry.children}
                  depth={depth + 1}
                  parent={entry.path}
                />
              )}
            </div>
          );
        });
      })()}
      {!query &&
        entries.filter(matches).filter((entry) => entry.kind === "note")
          .length > noteRows && (
          <button
            className="tree-show-more"
            type="button"
            onClick={() => setNoteRows((count) => count + NOTE_ROW_STEP)}
          >
            Show{" "}
            {Math.min(
              NOTE_ROW_STEP,
              entries.filter(matches).filter((entry) => entry.kind === "note")
                .length - noteRows,
            )}{" "}
            more notes
          </button>
        )}
      {inline?.kind === "create" && inline.parent === parent && (
        <div
          className={`tree-row temporary-row kind-${inline.entryKind}`}
          style={{ paddingLeft: 6 + depth * 16 }}
        >
          <span className="creation-twisty">
            {inline.entryKind === "folder" ? <ChevronRight size={14} /> : null}
          </span>
          {editor}
        </div>
      )}
    </>
  );
}
