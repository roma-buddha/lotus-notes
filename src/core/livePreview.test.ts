import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { decorate, inlineOnly } from "../livePreview";

function dividers(text: string, cell = false) {
  const state = EditorState.create({
    doc: text,
    extensions: [markdown(), inlineOnly.of(cell)],
  });
  const { decorations } = decorate({ state });
  const result: string[] = [];
  const cursor = decorations.iter();
  while (cursor.value) {
    if (cursor.value.spec.widget?.constructor.name === "HorizontalLine")
      result.push(state.sliceDoc(cursor.from, cursor.to));
    cursor.next();
  }
  return result;
}

describe("horizontal line preview", () => {
  it("renders Markdown separators, including spaced asterisks, as line widgets", () => {
    expect(dividers("before\n\n---\n\nafter\n\n* * *\n\n___")).toEqual([
      "---",
      "* * *",
      "___",
    ]);
  });
  it("keeps code, heading underlines, and inline cell text intact", () => {
    expect(dividers("```\n---\n```\n\nHeading\n---\n\n    ---")).toEqual([]);
    expect(dividers("---", true)).toEqual([]);
  });
});
