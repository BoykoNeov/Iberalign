# DNA/RNA ↔ Protein separate views + translation — design plan

**Status: Phase 1 (engine + CLI) DONE + green 2026-07-01. Both forks DECIDED
2026-07-01 (see `## Fork decisions`). Phases 2–5 pending.** Session 2026-07-01.

## Phase 1 — `align-core::translate` + CLI (DONE, green)

`crates/align-core/src/translate.rs`: `GeneticCode { name, id, aa: [u8;64] }`
holding a full 64-codon table seeded with **NCBI table 1 (Standard)** in TCAG
order (`GeneticCode::standard()`/`default()`; `by_id(1)` only — extra tables are
future *data*). `TranslateMode { Degap, CodonThrough }` (mirrors `AlignMode`).
`translate(input, &code, mode) -> Vec<u8>`: **Degap** filters gaps
(`coords::is_gap`) then reads whole codons (trailing 1–2 dropped, len =
⌊ungapped/3⌋); **CodonThrough** groups every 3 *columns* — all-gap codon → `-`,
codon spanning a gap → `X`, else translate (len = ⌊cols/3⌋ so rows stay
rectangular). Case-insensitive; `U` reads as `T`; any non-ACGTU base → `X`. No
alphabet guard (bytes-in/bytes-out — the "DNA/RNA only" guard belongs at the
Phase-2 seam). 13 unit + 2 proptest (length invariants; ATG→M / stops→`*` guard
the base_index↔table agreement). CLI: `align-cli translate <file.fasta> [--mode
degap|codon] [--code N]` — **codon mode reads `rows[i].gapped`, degap reads
`sequences[i].residues`** (feeding degapped bytes to the codon path would make
`--mode codon` a silent no-op — advisor-flagged). align-core + align-cli tests +
clippy `-D warnings` + fmt clean. **Next: Phase 2 seam** (`translate_block` IPC
command).

---

Origin: during the custom-colors GUI smoke the user asked for protein and DNA/RNA
to be **separate views you switch between**, with a DNA/RNA view able to **translate
into a protein view** (prompting for a genetic code the first time — the picker
itself is explicitly deferrable). Rationale: *"there is no point in aligning DNA with
protein."* A related coloring bug surfaced in the same breath and was fixed
separately (see `## Related fix` below) — it is NOT part of this feature.

---

## What the user asked for (restated)

1. **Separate view modes**, not one grid that silently holds either alphabet. The
   user switches between a nucleotide view and a protein view.
