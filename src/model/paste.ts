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
