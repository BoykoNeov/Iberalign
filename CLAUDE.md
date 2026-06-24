# CLAUDE.md — Iberalign working notes

Desktop MSA viewer/editor: Tauri v2 + native Rust core + React/TS webview.
The full brief is [`iberprime-spec.md`](./iberprime-spec.md) — read it for any
non-trivial change. This file is the short list of things to get right.

## Architecture invariants (do not violate)

- **Rust owns the truth.** The authoritative `Alignment` + undo/redo stack live
  in `src-tauri` managed state (`Mutex<AppState>`). The frontend holds only a
  render-buffer copy (a flat `Uint8Array`) and view state. One source of truth.
- **No IPC per frame.** Panning/zooming/rendering reads only the JS buffer. IPC
  happens on coarse events (load, align, analyze, edit, export) — never per
  keystroke or per frame.
- **No DOM-per-cell.** The grid is a virtualized Canvas2D (→ WebGL later)
  drawing only the visible window. Millions of cells; never one element each.
- **Don't write MSA/phylogenetics heuristics.** Optimal MSA is NP-hard —
  shell out to MAFFT/MUSCLE/Clustal Omega; trees to FastTree/IQ-TREE. The only
  hand-written alignment is *pairwise* NW/SW (Gotoh affine), in `align-core`.
- **Three coordinate spaces, never conflated:** ungapped position ↔ alignment
  column ↔ screen pixel. Mapping lives in `align-core::coords`; the round-trip
  invariant is property-tested. Features anchor to *ungapped* positions and
  remap at draw time.
- **Capabilities stay scoped.** `src-tauri/capabilities/default.json` grants the
  minimum. Add `fs`/`dialog`/`shell` permissions only as the feature that needs
  them lands. No broad permissions.

## Layout

- `crates/align-core/` — pure engine, no Tauri/UI. `model parse coords align
  analyze edit io`. Keep it serde-free; DTOs for IPC live in `src-tauri`.
- `crates/align-cli/` — headless harness over the engine; the CI integration path.
- `src-tauri/` — `lib.rs` (builder + handlers), `commands.rs` (coarse async
  commands → DTOs), `state.rs` (`AppState`).
- `src/` — React frontend. `ipc/` is the only place that calls `invoke`; UI
  code imports typed wrappers from there. Also `model/ render/ state/ ui/`.

## Commands

```bash
cargo test --workspace                          # all Rust tests
cargo fmt --all                                 # format (CI checks --check)
cargo clippy -p align-core -p align-cli --all-targets -- -D warnings
cargo run -p align-cli -- summary fixtures/sample.fasta
npm run typecheck && npm run build              # frontend
npm run tauri dev                               # full app (run from repo root)
```

Build the engine crates before the Tauri shell when iterating — they're
dependency-light and surface toolchain/linker issues fast.

## Conventions

- **Stubs are explicit:** unimplemented engine functions are `todo!("Mx: ...")`
  with the milestone noted. Don't wire a `todo!()` into a Tauri command or a
  passing test — keep CI genuinely green.