2. Starting from a **DNA/RNA** alignment, an action ("clicking the protein
   subwindow") produces a **protein view = the translation** of the nucleotides.
3. The **first** translation prompts for a **genetic code**; the user flagged the
   genetic-code *picker* as future work → default to one table for now, add the
   chooser later.
4. Constraint driving all of it: **DNA vs protein alignment is meaningless.**

## What is already true (so this is smaller than it looks)

- Each loaded alignment infers **one** alphabet (`Alphabet::infer`, DNA/RNA/Protein)
  and the whole app keys off `view.meta.alphabet`. There is no mixed-alphabet
  alignment surface today — so the *"no aligning DNA vs protein"* constraint is
  **already largely satisfied**; this feature is about **adding a translate + a view
  toggle**, not about un-mixing something currently mixed. (Note, not a blocker.)
- Coloring is already per-alphabet-class (custom-colors batch) and now
  alphabet-scoped at the palette level (the related fix). A protein view will get
  the protein palette for free.

---

## Fork decisions (user, 2026-07-01)

- **Q1 → Option B now, Option A later.** v1 is a **frontend read-only projection**
  ("clicking the protein subwindow" derives a protein render-buffer from the DNA
  buffer; you *look at* the translation, you don't edit it). A **Rust-owned
  `Alignment`** (editable / alignable protein view) is the **future graduation** once
  the user wants to edit/align the translated protein. So: cheap correct v1 that
  matches the user's phrasing, with a clear upgrade path to the invariant-aligned
  engine-owned design. Because v1 is read-only, *"Rust owns the truth"* is not
  violated — the DNA alignment stays the sole source of truth; protein is a derived
  view.
- **Q2 → selection-scoped translation, both gap modes offered.** Translation operates
  on **only the user-selected parts** (selected rows and/or column region), NOT the
  whole alignment — this is the primary decision and it sidesteps the whole-alignment
  framing problem by letting the user pick a clean region. **Both** gap-handling
  approaches are **included as choosable modes** ("2 options included"): (a)
  **degap → translate** the selected residues per row (the clean-ORF reading), and
  (b) **codon-through-the-alignment** over the selected columns (keeps 1:3 column
  correspondence; a codon spanning a gap → `X`/`-`). Default mode to be picked at
  build time (lean degap→translate as the default; codon-through as the toggle),
  revisitable.

The rest of this section is kept for the reasoning behind each option.

## THE TWO FORKS — reasoning (now decided above)

### Q1 — Is a translated protein view a real Rust-owned `Alignment`, or a frontend-derived buffer?

This is the architectural fork; everything downstream follows from it.

- **Option A — Engine-owned (translation produces a real `Alignment`).** Aligns with
  the invariant *"Rust owns the truth."* Translating yields a new `Alignment`
  (protein) in `src-tauri` managed state, with its own undo stack / render buffer.
  Switching views = choosing which alignment the frontend mirrors.
  - *Pros:* consistent with every other data-producing operation (align, edit,
    paste); the protein alignment is first-class (editable, exportable, alignable).
  - *Cons:* need to define how two alignments coexist in `AppState` (today it holds
    one) and what "switch view" means to state/history.
- **Option B — Frontend-derived view (translation is a UI projection).** Matches the
  user's *"clicking the protein subwindow converts it"* phrasing — a lightweight
  toggle that derives a protein render-buffer from the DNA buffer on the fly.
  - *Pros:* smallest change; no `AppState` rework; feels like a "view."
  - *Cons:* breaks *"Rust owns the truth"* if the protein view is editable; a
    read-only projection sidesteps that but then protein can't be edited/aligned in
    its own view (may be acceptable as a v1 "look at the translation").

**Recommendation to discuss:** if the protein view is meant to be *editable /
alignable*, go **A** (engine-owned). If it is a *read-only look at the translation*
for now, **B** (derived, read-only) is the cheap correct v1 and can graduate to A
later. The user's phrasing leans B; the invariant leans A. **User decides.**

### Q2 — How is a GAPPED DNA alignment translated?

A DNA *alignment* has gaps; translation is codon-based (3 nt → 1 aa), so gaps make it
non-trivial. Two approaches:

- **Codon-through-the-alignment:** walk each row in alignment coordinates, group
  columns into codons, translate; a codon spanning a gap → an ambiguous/gap amino
  (`X`/`-`). Keeps column correspondence to the DNA but codon framing across gaps is
  fiddly and biologically debatable.
- **Degap → translate → (re)align:** strip gaps per row, translate the clean ORF,
  then present (optionally re-MSA the proteins). Cleaner translation, but the protein
  columns no longer line up 1:3 with the DNA columns.

**Recommendation to discuss:** **degap → translate** per sequence is the defensible
default (translation is a per-sequence operation; alignment is a separate step). Then
Q1 decides whether the translated proteins are re-aligned (engine MSA) or shown
ungapped. **User decides**, but this can default and be revisited.

---

## Settled (not open)

- **Translation lives in `align-core`** as a pure, testable module (`translate.rs`):
  a codon table + `translate(seq, &GeneticCode) -> Vec<u8>`. Mirrors how alignment
  lives in the engine — no shelling out, no frontend biology. Property-testable
  (length = ⌊n/3⌋; known codons → known residues; stop → `*`).
- **Genetic code:** default to **NCBI translation table 1 (Standard)** now. The
  **picker is deferred** (a later dialog, same pattern as the consensus/colors
  dialogs). Design the `GeneticCode` type to hold a full 64-codon table so adding
  tables 2/11/etc. later is data, not code.
- **Coloring:** a protein view automatically uses the protein palette (already built).
  No new coloring work.
- **The View toggle** is a MenuBar/shell affordance (the "protein subwindow"); exact
  UI (menu item vs tab vs split) is a UI-polish detail, secondary to Q1.

## Non-goals / deferred

- Genetic-code **picker dialog** (default table 1 until then).
- Reverse translation, reading-frame selection (all 6 frames), ORF finding — these
  belong with the broader **DNA tools backlog** (`future-work-dna-tools.md`).
- Re-aligning translated proteins is in-scope only if Q1=A and the user wants it.

---

## Related fix (shipped separately, NOT this feature)

The same conversation surfaced a real bug: the **DNA/RNA consensus track colored
IUPAC ambiguity codes (`R Y S W K M D H V N`) with PROTEIN colors**, because every
scheme merged the 20-amino palette unconditionally and the color lookup is
alphabet-agnostic (introduced by the amino-acid coloring batch `2e948fe`). Fixed by
**alphabet-scoping the palette** (`schemeForAlphabet` in `render/colors.ts`: DNA/RNA
get a nucleotide-only variant so ambiguity codes fall to the grey `fallback`; protein
gets the full palette). Regression test added in `colors.test.ts`. This is committed
on its own, ahead of and independent of this feature.

---

## Suggested phasing (forks decided — ready on go-ahead)

1. **Engine:** `align-core::translate` — codon table + `GeneticCode` type (full
   64-codon table, seeded with NCBI table 1) + `translate(seq, &GeneticCode) ->
   Vec<u8>` and a gap-aware variant for the codon-through mode. Unit + property tests
   (length = ⌊n/3⌋ ungapped; known codons → known residues; stop → `*`). CLI:
   `align-cli translate <file.fasta>` (whole-file convenience for the CLI path).
2. **Seam — Q1=B (frontend read-only projection).** No `AppState` rework: the
   frontend derives a protein render-buffer from the selected DNA cells. Translation
   itself must stay pure-engine — expose it as a **stateless IPC command**
   `translate_block(rows, c0, c1, mode, code) -> protein bytes/rows` (Rust does the
   biology; the frontend just displays the result read-only). No new capability
   (custom app commands aren't capability-gated). *Future Q1=A:* promote to an engine
   command that produces/holds a protein `Alignment` in managed state.
3. **Selection scoping (Q2):** the translate action reads the **current selection**
   (rows + column range). Mode toggle: **degap→translate** (default) | **codon-
   through-the-alignment**. Result opens as the read-only protein view.
4. **UI:** the view affordance ("protein subwindow" / a View→Translate action) and
   the protein-view read-only presentation; wire coloring (free — protein palette).
5. **Later:** genetic-code **picker dialog**; graduate to Q1=A (editable/alignable
   Rust-owned protein alignment); the rest of the DNA-tools backlog
   (reverse-translate, 6-frame, ORF finding).
