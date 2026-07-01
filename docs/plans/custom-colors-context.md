# Custom colors — context (key files & decisions)

## Files touched

- `src/render/colors.ts` — added the override machinery (pure color math):
  `ResidueOverride`/`PaletteOverrides`, `luma`, `autoInk` (luma ≥140 → black else
  white), `rgbToHex`/`hexToRgb`/`parseRgbCss`, `resolveResidue` (effective fill+ink
  for the dialog swatches), `schemeWithOverrides` (base + overrides → fresh
  `ColorScheme`; returns base when empty; content-hashed id), and the residue lists
  `NUCLEOTIDE_RESIDUES` (A C G T U) / `AMINO_ACID_RESIDUES` (the 20). Built-in schemes
  and `makeScheme` UNCHANGED.
- `src/render/colors.test.ts` — +19 tests (hex/rgb round-trip, autoInk, schemeWith-
  Overrides fill/ink/auto-contrast/empty-identity/fresh-id, resolveResidue). 40 total.
- `src/ui/ColorsDialog.tsx` + `.css` — the new dialog. Reuses `.cons-*` chrome
  (backdrop/card/header/footer/buttons + drag-to-move + Esc) from ConsensusDialog.css;
  `.col-*` adds the swatch grid (preview cell showing the real fill+ink, a Cell picker,
  a Letter picker, per-residue ↺), the base-palette dropdown, the Link DNA & RNA
  checkbox, Reset all + Done.
- `src/ui/MenuBar.tsx` — `onOpenColors` prop + a "Colors…" action under View (right
  after Color scheme).
- `src/ui/Grid.tsx` — the state model + wiring.

## Grid state model

- `palettes: Record<'DNA'|'RNA'|'Protein', {baseId, overrides}>` replaces the single
  `schemeId`. `linkDnaRna` (default true). `colorsOpen` + `colorsOpenRef`.
- `alphaKey(alphabet)` → slot; `effectiveKey(alphabet, linked)` → the slot actually
  used (linked RNA → DNA). `activeKey`/`activePalette` derived each render;
  `activeKeyRef` shadows it for the handlers.
- Handlers: `handleSetScheme` (base for active slot — used by both the View quick-pick
  and the dialog dropdown), `handleOverrideChange` (set/merge/`null`-reset a residue),
  `handleResetColors` (clear active slot's overrides), `handleToggleLink` (unlink SEEDS
  RNA from DNA, deep-copying overrides), `openColors`/`closeColors`.
- Effective-scheme effect (deps `[activePalette, view]`): builds
  `schemeWithOverrides(getScheme(baseId), overrides)` → pushes to grid/track/minimap +
  `markDirty()`. Replaced the old `[schemeId]` effect.
- Window keydown bails on `colorsOpenRef` too (with `consensusOpenRef`).

## Why the id is content-hashed

The glyph atlas (grid + track) re-inks only when `scheme.id` changes (grid disposes
unconditionally on `setColorScheme`, but the TRACK atlas checks `matches` = id). So a
color change MUST change the id, and no change MUST keep it (atlas reuse). A djb2 hash
of the sorted overrides gives exactly that.

## Not changed / invariants

- No IPC, no Rust, no capability — coloring is frontend view state (Rust owns truth).
- Built-in schemes byte-identical (empty overrides → base); `colors.test.ts`
  luma/distinctness/default-id assertions untouched.
- Persistence: in-session only (no cross-restart persistence today).
