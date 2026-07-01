# Custom colors — tasks

## Done (code complete + green; GUI smoke PENDING)

- [x] `colors.ts` override machinery (overrides, autoInk, hex/rgb, resolveResidue,
      schemeWithOverrides with content-hashed id, residue lists).
- [x] `colors.test.ts` +19 tests (40 total).
- [x] `ColorsDialog.tsx` + `.css` (swatch grid, base dropdown, link toggle, resets).
- [x] `MenuBar.tsx` View → "Colors…".
- [x] `Grid.tsx` per-alphabet `palettes` + `linkDnaRna` + `colorsOpen`; effective-
      scheme effect; keydown guard; dialog wiring.
- [x] typecheck + 314 vitest + build green.
- [x] **jsdom + RTL harness set up** (two vitest projects: `node` + `dom`) and
      `ColorsDialog.dom.test.tsx` (16 component tests) — pins the prop→callback flow
      behind smoke items 2/4/5 (per-residue set/merge/reset, Reset-all + link
      enable/disable/visibility, base-scheme change, Esc/backdrop/Done close). Full
      suite now **330** (314 node + 16 dom); typecheck + build green. See CLAUDE.md
      "Frontend test harness".

## GUI smoke checklist (user) — PASSED 2026-07-01 (user "all good")

Items 2/4/5's *logic* is now covered by `ColorsDialog.dom.test.tsx`; the remaining
smoke value is the visual/live behavior the harness cannot see (repaint, atlas
rebuild, letter legibility, real Tauri modal keyguard). All items + the bundled
consensus-color fix (item 0) passed; committed + pushed.

0. **[FIX]** DNA consensus track under a VARIABLE column renders GREY (grey
   `fallback`), not a protein color — the alphabet-scoping fix (`schemeForAlphabet`).
1. [x] Load a DNA file → View → Colors…; change A's Cell color → grid + track + minimap
   update live; the letter stays legible (auto-contrast on a dark pick).
2. [x] Change A's Letter color independently; per-residue ↺ reverts just A; Reset all
   clears everything.
3. [x] Base palette dropdown switches the base; overrides persist on top.
4. [x] Unlink DNA & RNA → RNA starts as a copy of DNA, then diverges; re-link → RNA
   follows DNA again. (Needs a DNA file and an RNA file — `fixtures/smoke-msa-rna.fasta`.)
5. [x] Load a protein file → the dialog shows the 20 amino acids (no Link toggle);
   protein colors are remembered separately from the nucleotide palette.
6. [x] Switch back to the DNA file → its custom colors are still there.
7. [x] With the Colors dialog open, Delete/arrows/Ctrl+Z don't reach the grid.

## Deferred / future ([[future-work-dna-tools]])

- Color residues by TYPE (hydrophobicity/charge; purine/pyrimidine).
- Cross-restart persistence of palettes.
- Genetic-DB APIs; DNA→protein + genetic codes; DNA search suite.
