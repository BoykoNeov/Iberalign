// LOD tier boundaries. Pinning the thresholds so a renderer change can't quietly
// shift when letters appear or when the grid drops to the density aggregate.

import { describe, it, expect } from "vitest";
import { lodFor, LETTER_MIN_PX, BLOCK_MIN_PX } from "./lod";

describe("lodFor", () => {
  it("is 'letter' at and above the letter threshold", () => {
    expect(lodFor(LETTER_MIN_PX)).toBe("letter");
    expect(lodFor(14)).toBe("letter");
    expect(lodFor(32)).toBe("letter");
  });

  it("is 'block' between the block and letter thresholds", () => {
    expect(lodFor(BLOCK_MIN_PX)).toBe("block");
    expect(lodFor(LETTER_MIN_PX - 0.01)).toBe("block");
    expect(lodFor(5)).toBe("block");
  });

  it("is 'density' below the block threshold", () => {
    expect(lodFor(BLOCK_MIN_PX - 0.01)).toBe("density");
    expect(lodFor(1)).toBe("density");
  });
});
