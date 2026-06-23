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

describe("AlignmentView.replaceContents", () => {
  it("overwrites the buffer contents in place (same object, new bytes)", () => {
    const view = viewFrom(["ACGT", "TTTT"]);
    const original = view.buffer; // identity must be preserved (in-place mutation)
    const next = new TextEncoder().encode("A--TGGGG"); // post-edit: row0 masked
    view.replaceContents(next);
    expect(view.buffer).toBe(original);
    expect(decode(view.rowSlice(0))).toBe("A--T");
    expect(decode(view.rowSlice(1))).toBe("GGGG");
  });

  it("throws on a length mismatch (width-changing edit must rebuild)", () => {
    const view = viewFrom(["ACGT", "TTTT"]);
    expect(() => view.replaceContents(new Uint8Array(4))).toThrow(/length/);
    // The original contents are untouched after a rejected patch.
    expect(decode(view.rowSlice(0))).toBe("ACGT");
  });
});
