// Classify a keystroke as manual residue entry for the grid. Pure so the
// case-preservation, the accepted character set, and the multi-char exclusion are
// regression-testable in isolation (the project's pure-model-fn pattern); the edit
// itself rides the Rust-tested paste primitives.
//
// A residue key is a SINGLE printable character that is a letter or one of the
// gap/special residue glyphs `-` `.` `*` `?`. Multi-character `KeyboardEvent.key`
// values ("Enter", "ArrowUp", "Backspace", "Tab", "Shift", …) are excluded, so the
// caller can test every keydown and let navigation/control keys fall through. Case
// is PRESERVED — a lowercase key types a lowercase residue (soft-masking), and the
// caller writes the byte verbatim.
//
// Modifier filtering is the CALLER's job: this only classifies the character. The
// grid gates on `!ctrl && !meta && !alt` first so `Ctrl+A` (select-all) and AltGr
// letter combos never reach here.

// Letters (either case) plus the gap (`-`), the alignment dot (`.`), the stop/any
// markers (`*`, `?`). The anchored class already implies length 1; the explicit
// length check below short-circuits the common multi-char keys before the regex.
const RESIDUE_RE = /^[A-Za-z.\-*?]$/;

/** True if `key` (a `KeyboardEvent.key`) is a residue the grid should type. */
export function isResidueKey(key: string): boolean {
  return key.length === 1 && RESIDUE_RE.test(key);
}
