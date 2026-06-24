import { describe, expect, it } from "vitest";
import { looksLikeFasta, parseClipboard, pasteAlphabetWarning } from "./paste";

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

describe("pasteAlphabetWarning", () => {
  it("flags non-nucleotide letters in a DNA alignment, with a sample + count", () => {
    // E, F, P are not nucleotide letters; the message counts all 3 and samples them.
    const msg = pasteAlphabetWarning(["ACGTEFP"], "DNA");
    expect(msg).toBe("3 residues outside the DNA alphabet (e.g. E, F, P)");
  });

  it("singular for a single offending residue", () => {
    expect(pasteAlphabetWarning(["ACGTX"], "DNA")).toBe(
      "1 residue outside the DNA alphabet (e.g. X)",
    );
  });

  it("accepts the IUPAC nucleotide set, gaps, case, and stray symbols", () => {
    // Ambiguity codes (R/Y/N), gaps, lowercase soft-masking, and `*`/digits are
    // all fine in a nucleotide alignment → no warning.
    expect(pasteAlphabetWarning(["ACGT-RYN", "acgt-n", "AC*GT9"], "DNA")).toBeNull();
  });

  it("treats U as nucleic in an RNA alignment", () => {
    expect(pasteAlphabetWarning(["ACGU-N"], "RNA")).toBeNull();
    expect(pasteAlphabetWarning(["ACGUZ"], "RNA")).toBe(
      "1 residue outside the RNA alphabet (e.g. Z)",
    );
  });

  it("never warns for a Protein alignment (every letter is valid)", () => {
    expect(pasteAlphabetWarning(["WERYDFPIK"], "Protein")).toBeNull();
  });

  it("caps the distinct-letter sample at four", () => {
    const msg = pasteAlphabetWarning(["EFPQZJ"], "DNA");
    // All six letters are off-alphabet; the sample keeps the first four DISTINCT
    // encountered (E, F, P, Q — Z/J arrive after the cap), sorted; the count
    // reflects all six.
    expect(msg).toBe("6 residues outside the DNA alphabet (e.g. E, F, P, Q)");
  });
});
