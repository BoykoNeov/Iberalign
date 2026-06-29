// Tests for horizontal fill-run merging — the one piece of draw logic with real
// off-by-one risk (run boundaries, the final flush, zero-width absorption). Pure,
// so it's exercisable without a canvas; a boundary slip here would show as
// cracked or overlapping cell fills only at the manual fps smoke, far too late.

import { describe, it, expect } from "vitest";
import { forEachFillRun } from "./runs";

interface Run {
  x0: number;
  width: number;
  style: string;
}

// Drive `forEachFillRun` over a whole row (colFirst 0, base 0) and collect runs.
function runsOf(bytes: number[], xs: number[]): Run[] {
  const out: Run[] = [];
  forEachFillRun(
    Uint8Array.from(bytes),
    0,
    0,
    bytes.length,
    Int32Array.from(xs),
    (b) => String.fromCharCode(b),
    (x0, width, style) => out.push({ x0, width, style }),
  );
  return out;
}

describe("forEachFillRun", () => {
  it("coalesces a uniform row into one span covering the whole window", () => {
    expect(runsOf([65, 65, 65], [0, 10, 20, 30])).toEqual([{ x0: 0, width: 30, style: "A" }]);
  });

  it("emits one span per cell when every color differs", () => {
    expect(runsOf([65, 66, 67], [0, 10, 20, 30])).toEqual([
      { x0: 0, width: 10, style: "A" },
      { x0: 10, width: 10, style: "B" },
      { x0: 20, width: 10, style: "C" },
    ]);
  });

  it("merges a trailing run and ends it at the window's right edge", () => {
    // A B B → A spans one cell, B spans the rest to xs[nCols].
    expect(runsOf([65, 66, 66], [0, 10, 20, 30])).toEqual([
      { x0: 0, width: 10, style: "A" },
      { x0: 10, width: 20, style: "B" },
    ]);
  });

  it("absorbs a zero-width cell into the surrounding run", () => {
    // Column 1 has equal edges (xs[1] === xs[2]) → skipped; A then C only.
    expect(runsOf([65, 66, 67], [0, 10, 10, 30])).toEqual([
      { x0: 0, width: 10, style: "A" },
      { x0: 10, width: 20, style: "C" },
    ]);
  });

  it("honors colFirst/base offsets into the buffer", () => {
    const out: Run[] = [];
    // bytes: [X, A, A]; start at colFirst 1 with base 0 → two A cells merge.
    forEachFillRun(
      Uint8Array.from([88, 65, 65]),
      0,
      1,
      2,
      Int32Array.from([0, 10, 20]),
      (b) => String.fromCharCode(b),
      (x0, width, style) => out.push({ x0, width, style }),
    );
    expect(out).toEqual([{ x0: 0, width: 20, style: "A" }]);
  });

  it("emits nothing for an empty window", () => {
    expect(runsOf([], [0])).toEqual([]);
  });

  it("passes the ABSOLUTE column to styleFor (column-dependent coloring)", () => {
    // A column-keyed style: even columns 'lo', odd columns 'hi' — independent of the
    // byte. With colFirst 2 the first visible cell is absolute column 2 (even → lo).
    const out: Run[] = [];
    forEachFillRun(
      Uint8Array.from([65, 65, 65, 65]), // all 'A'
      0,
      2, // colFirst → absolute cols 2, 3
      2,
      Int32Array.from([0, 10, 20]),
      (_b, col) => (col % 2 === 0 ? "lo" : "hi"),
      (x0, width, style) => out.push({ x0, width, style }),
    );
    // col2 → lo, col3 → hi: two distinct spans despite identical bytes.
    expect(out).toEqual([
      { x0: 0, width: 10, style: "lo" },
      { x0: 10, width: 10, style: "hi" },
    ]);
  });
});
