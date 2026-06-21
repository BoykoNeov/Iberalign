# M1 — Tasks

Model + parsing + coordinates. Engine-first; UI is dialog → summary only.
See `m1-plan.md` (why) and `m1-context.md` (where things live).

**Status: code complete and green** (`cargo test --workspace`, fmt, clippy,
frontend build, Tauri shell build). Only the manual GUI smoke and the
commit/push are outstanding.

## Engine — parser rework

- [x] Preserve residue case (drop the force-uppercase); normalize to uppercase
      only at the analysis boundary (`Alphabet::infer`).
- [x] Normalize `.`→`-` at the parse boundary; keep `*` stop codons as residues;
      gaps separated from the derived ungapped `residues`.
- [x] `ParseOutcome { records, warnings }` — non-fatal warnings channel.
      Duplicate names disambiguated (`name`, `name.1`, …) + warning. Empty
      record → skip + warning. `NoRecords` stays a hard error.
- [x] Malformed-alignment warning: unequal lengths + interior gaps → pad + warn
      (plain unaligned input draws no warning).
- [x] `load_alignment(path)` reads the file into an owned buffer in Rust
      (`fs::read`); parsed with the tolerant **slice** splitter — no file bytes
      over IPC, lone-CR/CRLF/LF tolerance preserved. (Chunked streaming deferred.)
- [x] Updated `align-cli summary` + `parse_summary` for the new return shape.

## Engine — Alignment construction

- [x] `Dataset::from_records`: **append trailing `-` only** to reach common
      width; aligned (equal-width) input is a no-op; interior gaps never touched.
- [x] Malformed aligned FASTA (interior gaps + unequal lengths) → trailing-pad +
      warning (warning emitted at parse; padding at construction).
- [x] `Summary.equal_width` / DTO `equal_width` = equal **pre-pad gapped
      width**; `Summary.width` added. (Surfaced as "Equal width", **not**
      "Aligned" — see the post-smoke note below.)
- [x] Derive `Sequence.residues` (ungapped, case-preserved) per row.

## Engine — composition + coordinates

- [x] `Composition` (`composition.rs`): GC per ungapped seq, gap fraction per
      row + per column, length distribution. M4 `analyze.rs` stubs untouched.
- [x] `align-cli composition` subcommand (CI integration path).
- [x] Proptest `construction_preserves_roundtrip`: coord round-trip holds over
      alignments built via the constructor (padding preserves the mapping).

## Engine — fixtures (acceptance gate)

- [x] One fixture per parser feature under `crates/align-core/tests/fixtures/`,
      each failing without its code path: IUPAC; soft-mask; U-vs-T; gaps `-`/`.`;
      `*` stop codons; comments/blanks; duplicate names; aligned; ragged;
      malformed. Line-ending tolerance stays an inline byte-literal test.

## Shell — state + IPC

- [x] `AppState { sequences }` → `Option<Dataset>` (Dataset bundles the
      `Alignment` + derived `Sequence`s — what later commands actually need).
- [x] `load_alignment(path)` command: Rust reads the file, builds the `Dataset`,
      returns the grown DTO (`count`, `min_len`, `max_len`, `width`,
      `equal_width`, `alphabet`, `warnings`). `parse_summary` shares the builder.
- [x] DTO + `src/ipc/commands.ts` wrapper updated (snake_case → camelCase),
      `loadAlignment(path)` added.

## UI + capabilities

- [x] `dialog` plugin: Rust dep `tauri-plugin-dialog` + registered in `lib.rs`;
      npm dep `@tauri-apps/plugin-dialog`; capability `dialog:allow-open` in
      `default.json`. **No `fs`** — Rust reads the file (capabilities gate the
      webview, not the backend). `tauri-plugin-fs` arrives only transitively and
      grants nothing without a permission.
- [x] `App.tsx`: "Open file…" → dialog → `load_alignment` → shows count /
      lengths / width / alphabet / equal-width? / warnings. Textarea demo
      retained.

## Verify + wrap

- [x] `cargo test --workspace` green; `cargo fmt --check` + clippy
      (`-D warnings`) clean; `npm run typecheck && npm run build` green; Tauri
      shell `cargo build -p iberalign` green.
- [ ] User smoke: `npm run tauri dev` → Open file → summary shows. (GUI can't be
      driven from this environment.)
- [ ] Batch-end ritual: commit (Conventional Commits) and push; confirm CI
      green. (Docs + `CLAUDE.md` + memory updated.)

## Post-smoke fix — "Aligned" → "Equal width"

User-reported during the GUI smoke: a real, non-column-aligned FASTA (22 rRNA
seqs, ungapped 564–586, all gap-padded to width 586) showed "Aligned: yes".
Not a bug — the rows *are* uniform width — but the **label overclaimed**:
equal width is necessary, not sufficient, for a real MSA (gap-padded /
frame-shifted sequences pass too). Renamed `equal_length`/`aligned` →
`equal_width` across engine `Summary`, DTO, IPC, CLI (`equal width:`), and the
UI ("Equal width"); the UI appends "(gap-padded)" when width is uniform but
ungapped lengths differ. Detecting a *good* alignment from data alone is out of
scope.

## Deferred (not M1)

- Edit `apply(cmd)`/`apply(inverse)` proptest → **M5** (edit→undo→redo lossless;
  `edit.rs` is `todo!()` until then).
- Chunked/incremental streaming (Layer 2: progress, cancellation, mmap) →
  revisit when a real file chokes; plugs into the M1 path-based seam.
- All-gap record body (`>x\n----\n`): non-empty `gapped` but empty derived
  `residues`, so it is *not* skipped — it becomes a zero-residue all-gap row.
  Legal in an alignment but untested; consider a warning if it proves confusing.
- Virtualized grid / rendering → **M2**.
