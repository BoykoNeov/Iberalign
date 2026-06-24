import { describe, it, expect } from "vitest";
import { AlignmentView } from "./view";
import type { AlignmentMeta } from "./types";

function viewFrom(rows: string[]): AlignmentView {
  const width = rows[0]?.length ?? 0;
  const buffer = new Uint8Array(width * rows.length);
  rows.forEach((r, i) => buffer.set(new TextEncoder().encode(r), i * width));
  const meta: AlignmentMeta = {
    width,
    numRows: rows.length,
    names: rows.map((_, i) => `seq${i}`),
    alphabet: "DNA",
  };
  return new AlignmentView(buffer, meta);
}

const decode = (b: Uint8Array) => new TextDecoder().decode(b);

describe("AlignmentView.resizeContents", () => {
  it("swaps in a same-width post-edit buffer (width unchanged)", () => {
    const view = viewFrom(["ACGT", "TTTT"]);
    view.resizeContents(new TextEncoder().encode("A--TGGGG")); // 8 = 2 rows × 4
    expect(view.width).toBe(4);
    expect(decode(view.rowSlice(0))).toBe("A--T");
    expect(decode(view.rowSlice(1))).toBe("GGGG");
  });

  it("derives a new width from a width-changing (insert) buffer", () => {
    const view = viewFrom(["ACGT", "TTTT"]);
    // Post shift-only paste-insert: each row is now 6 wide (12 = 2 rows × 6).
    view.resizeContents(new TextEncoder().encode("AGGCGTTTTT--"));
    expect(view.width).toBe(6);
    expect(view.numRows).toBe(2);
    expect(decode(view.rowSlice(0))).toBe("AGGCGT");
    expect(decode(view.rowSlice(1))).toBe("TTTT--");
  });

  it("throws when the length isn't a whole number of rows", () => {
    const view = viewFrom(["ACGT", "TTTT"]);
    expect(() => view.resizeContents(new Uint8Array(5))).toThrow(/whole number of rows/);
    // The original contents + width are untouched after a rejected swap.
    expect(view.width).toBe(4);
    expect(decode(view.rowSlice(0))).toBe("ACGT");
  });
});
