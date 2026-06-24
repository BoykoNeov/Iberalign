// Parse clipboard text into the block of residue rows a paste applies. Pure +
// tested, the read-side mirror of `model/copy.ts`. C1 scope (overwrite):
//   - split into lines on CRLF or LF (Windows clipboards use `\r\n`),
//   - drop FASTA `>` header lines — this app's FASTA copy is UNWRAPPED (one
//     residue line per sequence), so dropping headers makes a FASTA copy→paste
//     round-trip cleanly back into the same columns, same as a Raw copy,
//   - drop trailing blank lines (a trailing newline), but KEEP internal blanks:
//     in a block paste a blank line means "leave that row unchanged", so it must
//     hold its row position.
// Wrapped external FASTA (residues split across several lines per sequence) is a
// later concern (Batch C4), where a real FASTA parse joins the wrapped lines.

/** Split clipboard text into the residue lines to paste (see the module note). */
export function parseClipboard(text: string): string[] {
  const lines = text.split(/\r?\n/).filter((line) => !line.startsWith(">"));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Largest clipboard text (in characters) a paste will process. Above this a
 * paste would build an enormous block / very wide row and freeze the UI, so the
 * caller warns instead of pasting. Mirrors {@link COPY_CELL_CAP} on the read
 * side — one pasted character is at most one cell, so the same order of
 * magnitude. Far above any real paste (the design target is far smaller than the
 * stress ceiling).
 */
export const PASTE_TEXT_CAP = 10_000_000;

// Residue letters (uppercased) accepted without warning for a nucleotide
// alignment — the IUPAC nucleotide set `Alphabet::infer` treats as nucleic
// (A C G T U N plus the ambiguity codes). A Protein alignment accepts every
// letter, so it never warns (see `pasteAlphabetWarning`).
const NUCLEIC_LETTERS = new Set("ACGTUNRYSWKMBDHV".split(""));

/**
 * Advisory warning for residue LETTERS in `lines` that fall outside the
 * alignment's `alphabet`, or null when there's nothing to flag. The decision is
 * **warn, never reject** — the user may legitimately paste masked or foreign
 * data — so the caller shows this alongside the paste, it never blocks it.
 *
 * Only DNA/RNA alignments flag (non-nucleotide letters, e.g. protein residues
 * pasted into a DNA alignment — the high-value mistake to surface); a Protein
 * alignment accepts every letter, so it returns null. Gaps and any non-letter
 * (`*`, digits, punctuation, whitespace) are ignored — the check is about
 * wrong-alphabet residue letters, not stray symbols. Case is folded first
 * (lowercase soft-masking classifies the same as uppercase).
 */
export function pasteAlphabetWarning(lines: string[], alphabet: string): string | null {
  if (alphabet !== "DNA" && alphabet !== "RNA") return null; // Protein/other: never warn
  let count = 0;
  const sample = new Set<string>();
  for (const line of lines) {
    for (const ch of line) {
      const u = ch.toUpperCase();
      if (u < "A" || u > "Z") continue; // letters only — skip gaps, `*`, digits, whitespace
      if (NUCLEIC_LETTERS.has(u)) continue;
      count++;
      if (sample.size < 4) sample.add(u);
    }
  }
  if (count === 0) return null;
  const eg = [...sample].sort().join(", ");
  return `${count} residue${count > 1 ? "s" : ""} outside the ${alphabet} alphabet (e.g. ${eg})`;
}

/**
 * Whether the clipboard looks like FASTA — the first non-blank line starts with
 * `>`. Routes the paste: FASTA ⇒ insert as NEW sequences (names from the headers,
 * parsed in Rust); otherwise ⇒ a raw block paste into the selected cells. The
 * check is load-bearing (only FASTA text is fed to the Rust FASTA parser), but a
 * single header line is a strong, cheap signal.
 */
export function looksLikeFasta(text: string): boolean {
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    return line.startsWith(">");
  }
  return false;
}
