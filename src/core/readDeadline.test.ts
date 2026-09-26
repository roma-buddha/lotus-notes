import { describe, expect, it, vi } from "vitest";
import { readDeadline } from "../readDeadline";
describe("note read recovery", () => {
  it("releases a stalled navigation and ignores its late result", async () => {
    vi.useFakeTimers();
    let finish!: (value: string) => void;
    const read = readDeadline(
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
    );
    const rejected = expect(read).rejects.toThrow("Select the note again");
    await vi.advanceTimersByTimeAsync(10000);
    await rejected;
    finish("obsolete");
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});
