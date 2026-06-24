import { describe, it, expect } from "vitest";
import { isResidueKey } from "./typing";

describe("isResidueKey", () => {
  it("accepts letters in either case (case is preserved by the caller)", () => {
    for (const k of ["A", "C", "G", "T", "U", "N", "a", "c", "g", "t", "n", "z", "Z"]) {
      expect(isResidueKey(k)).toBe(true);
    }
  });

  it("accepts the gap and special residue glyphs", () => {
    for (const k of ["-", ".", "*", "?"]) {
      expect(isResidueKey(k)).toBe(true);
    }
  });

  it("rejects multi-character key names (nav / control keys)", () => {
    for (const k of [
      "Enter",
      "ArrowUp",
      "ArrowLeft",
      "Backspace",
      "Delete",
      "Tab",
      "Shift",
      "Escape",
      "Home",
      "PageDown",
      "Insert",
    ]) {
      expect(isResidueKey(k)).toBe(false);
    }
  });

  it("rejects whitespace, digits, and punctuation outside the residue set", () => {
    for (const k of [" ", "0", "9", ",", "/", "(", ")", "+", "=", ";", "\n"]) {
      expect(isResidueKey(k)).toBe(false);
    }
  });

  it("rejects the empty string", () => {
    expect(isResidueKey("")).toBe(false);
  });
});
