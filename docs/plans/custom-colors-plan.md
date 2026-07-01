# Custom colors — plan

Per-alphabet color palettes with user-editable per-residue cell **and** letter
colors. Pure frontend view state (coloring never crosses the IPC seam — no Rust,
no command, no capability; architecture invariant). Decided with the user
2026-07-01.

## Decisions (locked)

1. **Three palettes** — DNA / RNA / Protein, each with its own base scheme id +
   per-residue overrides. A **Link DNA & RNA** toggle (default **ON**) makes RNA
   share DNA's palette; the transition link→unlink SEEDS RNA from DNA's current
   colors, then they diverge. Re-linking makes RNA follow DNA again.
2. **Dedicated "Colors…" dialog** under the View menu (a swatch per residue for the
   active alphabet). Chosen over a section in the Consensus dialog — cleaner home
   for the future roadmap ([[future-work-dna-tools]]: color-by-type, etc.).
3. **Per residue the user picks BOTH the cell fill AND the letter color.** The
   letter ink override is new; today every glyph is solid black (`GLYPH_INK`).
4. **Default letter ink** for a residue whose FILL was customized but whose ink was
   not = **auto-contrast** (black on light fills, white on dark, Rec.601 luma).
   Un-customized residues keep the base scheme's black ink, so built-in schemes stay
   byte-for-byte unchanged.
5. Base scheme (Vivid/Classic/Colorblind) becomes **per-alphabet**; overrides layer
   on top; per-residue reset + reset-all clear overrides.
6. **Persistence: in-session only.** The app persists no view options across
   restarts today; cross-restart persistence is future work.

## Model / mechanism

- `colors.ts` gains: `ResidueOverride { fill?; ink? }`, `PaletteOverrides`
  (keyed by UPPERCASE residue letter), `autoInk(fill)` (luma→black/white),
  `schemeWithOverrides(base, overrides)` → a fresh `ColorScheme` (returns `base`
  unchanged when empty), plus `rgbToHex` / `hexToRgb` / `parseRgbCss` for the
  `<input type="color">` swatches and `resolveResidue(base, overrides, char)`
  (effective fill+ink as `Rgb`).
- **Fresh id per color change.** The glyph atlas (grid + track) keys re-ink on
  `scheme.id`, so `schemeWithOverrides` content-HASHES the overrides into the id
  (`custom-<baseId>-<hash>`). Same content → same id (safe memo); any change →
  new id → atlases rebuild. Empty overrides → base id (identical look).
- `Grid.tsx`: replace the single `schemeId` state with
  `palettes: Record<'DNA'|'RNA'|'Protein', {baseId, overrides}>` + `linkDnaRna`.
  The active alphabet (`effectiveKey(view.meta.alphabet, linkDnaRna)`; linked RNA →
  DNA slot) picks the palette; the effective-scheme effect (deps: palettes,
  linkDnaRna, view) builds `schemeWithOverrides(getScheme(baseId), overrides)` and
  pushes it to all three renderers (grid/track/minimap) + marks dirty. The
  View → Color-scheme picker and the dialog write the ACTIVE alphabet's slot.
- `ColorsDialog.tsx` (+ `.css`): per-residue swatches (fill + ink `<input
  type=color>`, per-residue reset), the Link toggle (nucleotide alphabets only),
  a base-scheme dropdown, reset-all, Done. Same drag-to-move + Esc pattern as
  `ConsensusDialog`.
- `MenuBar.tsx`: a "Colors…" action under View → opens the dialog.

## Invariants kept

- Built-in schemes unchanged (schemeWithOverrides returns base when empty; ink
  defaults only apply to customized residues) → `colors.test.ts` luma/distinctness/
  default-id assertions still hold.
- No IPC / no capability / Rust owns truth — view state only.

## Tests

- `colors.test.ts`: schemeWithOverrides (fill override, ink override, auto-contrast
  default on a dark custom fill, empty→base identity, fresh id on change), hex/rgb
  round-trip.
- Built-in scheme tests untouched.

## Out of scope (noted only — [[future-work-dna-tools]])

Color-by-type; genetic-DB APIs; DNA→protein + genetic codes; DNA search suite;
cross-restart persistence.
