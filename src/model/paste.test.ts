import { describe, expect, it } from "vitest";
import { looksLikeFasta, parseClipboard } from "./paste";

describe("parseClipboard", () => {
  it("splits raw residue lines", () => {
    expect(parseClipboard("ACGT\nTTTT")).toEqual(["ACGT", "TTTT"]);
  });

  it("handles Windows CRLF newlines", () => {
    expect(parseClipboard("ACGT\r\nTTTT")).toEqual(["ACGT", "TTTT"]);
  });

  it("drops FASTA headers so this app's unwrapped FASTA copy round-trips", () => {
    expect(parseClipboard(">a\nACGT\n>b\nTTTT")).toEqual(["ACGT", "TTTT"]);
  });

  it("drops trailing blank lines but keeps internal ones (row positions hold)", () => {
    expect(parseClipboard("ACGT\n\nTTTT\n")).toEqual(["ACGT", "", "TTTT"]);
  });

  it("treats empty or all-blank text as no lines", () => {
    expect(parseClipboard("")).toEqual([]);
    expect(parseClipboard("\n\n")).toEqual([]);
  });
});

describe("looksLikeFasta", () => {
  it("is true when the first non-blank line is a header", () => {
    expect(looksLikeFasta(">a\nACGT")).toBe(true);
    expect(looksLikeFasta("\n\n  \n>a\nACGT")).toBe(true); // leading blanks skipped
  });

  it("is false for a raw residue block", () => {
    expect(looksLikeFasta("ACGT\nTTTT")).toBe(false);
    expect(looksLikeFasta("")).toBe(false);
    // A `>` only mid-block (not the first non-blank line) is NOT FASTA.
    expect(looksLikeFasta("ACGT\n>a\nTTTT")).toBe(false);
  });
});
