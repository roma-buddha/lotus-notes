import { MermaidDiagram } from "./MermaidDiagram";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { findTables } from "./core/tables";
import type { NoteAppearance } from "./noteAppearance";
import { displayColor } from "./inlineContent";
import { remarkExtras } from "./remarkExtras";
import remarkMath from "remark-math";
import { useEffect, useState } from "react";
import type { Root, Element } from "hast";
// Sanitize source styles before trusted KaTeX creates its layout spans.
function safeSourceStyles() {
  return (tree: Root) => {
    const visit = (node: Root | Element) => {
      if (node.type === "element" && node.properties.style) {
        const match = String(node.properties.style).match(
          /^\s*color:\s*(#[\da-f]{6})\s*;?\s*$/i,
        );
        if (match) node.properties.style = `color: ${displayColor(match[1])}`;
        else delete node.properties.style;
      }
      for (const child of node.children)
        if (child.type === "element") visit(child);
    };
    visit(tree);
  };
}
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    span: [...(defaultSchema.attributes?.span ?? []), "style"],
    blockquote: [["className", "lotus-callout"]],
    p: [["className", "callout-title"]],
    code: [["className", /^language-./, "math-inline", "math-display"]],
  },
};
export function MarkdownView({
  content,
  identity,
  appearance,
  openLink,
}: {
  content: string;
  identity: string;
  appearance: NoteAppearance;
  openLink: (href: string) => void;
}) {
  const [math, setMath] = useState<typeof import("./mathSupport") | null>(null);
  const [mathError, setMathError] = useState(false);
  const needsMath = content.includes("$");
  useEffect(() => {
    if (!needsMath || math) return;
    let cancelled = false;
    void import("./mathSupport")
      .then((value) => {
        if (!cancelled) setMath(value);
      })
      .catch(() => {
        if (!cancelled) setMathError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [needsMath, math]);
  const tables = findTables(content);
  const diagrams = [
    ...content.matchAll(/^(`{3,}|~{3,})mermaid[^\S\n]*\r?\n/gm),
  ].map((m) => m.index);
  return (
    <article className="reading">
      {mathError && (
        <p role="status">
          Math rendering could not load. Reopen Lotus to retry.
        </p>
      )}
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkExtras, remarkMath]}
        rehypePlugins={[
          rehypeRaw,
          safeSourceStyles,
          [rehypeSanitize, schema],
          ...(math ? [math.default] : []),
        ]}
        components={{
          p: ({ node, children }) => {
            const raw = content.slice(
              node?.position?.start.offset ?? 0,
              node?.position?.end.offset ?? 0,
            );
            return (
              <p
                className={
                  /[A-Za-z]:\\|file:\/\/|(?:https?:\/\/|www\.)\S{40}/.test(raw)
                    ? "source-path"
                    : String(node?.properties.className ?? "")
                }
              >
                {children}
              </p>
            );
          },
          pre: ({ node, children }) => {
            const code = node?.children[0];
            if (
              code?.type === "element" &&
              Array.isArray(code.properties.className) &&
              code.properties.className.includes("language-mermaid")
            ) {
              const source = code.children
                .map((n) => (n.type === "text" ? n.value : ""))
                .join("");
              return (
                <MermaidDiagram
                  source={source}
                  preferenceKey={`${identity}:${Math.max(0, diagrams.indexOf(node?.position?.start.offset ?? -1))}`}
                />
              );
            }
            return <pre>{children}</pre>;
          },
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                if (href) openLink(href);
              }}
            >
              {children}
            </a>
          ),
          table: ({ node, children }) => {
            const index = tables.findIndex(
              (t) => t.from === node?.position?.start.offset,
            );
            const count = tables[index]?.rows[0].length ?? 1;
            const widths = Array.from(
              { length: count },
              (_, i) => appearance.widths[index]?.[i] || 220,
            );
            return (
              <div className="table-scroll">
                <table
                  className={
                    appearance.highlights.includes(index)
                      ? "highlight-first-column"
                      : undefined
                  }
                  style={{
                    tableLayout: "fixed",
                    width: appearance.widths[index]?.length
                      ? widths.reduce((a, b) => a + b, 0)
                      : "100%",
                    minWidth: 0,
                  }}
                >
                  <colgroup>
                    {widths.map((width, i) => (
                      <col
                        key={i}
                        style={{
                          width: appearance.widths[index]?.length
                            ? width
                            : `${100 / count}%`,
                        }}
                      />
                    ))}
                  </colgroup>
                  {children}
                </table>
              </div>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}