- **Commit style:** Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`,
  `refactor:`, `test:`). Each commit compiles and passes tests.
- **Editing = commands.** Every mutation is a reversible `EditCmd` applied in
  Rust; `apply` returns its inverse and the changed rows. Invalidate the
  affected row coordinate indexes and the consensus/conservation caches on edit.
- **Tests:** parser against messy fixtures; NW/SW vs hand-worked cases;
  coordinate round-trip + edit/undo invariants via `proptest`. Add a test only
  if it can fail for a real defect.

## Milestone status

- **M0 scaffolding — done.** Workspace builds; tolerant FASTA parser + coordinate
  API (property-tested); `parse_summary` IPC round-trip; CI; public repo.
- **M1 model + parsing + coordinates — code complete, green.** Gap-preserving
  parser (case-preserved, `.`→`-`, `ParseOutcome` warnings: dup-name/empty/
  malformed); `Dataset::from_records` (trailing-pad-only invariant, derives
  ungapped `Sequence`s); `Composition` stats + `align-cli composition`;
  construction round-trip proptest; per-feature fixtures; `load_alignment(path)`
  (Rust reads the file) + `dialog:allow-open` capability; "Open file…" UI.
  Done: GUI smoke + commit (`301c561`) + push; CI green. See `docs/plans/m1-*`.
- **M2 — in progress.** Rendering MVP: virtualized Canvas2D grid from the
  in-memory buffer. Landed + green: binary render-buffer IPC (raw bytes, once per
  load); frontend model/coords (col→ungapped parity-guarded vs `coords.rs`);
  canvas core (colors / glyph atlas / LOD tiers / rAF draw loop, all outside the
  React render cycle); `ui/Grid` container with drag/wheel pan + ctrl-wheel zoom;
  pinned name column + scroll-synced ruler; **status-bar readout** (hover →
  `ui/hover.ts` `computeHover` → column + ungapped position + residue, gap → "—",
  never "length" — the first UI exercise of the col→ungapped parity logic). A
  floating hover tooltip was built then dropped by request — the readout lives
  only in the bottom status bar; a **zoom indicator** (`N px/cell · tier`) sits at
  the right of the status bar. **Perf fixture** landed: `align-cli generate
  <rows> <cols> <out.fasta> [gap_pct]` (bytes straight to a file from Rust — not
  stdout, which PowerShell would corrupt to UTF-16LE+BOM; SplitMix64, no `rand`
  dep; gitignored `fixtures/generated/`). **Manual fps smoke passed** (human at
  `tauri dev`, 2026-06-22): 10k×10k loads, panning smooth by observation across
  all tiers incl. the zoomed-out density tier; **fps not numerically measured**
  (no meter that run) — target met by observation, not a number; no-per-frame-IPC
  + single-canvas confirmed in source. NB **10k×10k is the stress ceiling, not the
  design target** — the program isn't aimed at that many sequences. **Keyboard
  navigation + floating overlay scrollbars** landed and green (committed
  `b8664e2`, user-confirmed): arrows/Page/Home/End + Ctrl/⌘+Home/End reach the
  last row/col; macOS-style overlay thumbs (pure round-trip-tested geometry in
  `render/scrollbar.ts` + a `ScrollbarsLayer` `Drawable`); `viewport.ts` gained
  the `scrollTo` clamped absolute-scroll reducer. **Track lane + minimap — code
  complete + green; GUI smoke PASSED (2026-06-24, user "all works"); committed
  `6b6f8b5`, CI green — M2 COMPLETE.** The last two M2 rendering items, both
  `Drawable`s on the shared rAF loop. **Track lane** (`render/TrackLaneRenderer.ts`):
  a FULL painter built now (user chose "full painter" over a zero-height seam) —
  empty in M2 (paints only chrome bg + bottom separator), but sized like the ruler
  (grid `1fr` width × `TRACK_H` 18px) so M4 drops consensus/conservation in with
  scroll-sync + `colToX` pixel-alignment already wired; laid out as **row 2** of a
  now-3×2 `.grid-container` with a muted "tracks" gutter label. **Minimap**
  (`render/MinimapLayer.ts`): a whole-alignment overview = a **downsampled
  occupancy aggregate** (non-gap fraction per bucket over the density color, the
  same reduction the density LOD tier uses) built **once per load** into a small
  offscreen canvas (`≤2048×256`) and `drawImage`-scaled to fill the strip each
  frame — NOT a scaled full draw, so per-frame cost is one blit + one rect. Pure
  geometry in `render/minimap.ts` (`viewportRectInMinimap` + `minimapToScroll`,
  round-trip unit-tested, 9 tests); full-shell-width strip below the grid
  (`MINIMAP_H` 56px, own `ResizeObserver`); the "you are here" rectangle follows
  scroll/zoom and **click/drag navigates** (`minimapToScroll` is the exact inverse
  of the drawn rect; `store.scrollTo` clamps). Aggregate cache keyed by
  `AlignmentView` identity (rebuilds on load); `minimap.invalidate()` wired into
  `runEdit`/`applyResynced` for in-place edits. Device-px (draw) vs CSS-px
  (interaction) kept internally consistent via ratio geometry. Plan/context/tasks
  in `docs/plans/m2-*`.
- **Selection (M5 slice) — code complete + green; GUI smoke PASSED, committed.**
  Spreadsheet-style cursor + rectangular selection (click selects; **left-drag
  rubber-bands a rect**; arrows move the cursor with the view scroll-following;
  Shift+arrows / Shift+click extend a rect), the foundation for copy (Phase 2: Tauri
  `clipboard-manager`) and delete/edit (rest of M5, reversible Rust `EditCmd`).
  Pulled ahead of M4 at user request. Landed (typecheck/build/vitest green, 144
  tests): pure model `state/selection.ts` (`moveCursor` COLLAPSES to `active+delta`;
  reducers clamp to dims); pure `viewport.scrollIntoView`; store selection state +
  mutators (move/extend scroll the active end into view atomically; `setDims` clears
  it); `render/SelectionLayer.ts` and the **arrow keys reworked from panning (M2) →
  cursor movement** (Home/End/corner via a clamped `FAR` delta — last cell still
  reachable; `cellAtPixel` factored out of `hover.ts`).
  **Look (settled during GUI smoke, user-confirmed 2026-06-23):** the selection
  COLOR-INVERTS the cells beneath it (overlay canvas with CSS `mix-blend-mode:
  difference` → `255 − backdrop`; `.grid-canvas-cell` is `isolation: isolate` so the
  blend hits only the grid canvas), with a **thick black border** on a SECOND,
  non-blending canvas stacked above (one `SelectionLayer` owns + sizes both canvases
  in one `resize`; z-index grid 0 / invert 1 / border 2 / scrollbars 3; border
  constants `BORDER`/`BORDER_PX` in `SelectionLayer.ts`). In a multi-cell rect the
  active cell's white is cleared so it shows its true color (a single-cell cursor
  just inverts). Tried then dropped along the way: a floating tooltip, a
  translucent-tint fill, an inversion-only no-border look — current = inversion +
  black border. **Mouse remap (also this batch):** left-drag = rubber-band select,
  **middle-drag = pan** (reverses the plan's "left-drag stays pan"); a left press
  under a 4px threshold is a click → cursor; Shift+click/Shift+arrow extend; wheel +
  scrollbars still pan; `mousedown` `preventDefault` on button 1 kills WebView2
  middle-click autoscroll. Phase 2 (copy) and delete/edit are separate, not done.
  Full design + status in `docs/plans/selection-{plan,context,tasks}.md`.
- **Copy (clipboard, Batch A) — code complete + green; GUI smoke pending.** The
  read-only half of copy/paste/cut: copy the selected rectangle to the system
  clipboard as **Raw** (residues, one seq per line) or **FASTA** (`>name` +
  residues), **gaps kept (WYSIWYG)** so copy→paste round-trips. Tauri
  `clipboard-manager` plugin + a scoped `clipboard-manager:allow-write-text`
  capability (write only; compile-time validated). Copy runs frontend-side (the JS
  already holds the buffer + names — no mutation, Rust still owns truth); only the
  clipboard *write* crosses the seam (`ipc/clipboard.ts`). Pure `model/copy.ts`
  (`buildCopyText` + `COPY_CELL_CAP` 10M-cell guard, tested); `GridStore`
  selection-change listener (the coarse React mirror the selection foundation
  reserved) drives a new top **`ui/Toolbar`** (Sel readout + Copy button + Raw|FASTA
  toggle + ephemeral message); `Ctrl/⌘+C` triggers the same path. **Paste + cut are
  the M5 EDIT FOUNDATION**, split into Batches B (foundation), C (paste), D (cut).
  User-decided semantics (paste default = insert / shift-only-pasted-rows; shift-all
  toggle keeps the alignment; **cut default = shorten**, mask is the toggle; alphabet
  warn) and the model-fit proof (all modes legal via equal-width + trailing-pad) live
  in `docs/plans/copy-paste-{plan,context,tasks}.md`.
- **Edit foundation (Batch B) — code complete + green; GUI smoke PASSED
  (2026-06-23).** The reversible-edit machinery paste/cut/delete all build on. `align-core::edit`:
  `apply → Result<EditOutcome{inverse, changed_rows}, EditError>` is now real
  (**atomic** — validates every write before mutating) with the first concrete
  command `SetCells` (in-place overwrite; the inverse replays in reverse so
  overlapping writes round-trip); `EditStack` is an undo/redo history **over a
  `Dataset`** — `apply_to_dataset` wraps the matrix apply and **resyncs the derived
  ungapped `Sequence.residues`** for changed rows (so undo is lossless on derived
  state; nothing reads residues in B2, but features/export would). `AppState` gained
  `history: EditStack`, reset on every load. IPC: `clear_cells`/`undo_edit`/
  `redo_edit` return the **full post-edit render buffer** as raw bytes (same
  transport as `get_render_buffer`) — the changed-rows binary patch was dropped as a
  B2-only orphan (C/D change width and rebuild the view anyway). Frontend:
  `ipc/edit.ts` + `AlignmentView.replaceContents` (in-place buffer copy ⇒ same view
  object ⇒ **scroll + selection survive** the edit), and in `Grid` **Delete/Backspace
  = clear-to-gap** (the first reversible edit; spreadsheet-style mask, doubles as
  cut-mask), `Ctrl/⌘+Z` undo, `Ctrl/⌘+Shift+Z` / `Ctrl/⌘+Y` redo — all serialized via
  an `editingRef` in-flight guard (held-key safety). No new capability (custom app
  commands aren't capability-gated). NB **Delete-to-gap is a new user-facing key**;
  full-buffer-per-edit is fine at the design target, heavy only at the 10k×10k
  ceiling. **GUI smoke (2026-06-23) PASSED** after three fixes landed during it:
  (1) **open-after-edit "Out of Memory"** at the ceiling — the WebView2 renderer
  (not Rust: clean terminal; a throwaway headless repro proved the engine survives
  the worst case) failed a ~100MB *contiguous* allocation because `App.tsx::
  showAlignment` held the old view's buffer live while allocating the next; fix =
  **null `view`/`summary` before the fetch** so the old buffer is reclaimed first
  (user re-test: Ctrl+A→Delete alone survives the ~200MB edit transient, crash
  gone ⇒ open-path churn, not the per-edit transport ⇒ no transport shrink); (2)
  **edit/nav keys now fire without grid focus** — `Grid` binds `onKeyDown` on
  `window` with an editable-target guard (input/textarea/select/contenteditable →
  bail); (3) **gaps render `-`** (`Canvas2DRenderer` `GAP_GLYPH`) instead of a
  blank fill.
- **Residue palette — vivid default + always-black glyph ink (this batch).**
  `render/colors.ts`: `VIVID_SCHEME` is the default (A green `#22C32A`, C azure
  `#2E90FF`, G yellow `#FFD21A`, T/U red `#FF2A2A`); `CLASSIC_SCHEME` (conventional)
  and `COLORBLIND_SCHEME` (CVD-safe) remain selectable via the registry. Glyph ink
  is a single black (`GLYPH_INK`) for every residue/scheme — `inkStyleFor` is now a
  uniform table. Asserted in `colors.test.ts` (`DEFAULT_SCHEME_ID === "vivid"`).
