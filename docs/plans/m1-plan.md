# M1 — Model + parsing + coordinates — Plan

**Goal (spec §12):** a real data model end-to-end — tolerant FASTA → `Alignment`
→ composition stats → load summary in the UI via a native file dialog.
*Done when:* messy-FASTA fixtures parse correctly and the coordinate round-trip
property still passes through the new construction path.

Scope is **engine-deep, UI-shallow**: M1's UI is *dialog → summary only*. The
virtualized grid is M2 — do not drift into rendering here.

## The invariant that makes or breaks M1 (get this right first)

"Pad to width" must mean **append trailing `-` only** — never *strip gaps and
re-pad*. Stripping interior gaps then re-padding silently destroys aligned
input (`ACGT-AC` / `AC-GTAC` → both become `ACGTAC`, alignment gone, no error).

One rule that unifies aligned and ragged input:

- A record's **literal residue/gap stream** (with `.`→`-` normalized, original
  case preserved) **is** the `AlignedRow.gapped` row.
- Construction pads only by **appending `-`** to shorter rows to reach the
  common width. Equal-width (already-aligned) input → no-op. Ragged input →
  left-justified. Interior gaps are never touched.
- `Sequence.residues` (ungapped) is **derived** by stripping gaps from the
  literal stream — it is not the primary artifact.
- Normalize `.`→`-` at the **parse boundary** so the in-memory invariant is
  "a gap is `b'-'`, always" (keeps `is_gap`/coords trivial).
- Malformed aligned FASTA (interior gaps **and** unequal lengths) → trailing-pad
  to max width **and emit a warning**.
- `Summary.equal_width` means equal **gapped width** (a rectangular matrix),
  not equal ungapped residue length. Surfaced as "Equal width", not "Aligned"
  — equal width is necessary but not sufficient for a real MSA.

A fixture covers each clause so a regression fails a test.

> Construction consumes **gap-preserving parse records**, not the ungapped
> `Sequence`. The M0 flow `parse_fasta -> Vec<Sequence>` is reshaped: the parser
> yields records carrying the literal (normalized) stream; the `Alignment`
> constructor pads those into rows; `Sequence` is derived per row for analysis.

## Parser rework (the other half of M1)

The M0 parser force-uppercases everything and keeps `-`/`.`/`*` inside
`residues`. M1 changes:

- **Preserve case** — lowercase soft-masking is data; normalize to uppercase
  only at the analysis boundary (alphabet inference, composition), never in
  storage.
- **Separate gaps from residues** per the invariant above; `.`→`-` normalized,
  `*` stop codons preserved as residues.
- **Warnings channel:** parsing returns `ParseOutcome { records, warnings }`
  (non-fatal). Duplicate names are disambiguated (`name`, `name.1`, …) with a
  warning; an empty record becomes a **skip + warning** (tolerant), not a hard
  error. `NoRecords` (no `>` at all) stays a hard error.
- **Streaming, scoped (Layer 1 only):** `load_alignment(path)` has **Rust read
  the file into one owned buffer** (`fs::read`), then parse with the tolerant
  slice splitter — no file bytes cross IPC, and lone-CR/CRLF/LF tolerance is
  preserved (a naive `BufRead` line loop would swallow lone-CR files). Layer 2 —
  chunked/incremental parsing, progress events, cancellation, mmap/windowing —
  is **not** M1; the target domain tops out at tens of MB (resident anyway via
  the render buffer) and Layer 2 plugs into this same path-based seam later.

## Load path — path-based read in Rust (decision to confirm)

Switch M0's "frontend reads bytes → `parse_summary(bytes)`" to "native dialog →
`load_alignment(path)`; **Rust** opens and streams the file." Rationale: it's
where streaming belongs (spec §7), and it keeps the byte buffer out of IPC.

**Capability note** (corrects the task-list wording): Tauri capabilities gate
the **webview's** access to commands/plugins, **not** the Rust backend's
`std::fs`. `parse_summary` already proves a custom command runs under bare
`core:default`. So path-based load needs the **`dialog`** plugin (frontend gets
the path) and **not** the `fs` plugin. Add `fs` (read) *only* if we keep
frontend-side file reading. Verify against the installed plugin docs before
wiring.

## Composition stats

GC content (per ungapped sequence; DNA/RNA), gap fraction (per row **and** per
column — needs the gapped `Alignment`), length distribution (over ungapped
residue lengths). New `Composition` type in `analyze.rs` (or a `composition`
module); tested on toy inputs; exercised headlessly via a new `align-cli`
subcommand.

## Coordinates — already done

M0's round-trip proptest satisfies "coordinate API with proptests." The only M1
coords work is **confirming the invariant still holds** through the new
`Alignment` construction path (a proptest over constructed alignments). Do not
re-derive the mapping.

## Ordering

Engine-first (fast build/test loop, no Tauri):
1. Parser rework (case, gaps, `ParseOutcome`, fixtures).
2. `Alignment` constructor (trailing-pad invariant + proptest).
3. Composition stats + `align-cli` subcommand.

Then shell: `AppState → Option<Dataset>`; DTO grows `width` / `equal_width` /
`warnings`; `load_alignment` command. Then UI + `dialog` capability.

## Decisions to confirm (flag any to change)

1. **Path-based load in Rust** (vs keep frontend byte-read). Recommended:
   path-based — needs only `dialog`, puts streaming where it belongs.
2. **Empty record → skip + warning** (vs hard `ParseError`). Recommended: skip
   + warning (tolerant parser).
3. **Task 6 (edit apply/inverse proptest) deferred to M5.** It's M5 acceptance
   (edit→undo→redo lossless); `edit.rs` is `todo!()`; a trivial seed test would
   violate "no test that can't fail for a real defect." Stub types = enough
   seeding for now.
4. **Streaming = Layer 1 only** (Rust reads the path into an owned buffer; no
   bytes over IPC). Layer 2 (chunked/incremental, progress, cancellation) is
   deferred — additive on the same seam when a real file chokes.

## Acceptance (M1)

- Messy-FASTA fixtures (enumerated in tasks) all parse correctly; duplicate
  names disambiguated with warnings; soft-mask case preserved.
- `Alignment` constructor pads by trailing `-` only; aligned input is a no-op;
  coord round-trip proptest passes over constructed alignments.
- Composition stats correct on toy inputs; `align-cli` exercises them.
- Native dialog loads a file; UI shows count / lengths / alphabet /
  equal-width? / warnings.
- `cargo test --workspace` green; `cargo fmt --check` + clippy clean; frontend
  `typecheck` + `build` green.
