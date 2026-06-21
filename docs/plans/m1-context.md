# M1 — Context

Key files, current state, and decisions a session needs to execute M1. Pairs
with `m1-plan.md` (the why) and `m1-tasks.md` (the checklist).

## Starting point (what M0 left)

- **`crates/align-core/src/model.rs`** — `Alphabet`, `Sequence` (ungapped
  `residues`), `AlignedRow` (`gapped`, lazy `col_to_pos`/`pos_to_col`
  `OnceCell`s, `invalidate_index`), `Alignment` (`width`, `rows`, lazy
  `consensus`/`conservation`, `from_rows`, `invalidate_caches`).
  `from_rows` already `debug_assert!`s equal width — the new constructor pads
  *into* that precondition.
- **`crates/align-core/src/parse.rs`** — `parse_fasta(&[u8]) -> Result<Vec<Sequence>, ParseError>`,
  `summarize(&[Sequence]) -> Summary`, `infer_alphabet`, tolerant `LineSplit`
  (LF/CRLF/CR), `trim_ascii`, `split_header`. **This file is reworked in M1.**
  Current behavior to change: force-uppercases all residues; keeps `-`/`.`/`*`
  inside `residues`; `ParseError` is the only return channel (no warnings).
- **`crates/align-core/src/coords.rs`** — `col_to_seq_pos`/`seq_pos_to_col` on
  `AlignedRow`, `is_gap`. Round-trip proptest in `tests/coords_proptest.rs`
  (green). M1 only *re-confirms* this through the new construction path.
- **`crates/align-core/src/analyze.rs`** — `consensus`/`conservation`/
  `identity_matrix` are `todo!("M4: …")`. Composition stats are added here (or a
  sibling `composition` module) in M1 — do **not** touch the M4 stubs.
- **`crates/align-core/src/{align,edit,io}.rs`** — `align`/`edit` stubbed for
  M3/M5; `io::write_fasta` done, clustal/phylip stubbed. M1 leaves these alone.
- **`crates/align-cli/src/main.rs`** — `summary` subcommand over the engine. M1
  adds a `composition` subcommand (CI integration path).
- **`src-tauri/src/state.rs`** — `AppState { sequences: Vec<Sequence> }`. Its own
  comment flags the placeholder → becomes `Option<Alignment>` in M1.
- **`src-tauri/src/commands.rs`** — `parse_summary(bytes, state) -> SummaryDto`.
  `SummaryDto` is the serde mirror (engine stays serde-free). M1 adds
  `load_alignment(path)` and grows the DTO (`width`, `equal_width`, `warnings`).
- **`src-tauri/capabilities/default.json`** — `core:default` only. M1 adds the
  `dialog` plugin permission (see capability note in the plan — likely **not**
  `fs`).
- **`src/ipc/commands.ts`** — typed `invoke` wrapper `parseSummary`; the only
  importer of `@tauri-apps/api`. M1 adds the load/dialog wrapper here.
- **`src/ui/App.tsx`** — M0 demo: textarea → `parseSummary` → table. M1 wires a
  "Open file…" button → dialog → `load_alignment` → richer summary.

## Design decisions locked for M1

- **Trailing-pad-only invariant** (the correctness blocker — see plan). Literal
  normalized stream *is* the gapped row; `residues` derived; `.`→`-` at the
  parse boundary; `equal_width` = equal **gapped width** (surfaced as "Equal
  width", not "Aligned" — equal width ≠ a real MSA).
- **Gap-preserving parse records.** Parsing yields records carrying the literal
  (case-preserved, `.`→`-`) stream; the `Alignment` constructor pads those into
  `AlignedRow`s; `Sequence` is derived per row for analysis. `parse_fasta`'s
  old `Vec<Sequence>` shape is replaced.
- **`ParseOutcome { records, warnings }`** — non-fatal warnings (dup names,
  skipped empty records, malformed-aligned pad). Ripples: update `align-cli`
  and `parse_summary`; DTO gains `warnings: Vec<String>`.
- **Path-based load**: `load_alignment(path)` has Rust read the file into one
  owned buffer (`fs::read`) and parse with the tolerant **slice** splitter — no
  bytes over IPC, lone-CR tolerance preserved. Frontend gets the path from the
  `dialog` plugin. Chunked/incremental streaming (Layer 2) is deferred.
- **Task 6 deferred to M5.** Edit apply/inverse proptest is M5 acceptance; do
  not seed a trivial test now.

## Fixtures (acceptance gate — half the done-criterion)

Add under `crates/align-core/tests/fixtures/` (and/or repo `fixtures/`). One
per parser feature so each fails without its code path: mixed LF/CRLF/CR;
IUPAC ambiguity codes; soft-mask (lowercase) preservation; U-vs-T (RNA/DNA);
gaps as `-` and `.`; `*` stop codons; blank + `;` comment lines; duplicate
names; aligned (equal width) vs ragged (unequal) records.

## Gotchas (carried from M0)

- `generate_context!` embeds `../dist`; build the frontend before a raw
  `cargo build` of the shell.
- src-tauri `[lib] name = "iberalign_lib"`; `main.rs` calls
  `iberalign_lib::run()`.
- Engine stays **serde-free**; DTOs live in `src-tauri`.
- Tauri CLI is the local `@tauri-apps/cli` dev dep (`npm run tauri …`); no
  global `cargo-tauri`. `mafft` not installed (M6 only).

## Toolchain

rustc/cargo 1.94, node 24, npm 11, git 2.53, gh 2.92 (auth: BoykoNeov, ssh).
Adding Tauri plugins means a new Rust dep (`tauri-plugin-dialog`) **and** an npm
dep (`@tauri-apps/plugin-dialog`) — pin versions to the installed Tauri v2 line.
