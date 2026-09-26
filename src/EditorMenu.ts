import {
  colorTarget,
  clearTarget,
  lineTarget,
  wrapTarget,
  blockTarget,
  type EditTarget,
} from "./editTarget";
import { palette } from "./inlineContent";
import type { MenuItem } from "./ContextMenu";
import { api } from "./notus";
export function editorItems(
  target: EditTarget | null,
  options: {
    locked: boolean;
    lock: () => void;
    bookmarked: boolean;
    bookmark: () => void;
    link: () => void;
    table: () => void;
    search: (text: string) => void;
    error: (text: string) => void;
  },
): MenuItem[] {
  const text = target?.text.slice(target.from, target.to) ?? "";
  const editing = options.locked || !target;
  const enclosingLink =
    target &&
    [
      ...target.text.matchAll(
        /\[([^\]]+)\]\(([^)]+)\)|\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      ),
    ].find(
      (m) => m.index! <= target.from && m.index! + m[0].length >= target.to,
    );
  const wrap = (label: string, before: string, after = before): MenuItem => ({
    label,
    disabled: editing,
    run: () => target && wrapTarget(target, before, after),
  });
  const line = (
    label: string,
    prefix: string | ((i: number) => string),
  ): MenuItem => ({
    label,
    disabled: editing,
    run: () => target && lineTarget(target, prefix),
  });
  const paste = () => {
    if (target)
      void api
        .readClipboard()
        .then((value) => target.replace(target.from, target.to, value))
        .catch((e) => options.error(String(e)));
  };
  return [
    {
      label: "Format",
      disabled: editing,
      children: [
        wrap("Bold", "**"),
        wrap("Italic", "*"),
        wrap("Strikethrough", "~~"),
        wrap("Highlight", "=="),
        wrap("Inline code", "`"),
        wrap("Math", "$"),
        wrap("Comment", "%%"),
        { label: "Clear formatting", run: () => target && clearTarget(target) },
      ],
    },
    {
      label: "Text color",
      disabled: editing,
      children: [
        ...palette.map(([label, color]) => ({
          label,
          run: () => target && colorTarget(target, color),
        })),
        {
          label: "Default color",
          run: () => target && colorTarget(target),
        },
      ],
    },
    {
      label: "Paragraph",
      disabled: editing || target?.kind === "cell",
      children: [
        line("Bullet list", "- "),
        line("Numbered list", (i) => `${i + 1}. `),
        line("Task list", "- [ ] "),
        ...[1, 2, 3, 4, 5, 6].map((n) =>
          line(`Heading ${n}`, "#".repeat(n) + " "),
        ),
        line("Body", ""),
        line("Quote", "> "),
      ],
    },
    {
      label: "Insert",
      disabled: editing,
      children: [
        {
          label: "Link",
          children: [
            {
              label: "Add link…",
              disabled: editing || !!enclosingLink,
              run: options.link,
            },
            {
              label: "Edit link…",
              disabled: editing || !enclosingLink,
              run: options.link,
            },
            {
              label: "Remove link",
              disabled: editing || !enclosingLink,
              run: () => {
                if (!target) return;
                const pattern =
                  /\[([^\]]+)\]\(([^)]+)\)|\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
                const match = [...target.text.matchAll(pattern)].find(
                  (m) =>
                    m.index! <= target.from &&
                    m.index! + m[0].length >= target.to,
                );
                if (match)
                  target.replace(
                    match.index!,
                    match.index! + match[0].length,
                    match[1] || match[4] || match[3],
                  );
              },
            },
          ],
        },
        {
          label: "Table…",
          disabled: target?.kind === "cell",
          run: options.table,
        },
        {
          label: "Callout",
          disabled: target?.kind === "cell",
          run: () => target && blockTarget(target, "callout"),
        },
        {
          label: "Horizontal line",
          disabled: target?.kind === "cell",
          run: () => target && blockTarget(target, "rule"),
        },
      ],
    },
    {
      label: "Cut",
      separator: true,
      disabled: editing || !text,
      run: () => {
        if (target)
          void api
            .writeClipboard(text)
            .then(() => target.replace(target.from, target.to, ""))
            .catch((e) => options.error(String(e)));
      },
    },
    {
      label: "Copy",
      disabled: !text,
      run: () => {
        void api.writeClipboard(text).catch((e) => options.error(String(e)));
      },
    },
    { label: "Paste", disabled: editing, run: paste },
    { label: "Paste as plain text", disabled: editing, run: paste },
    { label: "Select all", disabled: !target, run: () => target?.selectAll() },
  ];
}
