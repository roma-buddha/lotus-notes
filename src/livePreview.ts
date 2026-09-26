import { Facet, type Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { findTables } from "./core/tables";
import { displayColor } from "./inlineContent";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
export const inlineOnly = Facet.define<boolean, boolean>({
  combine: (values) => values[0] ?? false,
});
class ListMarker extends WidgetType {
  constructor(readonly label: string) {
    super();
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-live-list-marker";
    span.textContent = this.label;
    return span;
  }
}
class HorizontalLine extends WidgetType {
  toDOM() {
    const line = document.createElement("span");
    line.className = "cm-horizontal-line";
    line.setAttribute("role", "separator");
    line.setAttribute("aria-label", "Horizontal line");
    return line;
  }
}
export function decorate(view: Pick<EditorView, "state">) {
  const ranges: Range<Decoration>[] = [],
    hidden: Range<Decoration>[] = [];
  const hide = (from: number, to: number, widget?: WidgetType) => {
    if (to > from) hidden.push(Decoration.replace({ widget }).range(from, to));
  };
  const mark = (
    from: number,
    to: number,
    className: string,
    attributes?: Record<string, string>,
  ) => {
    if (to > from)
      ranges.push(
        Decoration.mark({ class: className, attributes }).range(from, to),
      );
  };
  const tables = view.state.facet(inlineOnly)
    ? []
    : findTables(view.state.doc.toString());
  const blocked = (at: number) => tables.some((t) => at >= t.from && at < t.to);
  const horizontalLines = new Set<number>();
  syntaxTree(view.state).iterate({
    enter(node) {
      if (blocked(node.from)) return false;
      const name = node.name;
      if (name === "HorizontalRule" && !view.state.facet(inlineOnly)) {
        hide(node.from, node.to, new HorizontalLine());
        horizontalLines.add(view.state.doc.lineAt(node.from).from);
        return false;
      }
      if (name === "FencedCode" || name === "CodeBlock") return false;
      if (["EmphasisMark", "CodeMark", "StrikethroughMark"].includes(name))
        hide(node.from, node.to);
      const style: Record<string, string> = {
        StrongEmphasis: "cm-visual-bold",
        Emphasis: "cm-visual-italic",
        InlineCode: "cm-visual-code",
        Strikethrough: "cm-visual-strike",
      };
      if (style[name]) mark(node.from, node.to, style[name]);
    },
  });
  let fenced = false,
    callout = false;
  for (let n = 1; n <= view.state.doc.lines; n++) {
    const line = view.state.doc.line(n);
    if (/^\s*(```|~~~)/.test(line.text)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || blocked(line.from) || horizontalLines.has(line.from))
      continue;
    const heading = line.text.match(/^(#{1,6})\s+/);
    if (heading && !view.state.facet(inlineOnly)) {
      ranges.push(
        Decoration.line({
          class: `cm-live-heading cm-live-h${heading[1].length}`,
        }).range(line.from),
      );
      hide(line.from, line.from + heading[0].length);
    }
    const quote = line.text.match(/^\s*>\s?/),
      title = line.text.match(/^\s*>\s*\[!([\w-]+)\][+-]?\s*/);
    if (title) callout = true;
    else if (!quote) callout = false;
    if (quote && !view.state.facet(inlineOnly)) {
      ranges.push(
        Decoration.line({
          class: callout
            ? `cm-callout ${title ? "cm-callout-title" : "cm-callout-body"} ${n === view.state.doc.lines || !/^\s*>/.test(view.state.doc.line(n + 1).text) ? "cm-callout-end" : ""}`
            : "cm-visual-quote",
        }).range(line.from),
      );
      hide(
        line.from,
        line.from + (title?.[0].length ?? quote[0].length),
        title ? new ListMarker("✎") : undefined,
      );
    }
    for (const match of line.text.matchAll(
      /<span\s+style=['"]color:\s*(#[\da-f]{6})\s*;?['"]>([\s\S]*?)<\/span>/gi,
    )) {
      const start = line.from + match.index!,
        open = match[0].indexOf(">") + 1;
      hide(start, start + open);
      mark(start + open, start + open + match[2].length, "cm-inline-color", {
        style: `color:${displayColor(match[1])} !important`,
      });
      hide(start + open + match[2].length, start + match[0].length);
    }
    for (const match of line.text.matchAll(
      /\[([^\]]+)\]\(([^)]+)\)|\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    )) {
      const start = line.from + match.index!,
        label = match[1] || match[4] || match[3],
        href = match[2] || match[3],
        prefix = match[1] ? 1 : match[4] ? match[0].indexOf("|") + 1 : 2;
      hide(start, start + prefix);
      mark(start + prefix, start + prefix + label.length, "cm-note-link", {
        "data-note-href": href,
        title: "Ctrl+click to open link",
      });
      hide(start + prefix + label.length, start + match[0].length);
    }
    for (const match of line.text.matchAll(/(==|%%)(.+?)\1/g)) {
      const start = line.from + match.index!;
      if (match[1] === "%%") hide(start, start + match[0].length);
      else {
        hide(start, start + 2);
        mark(start + 2, start + match[0].length - 2, "cm-visual-highlight");
        hide(start + match[0].length - 2, start + match[0].length);
      }
    }
    const list = line.text.match(/^(\s*)([-+*]|\d+\.)\s+/);
    if (list && !view.state.facet(inlineOnly)) {
      const gutter = Math.max(1.5, list[2].length * 0.65 + 0.5);
      ranges.push(
        Decoration.line({
          class: "cm-hanging-list",
          attributes: {
            style: `padding-left:calc(${list[1].replace(/\t/g, "    ").length}ch + ${gutter}em);text-indent:-${gutter}em;--list-gutter:${gutter}em;`,
          },
        }).range(line.from),
      );
      hide(
        line.from,
        line.from + list[0].length,
        new ListMarker(/^\d/.test(list[2]) ? list[2] : "•"),
      );
    }
  }
  const unique = hidden.filter(
    (r, i) =>
      !hidden.slice(0, i).some((p) => p.from === r.from && p.to === r.to),
  );
  return {
    decorations: Decoration.set([...ranges, ...unique], true),
    atomic: Decoration.set(unique, true),
  };
}
export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomic: DecorationSet;
    constructor(view: EditorView) {
      const next = decorate(view);
      this.decorations = next.decorations;
      this.atomic = next.atomic;
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        const next = decorate(update.view);
        this.decorations = next.decorations;
        this.atomic = next.atomic;
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of(
        (view) => view.plugin(plugin)?.atomic ?? Decoration.none,
      ),
  },
);
