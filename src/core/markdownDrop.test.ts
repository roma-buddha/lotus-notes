import { describe, expect, it } from "vitest";
import { markdownDropTarget, type DropRegion } from "./markdownDrop";

const regions: DropRegion[] = [
  { path: "Work", folder: false, left: 0, right: 200, top: 50, bottom: 500 },
  {
    path: "Work/Ideas",
    folder: true,
    left: 0,
    right: 200,
    top: 80,
    bottom: 110,
  },
  {
    path: "Personal",
    folder: false,
    left: 220,
    right: 400,
    top: 0,
    bottom: 40,
  },
];
describe("Markdown drop destinations", () => {
  it("uses the active vault for empty sidebar space", () => {
    expect(markdownDropTarget({ x: 50, y: 400 }, 1, regions)).toBe("Work");
  });
  it("prefers the folder row at high DPI", () => {
    expect(markdownDropTarget({ x: 100, y: 190 }, 2, regions)).toBe(
      "Work/Ideas",
    );
  });
  it("accepts a vault picker destination", () => {
    expect(markdownDropTarget({ x: 250, y: 20 }, 1, regions)).toBe("Personal");
  });
  it("rejects drops outside the sidebar and invisible regions", () => {
    expect(markdownDropTarget({ x: 600, y: 600 }, 1, regions)).toBe("");
    expect(
      markdownDropTarget({ x: 0, y: 0 }, 1, [
        { path: "Hidden", folder: true, left: 0, right: 0, top: 0, bottom: 0 },
      ]),
    ).toBe("");
  });
});
