import { EditorState, Facet, StateField } from "@codemirror/state";
import { defaultKeymap, undo, redo } from "@codemirror/commands";
import {
  Decoration,
  EditorView,
  keymap,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import { findTables, serializeTable, type MarkdownTable } from "./core/tables";
import { codeTarget, wrapTarget, type EditTarget } from "./editTarget";
import { inlineContent } from "./inlineContent";
import { markdown } from "@codemirror/lang-markdown";
import { livePreview, inlineOnly } from "./livePreview";

export type TableActionRequest = {
  x: number;
  y: number;
  trigger: HTMLElement;
  index: number;
  target?: EditTarget;
  actions: { label: string; disabled?: boolean; run: () => void }[];
};
export const tableHighlights = Facet.define<number[], number[]>({
  combine: (values) => values[0] ?? [],
});
export const tableColumnWidths = Facet.define<
  Record<number, number[]>,
  Record<number, number[]>
>({ combine: (values) => values[0] ?? {} });
type Context = {
  model: MarkdownTable;
  view: EditorView;
  index: number;
  selected: [number, number];
  extent: [number, number];
  mode: "cell" | "row" | "column" | "none";
  editors: Map<HTMLElement, EditorView>;
  syncing: boolean;
  dispose: () => void;
};
const contexts = new WeakMap<HTMLElement, Context>();
class TableWidget extends WidgetType {
  constructor(
    readonly model: MarkdownTable,
    readonly index: number,
    readonly highlight: boolean,
    readonly widths: number[] = [],
  ) {
    super();
  }
  toDOM(view: EditorView) {
    const root = document.createElement("div");
    root.className = "editable-table";
    root.addEventListener("pointerdown", () => view.dom.classList.add("table-interacting"), true);
    root.addEventListener("focusin", () => view.dom.classList.add("table-interacting"));
    root.classList.toggle("highlight-first-column", this.highlight);
    const ctx: Context = {
      model: this.model,
      view,
      index: this.index,
      selected: [0, 0],
      extent: [0, 0],
      mode: "cell",
      editors: new Map(),
      syncing: false,
      dispose: () => {},
    };
    contexts.set(root, ctx);
    const commit = () => {
      if (!root.isConnected) return;
      ctx.view.dispatch({
        changes: {
          from: ctx.model.from,
          to: ctx.model.to,
          insert: serializeTable(
            ctx.model.rows,
            ctx.model.alignment,
            ctx.model.rawRows,
          ),
        },
        userEvent: "input.table",
      });
    };
    const paint = () => {
      if (ctx.mode !== "cell" || ctx.selected[0] !== ctx.extent[0] || ctx.selected[1] !== ctx.extent[1]) {
        window.getSelection()?.removeAllRanges();
        root.querySelectorAll(".editing-cell").forEach(el => el.classList.remove("editing-cell"));
      }
      root
        .querySelectorAll<HTMLElement>("[data-row][data-column]")
        .forEach((el) => {
          const selected =
            ctx.mode === "row"
              ? Number(el.dataset.row) >=
                  Math.min(ctx.selected[0], ctx.extent[0]) &&
                Number(el.dataset.row) <=
                  Math.max(ctx.selected[0], ctx.extent[0])
              : ctx.mode === "column"
                ? Number(el.dataset.column) >=
                    Math.min(ctx.selected[1], ctx.extent[1]) &&
                  Number(el.dataset.column) <=
                    Math.max(ctx.selected[1], ctx.extent[1])
                : Number(el.dataset.row) >=
                    Math.min(ctx.selected[0], ctx.extent[0]) &&
                  Number(el.dataset.row) <=
                    Math.max(ctx.selected[0], ctx.extent[0]) &&
                  Number(el.dataset.column) >=
                    Math.min(ctx.selected[1], ctx.extent[1]) &&
                  Number(el.dataset.column) <=
                    Math.max(ctx.selected[1], ctx.extent[1]);
          el.classList.toggle("table-selected", selected);
        });
      root
        .querySelectorAll<HTMLButtonElement>(".table-selector")
        .forEach((b) =>
          b.setAttribute(
            "aria-pressed",
            String(
              (ctx.mode === "row" &&
                b.dataset.selectRow === String(ctx.selected[0])) ||
                (ctx.mode === "column" &&
                  b.dataset.selectColumn === String(ctx.selected[1])),
            ),
          ),
        );
    };
    const select = (r: number, c: number, mode: Context["mode"]) => {
      root.querySelectorAll<HTMLElement>(".editing-cell").forEach((cell) => {
        if (cell.dataset.row !== String(r) || cell.dataset.column !== String(c))
          cell.classList.remove("editing-cell");
      });
      ctx.selected = [r, c];
      ctx.extent = [r, c];
      ctx.mode = mode;
      paint();
    };
    const clearSelection = () => {
      ctx.selected = [-1, -1];
      ctx.extent = [-1, -1];
      ctx.mode = "none";
      root.querySelectorAll(".editing-cell").forEach((cell) => cell.classList.remove("editing-cell"));
      paint();
    };
    const clearWhenOutside = (event: PointerEvent) => {
      if (!root.contains(event.target as Node)) clearSelection();
    };
    // A table's selection is visual widget state. Focus events do not cover a
    // click in the surrounding note, so clear it at capture time instead.
    window.addEventListener("pointerdown", clearWhenOutside, true);
    ctx.dispose = () => window.removeEventListener("pointerdown", clearWhenOutside, true);
    let dragging: "row" | "column" | "cell" | null = null;
    root.onpointerup = () => (dragging = null);
    const menu = (event: MouseEvent | KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const target = event.target as HTMLElement;
      const cell = target.closest<HTMLElement>("[data-row][data-column]");
      if (cell && !cell.classList.contains("table-selected"))
        select(Number(cell.dataset.row), Number(cell.dataset.column), "cell");
      if (target.dataset.selectRow !== undefined && ctx.mode !== "row")
        select(Number(target.dataset.selectRow), 0, "row");
      if (target.dataset.selectColumn !== undefined && ctx.mode !== "column")
        select(0, Number(target.dataset.selectColumn), "column");
      const [r, c] = ctx.selected;
      const rowFrom = Math.min(r, ctx.extent[0]);
      const rowTo = Math.max(r, ctx.extent[0]);
      const columnFrom = Math.min(c, ctx.extent[1]);
      const columnTo = Math.max(c, ctx.extent[1]);
      const addRow = (at: number) => {
        ctx.model.rows.splice(
          at,
          0,
          ctx.model.rows[0].map(() => ""),
        );
        ctx.model.rawRows.splice(
          at,
          0,
          ctx.model.rows[0].map(() => ""),
        );
        commit();
      };
      const addColumn = (at: number) => {
        ctx.model.rows.forEach((row) => row.splice(at, 0, ""));
        ctx.model.rawRows.forEach((row) => row.splice(at, 0, ""));
        ctx.model.alignment.splice(at, 0, "---");
        commit();
      };
      const rect = target.getBoundingClientRect();
      const detail: TableActionRequest = {
        x: "clientX" in event ? event.clientX : rect.left,
        y: "clientY" in event ? event.clientY : rect.bottom,
        trigger: target,
        index: ctx.index,
        target: (() => {
          const host = target.closest<HTMLElement>(".cell-editor");
          const editor = host && ctx.editors.get(host);
          return editor
            ? { ...codeTarget(editor), kind: "cell" as const }
            : undefined;
        })(),
        actions: [
          {
            label: "Fit to note width",
            run: () => {
              root.dispatchEvent(
                new CustomEvent("notus-table-widths", {
                  bubbles: true,
                  detail: { index: ctx.index, widths: [] },
                }),
              );
            },
          },
          { label: "Insert row above", run: () => addRow(rowFrom) },
          { label: "Insert row below", run: () => addRow(rowTo + 1) },
          { label: "Insert column left", run: () => addColumn(columnFrom) },
          { label: "Insert column right", run: () => addColumn(columnTo + 1) },
          {
            label: "Delete row",
            disabled: rowTo - rowFrom + 1 >= ctx.model.rows.length,
            run: () => {
              ctx.model.rows.splice(rowFrom, rowTo - rowFrom + 1);
              ctx.model.rawRows.splice(rowFrom, rowTo - rowFrom + 1);
              commit();
            },
          },
          {
            label: "Delete column",
            disabled: columnTo - columnFrom + 1 >= ctx.model.rows[0].length,
            run: () => {
              ctx.model.rows.forEach((row) =>
                row.splice(columnFrom, columnTo - columnFrom + 1),
              );
              ctx.model.rawRows.forEach((row) =>
                row.splice(columnFrom, columnTo - columnFrom + 1),
              );
              ctx.model.alignment.splice(columnFrom, columnTo - columnFrom + 1);
              commit();
            },
          },
          {
            label: "Align column left",
            run: () => {
              for (let column = columnFrom; column <= columnTo; column++)
                ctx.model.alignment[column] = ":---";
              commit();
            },
          },
          {
            label: "Align column center",
            run: () => {
              for (let column = columnFrom; column <= columnTo; column++)
                ctx.model.alignment[column] = ":---:";
              commit();
            },
          },
          {
            label: "Align column right",
            run: () => {
              for (let column = columnFrom; column <= columnTo; column++)
                ctx.model.alignment[column] = "---:";
              commit();
            },
          },
        ],
      };
      root.dispatchEvent(
        new CustomEvent("notus-table-actions", { bubbles: true, detail }),
      );
    };
    root.oncontextmenu = menu;
    root.onkeydown = (e) => {
      if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) menu(e);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        view.focus();
        (e.shiftKey ? redo : undo)(view);
      }
    };
    const scroller = document.createElement("div");
    scroller.className = "table-scroll";
    const table = document.createElement("table");
    table.setAttribute("aria-label", "Editable Markdown table");
    const colgroup = document.createElement("colgroup");
    const gutter = document.createElement("col");
    gutter.style.width = "18px";
    colgroup.append(gutter);
    this.model.rows[0].forEach((_, c) => {
      const col = document.createElement("col");
      col.style.width = this.widths[c] ? `${this.widths[c]}px` : "auto";
      colgroup.append(col);
    });
    table.style.width = this.widths.length
      ? `${18 + this.widths.reduce((a, b) => a + b, 0)}px`
      : "100%";
    root.style.setProperty("--table-width", table.style.width);
    table.append(colgroup);
    const selectors = document.createElement("tr");
    selectors.className = "column-selectors";
    selectors.append(document.createElement("td"));
    this.model.rows[0].forEach((_, c) => {
      const td = document.createElement("td");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "table-selector column-selector";
      b.dataset.selectColumn = String(c);
      b.title = `Select column ${c + 1} · Right-click for actions`;
      b.setAttribute("aria-label", `Select column ${c + 1}`);
      b.setAttribute("aria-pressed", "false");
      b.onpointerdown = (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        dragging = "column";
        if (e.shiftKey && ctx.mode === "column") {
          ctx.extent = [0, c];
          paint();
        } else select(0, c, "column");
      };
      b.onpointerenter = (event) => {
        if (dragging === "column" && event.buttons === 1) {
          ctx.extent = [0, c];
          paint();
        }
      };
      td.append(b);
      const resize = document.createElement("span");
      resize.className = "column-resizer";
      resize.role = "separator";
      resize.tabIndex = 0;
      resize.setAttribute("aria-label", `Resize column ${c + 1}`);
      resize.onpointerdown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const grip = e.currentTarget as HTMLElement;
        grip.setPointerCapture(e.pointerId);
        const start = e.clientX;
        const initial = [...colgroup.children]
          .slice(1)
          .map((col) => (col as HTMLElement).getBoundingClientRect().width);
        const move = (event: PointerEvent) => {
          const widths = initial.map((width, index) =>
            index === c
              ? Math.max(60, Math.min(1000, width + event.clientX - start))
              : width,
          );
          widths.forEach(
            (width, index) =>
              ((colgroup.children[index + 1] as HTMLElement).style.width =
                `${width}px`),
          );
          table.style.width = `${18 + widths.reduce((sum, width) => sum + width, 0)}px`;
          root.style.setProperty("--table-width", table.style.width);
        };
        const stop = () => {
          grip.removeEventListener("pointermove", move);
          grip.removeEventListener("pointerup", stop);
          grip.removeEventListener("pointercancel", stop);
          root.dispatchEvent(
            new CustomEvent("notus-table-widths", {
              bubbles: true,
              detail: {
                index: ctx.index,
                widths: [...colgroup.children]
                  .slice(1)
                  .map(
                    (col) => (col as HTMLElement).getBoundingClientRect().width,
                  ),
              },
            }),
          );
        };
        grip.addEventListener("pointermove", move);
        grip.addEventListener("pointerup", stop);
        grip.addEventListener("pointercancel", stop);
      };
      td.append(resize);
      selectors.append(td);
    });
    table.append(selectors);
    this.model.rows.forEach((row, r) => {
      const tr = document.createElement("tr");
      tr.className = "table-data-row";
      const handle = document.createElement("td");
      handle.className = "row-handle";
      const b = document.createElement("button");
      b.type = "button";
      b.className = "table-selector row-selector";
      b.dataset.selectRow = String(r);
      b.title = `Select ${r === 0 ? "header" : "row " + r} · Right-click for actions`;
      b.setAttribute(
        "aria-label",
        `Select ${r === 0 ? "header row" : "row " + r}`,
      );
      b.setAttribute("aria-pressed", "false");
      b.onpointerdown = (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        dragging = "row";
        if (e.shiftKey && ctx.mode === "row") {
          ctx.extent = [r, 0];
          paint();
        } else select(r, 0, "row");
      };
      b.onpointerenter = (event) => {
        if (dragging === "row" && event.buttons === 1) {
          ctx.extent = [r, 0];
          paint();
        }
      };
      handle.append(b);
      tr.append(handle);
      row.forEach((value, c) => {
        const td = document.createElement(r === 0 ? "th" : "td");
        td.dataset.row = String(r);
        td.dataset.column = String(c);
        td.style.textAlign =
          ctx.model.alignment[c]?.startsWith(":") &&
          ctx.model.alignment[c]?.endsWith(":")
            ? "center"
            : ctx.model.alignment[c]?.endsWith(":")
              ? "right"
              : "left";
        const input = document.createElement("div");
        input.className = "cell-editor";
        const activate = () => {
          td.classList.add("editing-cell");
          let editor = ctx.editors.get(input);
          if (!editor) {
            editor = new EditorView({
              parent: input,
              state: EditorState.create({
                doc: ctx.model.rows[r][c],
                extensions: [
                  markdown(),
                  inlineOnly.of(true),
                  livePreview,
                  EditorView.lineWrapping,
                  EditorView.contentAttributes.of({
                    "aria-label": `${r === 0 ? "Header" : "Row " + r}, column ${c + 1}`,
                  }),
                  keymap.of([
                    {
                      key: "Mod-b",
                      run: (v) => {
                        wrapTarget(codeTarget(v), "**");
                        return true;
                      },
                    },
                    {
                      key: "Mod-i",
                      run: (v) => {
                        wrapTarget(codeTarget(v), "*");
                        return true;
                      },
                    },
                    {
                      key: "Enter",
                      run: () => {
                        const next =
                          tr.nextElementSibling?.querySelector<HTMLElement>(
                            `[data-column="${c}"] .cell-preview`,
                          );
                        next?.click();
                        return true;
                      },
                    },
                    ...defaultKeymap,
                  ]),
                  EditorView.updateListener.of((update) => {
                    if (update.docChanged && !ctx.syncing) {
                      ctx.model.rows[r][c] = update.state.doc.toString();
                      commit();
                    }
                  }),
                ],
              }),
            });
            ctx.editors.set(input, editor);
          }
          return editor;
        };
        const preview = document.createElement("div");
        preview.className = "cell-preview";
        preview.append(inlineContent(value));
        preview.onclick = (e) => {
          if (
            ctx.selected[0] !== ctx.extent[0] ||
            ctx.selected[1] !== ctx.extent[1]
          )
            return;
          const link = (e.target as HTMLElement).closest<HTMLElement>(
            "[data-note-href]",
          );
          if (link) {
            e.preventDefault();
            e.stopPropagation();
            root.dispatchEvent(
              new CustomEvent("lotus-open-link", {
                bubbles: true,
                detail: link.dataset.noteHref,
              }),
            );
            return;
          }
          const editor = activate();
          editor.focus();
          const pos = editor.posAtCoords({ x: e.clientX, y: e.clientY });
          editor.dispatch({
            selection: { anchor: pos ?? editor.state.doc.length },
          });
        };
        input.addEventListener("focusin", () => {
          if (!dragging) select(r, c, "cell");
          td.classList.add("editing-cell");
        });
        td.onpointerdown = (e) => {
          if (
            e.button !== 0 ||
            (e.target as HTMLElement).closest(".cell-editor")
          )
            return;
          e.preventDefault();
          window.getSelection()?.removeAllRanges();
          if (e.shiftKey) {
            e.preventDefault();
            ctx.extent = [r, c];
            ctx.mode = "cell";
            paint();
          } else {
            dragging = "cell";
            select(r, c, "cell");
          }
        };
        td.onpointerenter = (e) => {
          if (dragging === "cell" && e.buttons === 1) {
            ctx.extent = [r, c];
            paint();
          }
        };
        td.append(preview, input);
        const border = document.createElement("span");
        border.className = "column-resizer cell-resizer";
        border.onpointerdown = (
          selectors.children[c + 1].querySelector(
            ".column-resizer",
          ) as HTMLElement
        ).onpointerdown;
        td.append(border);
        tr.append(td);
      });
      table.append(tr);
    });
    scroller.append(table);
    root.append(scroller);
    const grip = document.createElement("div");
    grip.className = "table-size-grip";
    grip.role = "separator";
    grip.tabIndex = 0;
    grip.setAttribute("aria-label", "Resize table");
    const saveWidths = (widths: number[]) =>
      root.dispatchEvent(
        new CustomEvent("notus-table-widths", {
          bubbles: true,
          detail: { index: ctx.index, widths },
        }),
      );
    grip.onpointerdown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      grip.setPointerCapture(e.pointerId);
      const start = e.clientX,
        initial = [...colgroup.children]
          .slice(1)
          .map((col) => (col as HTMLElement).getBoundingClientRect().width),
        total = initial.reduce((a, b) => a + b, 0);
      let widths = initial;
      const move = (p: PointerEvent) => {
        const ratio =
          Math.max(initial.length * 60, total + p.clientX - start) / total;
        widths = initial.map((w) => w * ratio);
        widths.forEach(
          (w, i) =>
            ((colgroup.children[i + 1] as HTMLElement).style.width = `${w}px`),
        );
        table.style.width = `${18 + widths.reduce((a, b) => a + b, 0)}px`;
        root.style.setProperty("--table-width", table.style.width);
      };
      const stop = () => {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", stop);
        grip.removeEventListener("pointercancel", stop);
        saveWidths(widths);
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", stop);
      grip.addEventListener("pointercancel", stop);
    };
    grip.onkeydown = (e) => {
      if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        saveWidths(
          [...colgroup.children]
            .slice(1)
            .map((col) =>
              Math.max(
                60,
                (col as HTMLElement).getBoundingClientRect().width +
                  (e.key === "ArrowLeft" ? -10 : 10),
              ),
            ),
        );
      }
    };
    root.append(grip);
    return root;
  }
  updateDOM(dom: HTMLElement, view: EditorView) {
    const ctx = contexts.get(dom);
    if (!ctx) return false;
    const inputs = dom.querySelectorAll<HTMLElement>(".cell-editor");
    if (
      dom.querySelectorAll(".table-data-row").length !==
        this.model.rows.length ||
      inputs.length !== this.model.rows.length * this.model.rows[0].length
    )
      return false;
    ctx.model = this.model;
    ctx.index = this.index;
    ctx.view = view;
    dom.classList.toggle("highlight-first-column", this.highlight);
    inputs.forEach((input, i) => {
      const value =
        this.model.rows[Math.floor(i / this.model.rows[0].length)][
          i % this.model.rows[0].length
        ];
      const editor = ctx.editors.get(input);
      if (editor && editor.state.doc.toString() !== value) {
        ctx.syncing = true;
        try {
          editor.dispatch({
            changes: { from: 0, to: editor.state.doc.length, insert: value },
          });
        } finally {
          ctx.syncing = false;
        }
      }
      const c = i % this.model.rows[0].length;
      const alignment = this.model.alignment[c];
      input.parentElement!.style.textAlign =
        alignment?.startsWith(":") && alignment?.endsWith(":")
          ? "center"
          : alignment?.endsWith(":")
            ? "right"
            : "left";
      input.previousElementSibling?.replaceChildren(inlineContent(value));
    });
    dom.querySelectorAll<HTMLElement>("colgroup col").forEach((col, i) => {
      if (i > 0)
        col.style.width = this.widths[i - 1]
          ? `${this.widths[i - 1]}px`
          : "auto";
    });
    const table = dom.querySelector("table")!;
    table.style.width = this.widths.length
      ? `${18 + this.widths.reduce((a, b) => a + b, 0)}px`
      : "100%";
    dom.style.setProperty("--table-width", table.style.width);
    return true;
  }
  destroy(dom: HTMLElement) {
    const ctx = contexts.get(dom);
    ctx?.dispose();
    ctx?.editors.forEach((editor) => editor.destroy());
    contexts.delete(dom);
  }
  ignoreEvent() {
    return true;
  }
}
function decorations(
  text: string,
  highlights: number[],
  widths: Record<number, number[]>,
) {
  return Decoration.set(
    findTables(text).map((table, index) =>
      Decoration.replace({
        widget: new TableWidget(
          table,
          index,
          highlights.includes(index),
          widths[index],
        ),
        block: true,
      }).range(table.from, table.to),
    ),
  );
}
export const tableEditing = StateField.define<DecorationSet>({
  create: (state) =>
    decorations(
      state.doc.toString(),
      state.facet(tableHighlights),
      state.facet(tableColumnWidths),
    ),
  update: (value, tr) =>
    tr.docChanged ||
    tr.startState.facet(tableHighlights) !== tr.state.facet(tableHighlights) ||
    tr.startState.facet(tableColumnWidths) !== tr.state.facet(tableColumnWidths)
      ? decorations(
          tr.state.doc.toString(),
          tr.state.facet(tableHighlights),
          tr.state.facet(tableColumnWidths),
        )
      : value,
  provide: (field) => EditorView.decorations.from(field),
});