- **Paste (Batch C) — code complete + green; GUI smoke PASSED (2026-06-24, user "all
  works").** Clipboard → alignment, in three landed slices on the Batch-B edit foundation:
  **C1** overwrite (clamp→later grow), **C2** insert shift-only (the first width-CHANGING
  edit, via the general `EditCmd::SpliceRows` primitive; transport unified on
  `AlignmentView.resizeContents`, so width-changing undo/redo works for free), **C5** (a)
  **FASTA clipboard ⇒ insert NEW sequences** (not residues spliced into rows) — first
  row-COUNT-changing edit, Dataset-level `EditCmd::InsertRows`/`DeleteRows` dispatched in
  `apply_to_dataset`, `paste_sequences(at,text)` parses via tolerant `parse_fasta`, frontend
  re-syncs through the LOAD path (`getAlignmentMeta`+`getRenderBuffer` → `replaceAll`); (b)
  **Insert|Overwrite toggle** (default Insert) for raw block paste, Overwrite **grows-to-fit**
  (never truncates horizontally; rows past the bottom dropped). **THE LANDMINE (fixed):** a
  generic undo/redo can reverse a row-count change, so undo/redo route through a full
  meta+buffer resync (`runResyncEdit`) — confirmed in the smoke. Routing is `looksLikeFasta`
  (first non-blank line `>`). **Toolbar messages** carry a tone — `warn` (failures / dropped /
  truncated rows) = **bold red**, `info` = plain — and **persist until the user's next action**
  (no auto-timeout; a passive `useEffect` keyed on the message arms capture-phase
  keydown/mousedown/wheel listeners that clear it — the effect runs post-event so the producing
  event can't self-clear; also cleared on file-open). **C3 within-insert shift-all toggle —
  code complete + green; GUI smoke PASSED 2026-06-24 (user "all works").** A third segmented toolbar toggle (`shift`
  label + `Pasted | All`) wires the engine's already-tested `shift_all` flag (default
  `Pasted` = shift only the pasted rows / ragged; `All` = insert gaps in every row so columns
  stay aligned); the toggle is **disabled, not hidden, in Overwrite mode** (hiding would
  reflow the right-pinned message) — which needed a new `.toolbar-toggle button:disabled` CSS
  rule (the existing custom bg/color made a disabled toggle look active). The insert message
  appends `(kept aligned)` for shift-all so the modes are distinguishable. **C4 leftovers —
  code complete + green; GUI smoke PASSED 2026-06-24 (user "all works").** Three polish items:
  (1) **alphabet warn on paste**
  (frontend-pure `model/paste.ts::pasteAlphabetWarning` — advisory, warn-not-reject; flags
  non-IUPAC-nucleotide LETTERS for DNA/RNA alignments, Protein never warns; computed once in
  `doPaste` over `parseClipboard`, threaded into both paste paths, appended to the result
  message → tone warn); (2) **paste size-guard** (TWO caps: `PASTE_TEXT_CAP` 10M chars on the clipboard
  INPUT in `doPaste`; `PASTE_RESULT_CELL_CAP` 100M cells on the raw-block OUTPUT in `pasteRawBlock`
  — insert/grow-overwrite widen every row by `w`, an OOM vector the input cap can't catch, advisor-
  flagged); (3) **grow-to-fit for
  paste-as-sequences** — the alignment now WIDENS to the widest pasted sequence (existing rows
  trailing-pad) instead of truncating, built on a NEW general engine primitive
  **`EditCmd::Batch { commands }`** (atomic compound edit; sub-inverses reversed; rollback on
  sub-command failure). Grow = `Batch[SpliceRows(pad existing rows), InsertRows(wider rows)]` =
  one undo. A **blow-up guard** (`PASTE_GROW_CELL_CAP` 100M cells) falls back to clamp-to-width
  when a huge sequence × a tall alignment would OOM (the only remaining `truncated > 0` case);
  `pasteFasta` adds an "alignment widened to W" info note. align-core 28 / iberalign 18 / 172
  vitest; clippy + fmt clean. Advisor-reviewed (post-commit): closed the raw-block output-cap gap
  + added an interior-row (`at < num_rows`) grow undo/redo test. Detail in
  `docs/plans/copy-paste-{plan,context,tasks}.md`.
- **Cut (Batch D) — code complete + green; GUI smoke PASSED (2026-06-24, user "all works").** The last copy/paste/cut piece:
  **cut = COPY then REMOVE**, two modes via one toolbar toggle (default **shorten**, user-decided;
  mask is the toggle). Built D1+D2+D3 together. **Cut-shorten** deletes the selected columns in
  the selected rows and shifts each cut row's tail left, trailing-padding `W` gaps back to width —
  so **the alignment KEEPS its overall width** (it does not narrow; it adds trailing-gap columns to
  the cut rows). **Deviation from the plan's `DeleteBlock`/`SpliceRows` (advisor-greenlit):** because
  the cut rows pad back to width the per-row net length change is ZERO, so it is a width-PRESERVING
  **`SetCells`** (the most-tested primitive, fast in-place transport, no `WidthMismatch` path); the
  captured old tail bytes give the re-insert inverse for free. New `commands.rs::cut_shorten_writes`
  (sibling of `gap_fill_writes`, but it **reads** each row's bytes to build the shifted tail, so it
  **clamps `r1` to the last row** + bails on `r0 >= num_rows` — a stale index would otherwise *panic*
  the direct row access; advisor) + `cut_shorten` command + `lib.rs` registration. **Cut-mask** ==
  copy + the existing `clear_cells` (no new backend). Frontend: a shared **`writeClipboard(rect, dims)`**
  extracted from `doCopy` (text + `COPY_CELL_CAP` guard + clipboard write → boolean) reused by Copy and
  Cut; effect-scoped `doCut` (copy FIRST, and **only remove if the copy reached the clipboard** — else a
  cut would silently lose data; then `runEdit(cutShorten | clearCells)`); `Ctrl/⌘+X`; Toolbar `Cut`
  button + `Shorten|Mask` toggle (`CutMode` type). **Cut is `COPY_CELL_CAP`-capped even in mask mode**
  (it must reach the clipboard); plain **Delete stays the uncapped masking escape hatch**. No new
  capability (clipboard WRITE already granted; custom commands aren't capability-gated; cut writes, so
  no READ perm). align-core 28 / iberalign 22 (+4) / 172 vitest; clippy + fmt clean. Detail in
  `docs/plans/copy-paste-{plan,context,tasks}.md`.
- **Structural row/column delete (Batch 1) — committed `aae3b5d`.** Selection grew a
  `SelectionMode` (`cell`/`rows`/`cols`); header-click gestures select whole rows (name
  gutter) / columns (ruler); `delete_rows`/`delete_columns` IPC commands remove them
  structurally (reversible via the engine `EditCmd` stack); Delete-key `Shorten|Mask`
  toggle. Foundation for the consensus-track work (Batch 2/3 below).
- **Copy/selection refinements — code complete + green; GUI smoke PASSED (2026-06-24).**
  Three follow-ups landed together on top of the delete batch: **(R1) empty rows ↔ empty
  FASTA round-trip** — FASTA copy of an all-gap slice → bare `>name`, and pasting it back
  recreates the named empty sequence (opt-in `ParseOptions{keep_empty_records}` +
  `parse_fasta_with`; `paste_sequences` opts in; loader/CLI keep skip-and-warn);
  **(R2) header inversion** — in rows-mode the selected names in the left gutter invert,
  in cols-mode the selected numbers in the ruler invert, so whole-row/col selection reads
  clearly (`NameColumnRenderer`/`RulerRenderer` take `getSelection`/`getMode`);
  **(R3) trailing-edge gap discard in FASTA copy** — FASTA copy strips each sequence's
  trailing run of gaps (right-pad isn't biological), keeps interior gaps; **raw stays
  WYSIWYG; the live matrix is untouched (serialization only)** (`model/copy.ts::stripTrailingGaps`).
  align-core 30 / fmt + clippy clean / typecheck clean / **190 vitest** / build OK. Detail in
  `docs/plans/copy-paste-tasks.md` + `selection-tasks.md` (Refinements sections).
- **Keyboard nucleotide entry (Replace/Insert) — code complete + green; GUI smoke
  PASSED (2026-06-24, user "all works").** Type a residue at the cursor to write it:
  **Replace** (default) overwrites in place (`pasteOverwrite` → width-preserving
  `SetCells`); **Insert** splices a new column into the ACTIVE sequence only
  (`pasteInsert(…, shiftAll=false)`; other rows trailing-pad to stay rectangular) so the
  alignment grows. The cursor advances right after each keystroke (`moveCursor`); the
  **Insert key** and a Toolbar `type: Replace|Insert` toggle switch modes. Pure
  `model/typing.ts::isResidueKey` (letters either case — soft-masking — plus `- . * ?`;
  multi-char nav/control keys excluded; gated `!ctrl && !meta && !alt` so Ctrl+A etc. still
  pass) + `typing.test.ts` (5). ZERO new Rust — rides the tested paste primitives;
  serialized via `editingRef`; each keystroke is its own undo step (no coalescing yet).
- **IUPAC consensus track (Batch 2) — code complete + green; GUI smoke PASSED
  (2026-06-24, user "all works").** The M2 empty `TrackLaneRenderer` now paints a
  per-column consensus row, column-aligned + scroll-synced under the grid, LOD-aware
  (letter tier = color fill + glyph; block/density = fill only). Pure
  `model/consensus.ts::columnConsensus(view, r0, r1)`: DNA/RNA → STRICT presence-union
  IUPAC (any base present joins the code — user's choice 2026-06-24, no threshold;
  ambiguity codes expand; RNA emits `U` for pure-T; all-gap → `-`); Protein → plurality
  (ties → smallest byte). Memoized by view identity; `invalidate()` wired into the edit
  paths. `consensus.test.ts`. Gutter label is still `cons` (rename → "Consensus" is a
  Quick-Win in the roadmap below).
- **Consensus + coloring + shell — large multi-batch; PLANNED, not started.** A big set
  of user requests (2026-06-24), captured in `docs/plans/consensus-coloring-plan.md`:
  a configurable consensus (gap-handling pipeline ignore/gap-priority/star → agreement
  rule strict-IUPAC/all-identical/same-type{R-Y|majority-base|IUPAC-class}/majority(>50%)
  → no-consensus fallback gap/`*`), a consensus options **dialog**, track + main-grid
  **conservation coloring**, a **menu bar** replacing the flat toolbar (user-chosen over a
  gear-dropdown), spacebar→gap, `cons`→`Consensus`, minimap sharpness. Backbone = one
  cached per-column `profile(view, r0, r1)` deriving the consensus byte AND both colorings.
  Phasing (user picks the order): Quick-wins → engine → dialog → coloring → shell; Batch-3
  (track selectable + copy-as-IUPAC) folds in. Advisor-reviewed; user-decided the four open
  questions (menu bar; same-type exposes all 3 displays; track+grid coloring both; majority
  default strict >50%).

## Dev-docs

Per work batch, keep `docs/plans/<batch>-{plan,context,tasks}.md` current:
the accepted plan, key files/decisions, and the remaining checklist. Update them
(and this file) at the end of a batch, before committing.
