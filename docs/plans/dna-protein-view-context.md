# DNA/RNA ↔ Protein view + translation — context (key files & decisions)

Companion to `dna-protein-view-plan.md`. What/where, so the next session can navigate
without re-deriving.

## Engine (Phase 1 — DONE)

- `crates/align-core/src/translate.rs` — `GeneticCode { name, id, aa: [u8;64] }` seeded
  with NCBI table 1 (Standard); `GeneticCode::standard()`/`default()`/`by_id(1)`.
  `TranslateMode { Degap, CodonThrough }`. `translate(input, &code, mode) -> Vec<u8>`:
  Degap filters gaps then reads whole codons (len ⌊ungapped/3⌋); CodonThrough groups every
  3 COLUMNS (all-gap codon → `-`, gap-spanning → `X`; len ⌊cols/3⌋). Case-insensitive; `U`
  reads as `T`; non-ACGTU → `X`. No alphabet guard (bytes in/out).
- `crates/align-cli` — `translate <file.fasta> [--mode degap|codon] [--code N]` (codon reads
  `rows[i].gapped`, degap reads `sequences[i].residues`).

## IPC seam (Phase 2 — DONE)

- `src-tauri/src/commands.rs` — pure `translate_block_rows(ds, rows, c0, c1, mode, code) ->
  Vec<Vec<u8>>` (both modes read the GAPPED window `[c0..=c1]`; codon framing starts at `c0`;
  output trailing-gap-padded rectangular; empty/<3-col window → empty rows width 0; row ORDER
  preserved). Thin `#[tauri::command] translate_block(rows, c0, c1, mode: String, code:
  Option<u8>) -> TranslateBlockDto { rows: Vec<String>, width }` (validates rows in bounds +
  mode/code id; STATELESS — immutable borrow, no history). Registered in `lib.rs`. No new
  capability. **NB: no alphabet guard in the command** — the gate is frontend-side (Phase 3).
- `src/ipc/translate.ts` — `translateBlock(rows, c0, c1, mode, code?)` + `TranslateMode` +
  `TranslateBlockResult`. Kept OUT of `ipc/edit.ts` (whose contract is reversible mutations).

## UI wiring (Phase 3 — DONE)

- `src/ui/MenuBar.tsx` — new **Translate** top-level menu: action "Translate selection to
  protein…" (disabled when `!canTranslate`) + "Gap mode" submenu (Degap|Codon). Props
  `canTranslate`, `onTranslate`, `translateMode`, `onSetTranslateMode`. `TranslateMode`
  imported from `../ipc/translate`.
- `src/ui/Grid.tsx` — `translateMode` state+ref, `translateOpen`+ref (keydown guard),
  `translateData` (the rows to show), `doTranslateRef` bridge. `doTranslate` (mount effect,
  next to `doAlign`): alphabet gate → require selection → `rowList` + `[c0,c1]` from the
  selection → `translateBlock` → width-0 message → pair with `nameAt(r)` → open modal.
  `canTranslate = alphabet !== "Protein"` (render body). `[view]` effect closes the modal on
  load. Mounts `<TranslateDialog>`.
- `src/ui/TranslateDialog.tsx` + `.css` — read-only modal (header badge = gap mode, sub =
  "Standard code · cols a–b · N sequences", body = monospace rows name+seq, Done/Esc/backdrop
  close, drag-to-move). Presentational; `Grid` feeds finished rows. `TranslateDialog.dom.test.tsx`.

## The two forks (DECIDED 2026-07-01)

- **Q1 = B now, A later.** v1 is a frontend read-only projection (this modal); the Rust-owned
  editable/alignable protein `Alignment` is the Phase-4/5 graduation.
- **Q2 = selection-scoped + both gap modes.** Translate only the selected rows × column window;
  Degap default, Codon toggle.

## Contrast to remember

- **`doTranslate` USES the selection's column window; `doAlign` IGNORES it.** Align works on
  whole ungapped rows; translate is windowed (Q2). Don't copy `doAlign`'s column handling.
- **Translation is READ-ONLY** — no `EditCmd`, no history, no `runEdit`. It never mutates.
