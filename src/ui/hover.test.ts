// Tests for the hover pipeline's NEW logic: resolving a grid-canvas cursor pixel
// to the right cell under a *scrolled and zoomed* viewport, the edge/off-content
// guards, and that the readout wires through to the engine's gap/position
// semantics. The col→ungapped rules themselves are the authority of
// `coords.test.ts` (parity vs `coords.rs`); here we only confirm the pipeline
// picks the correct cell from pixels and forwards one residue / one gap result —
// the part `coords.test.ts` can't see.

import { describe, it, expect } from "vitest";
import { AlignmentView } from "../model/view";
import type { AlignmentMeta } from "../model/types";
import { initViewport, type Viewport } from "../state/viewport";
import { computeHover } from "./hover";

/** Build a view from equal-length row strings (names `r0`, `r1`, …). */
function viewOf(rows: string[]): AlignmentView {
  const width = rows[0]?.length ?? 0;
  const buffer = new Uint8Array(width * rows.length);
  rows.forEach((r, i) => buffer.set(new TextEncoder().encode(r), i * width));
  const meta: AlignmentMeta = {
    width,
    numRows: rows.length,
    names: rows.map((_, i) => `r${i}`),
    alphabet: "DNA",
  };
  return new AlignmentView(buffer, meta);
}

//             col:  0    1    2    3    4    5
const view = viewOf([
  "A-CG-T", // r0: interior gaps
  "--AC--", // r1: leading + trailing gaps
  "ACGTTG", // r2: no gaps
]);

/** A viewport with explicit scroll/zoom over a 100×100 drawing area. */
function vp(over: Partial<Viewport>): Viewport {
  return { ...initViewport(100, 100), cellW: 10, cellH: 10, ...over };
}

describe("computeHover — pixel → cell under scroll/zoom", () => {
  it("maps a pixel to the scrolled cell and reads the residue", () => {
    // scrollX 20 = 2 cols, scrollY 10 = 1 row. (5,5) → col 2, row 1 = r1 'A'.
    const h = computeHover(view, vp({ scrollX: 20, scrollY: 10 }), 5, 5);
    expect(h).not.toBeNull();
    expect(h!.row).toBe(1);
    expect(h!.col).toBe(2);
    expect(h!.name).toBe("r1");
    expect(h!.residue).toBe("A");
    expect(h!.isGap).toBe(false);
    expect(h!.pos).toBe(1); // first residue of "--AC--"
  });

  it("reports a gap column with pos null", () => {
    // scrollX 20, (35,5) → col floor((35+20)/10)=5, row 1 = r1 trailing gap.
    const h = computeHover(view, vp({ scrollX: 20, scrollY: 10 }), 35, 5);
    expect(h).not.toBeNull();
    expect(h!.col).toBe(5);
    expect(h!.isGap).toBe(true);
    expect(h!.residue).toBe("-");
    expect(h!.pos).toBeNull();
  });

  it("accounts for zoom (cell size) when picking the column", () => {
    // cellW 20, no scroll: (45,5) → col floor(45/20)=2, row 0 = r0 'C', pos 2.
    const h = computeHover(view, vp({ cellW: 20, cellH: 20 }), 45, 5);
    expect(h!.col).toBe(2);
    expect(h!.row).toBe(0);
    expect(h!.residue).toBe("C");
    expect(h!.pos).toBe(2);
  });
});

describe("computeHover — edge and off-content guards", () => {
  it("returns null outside the drawing area", () => {
    expect(computeHover(view, vp({}), -1, 5)).toBeNull();
    expect(computeHover(view, vp({}), 5, -1)).toBeNull();
    expect(computeHover(view, vp({}), 100, 5)).toBeNull(); // ax === viewW
    expect(computeHover(view, vp({}), 5, 100)).toBeNull(); // ay === viewH
  });

  it("returns null in the overscan past the last column/row", () => {
    // scrollX 20 + ax 45 → col 6 (width is 6) → off content.
    expect(computeHover(view, vp({ scrollX: 20 }), 45, 5)).toBeNull();
    // scrollY 10 + ay 25 → row 3 (numRows is 3) → off content.
    expect(computeHover(view, vp({ scrollY: 10 }), 5, 25)).toBeNull();
  });
});
