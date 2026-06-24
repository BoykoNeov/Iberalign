import { describe, expect, it } from "vitest";
import { parseClipboard } from "./paste";

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
