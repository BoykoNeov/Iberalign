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
- **MSA is in-process, never shelled out** (user decision 2026-06-29: no shell
  integration for alignment). Optimal MSA is NP-hard, so don't claim optimality or
  try to reimplement MAFFT. Our own *progressive* aligner (ClustalW-class:
  all-pairs distance → UPGMA → profile–profile Gotoh) lives in `align-core::msa`,
  built on the hand-written *pairwise* NW/SW (Gotoh affine) in `align-core::align`.
  Higher quality comes from bundling *permissively licensed* aligners
  **in-process** (compiled-in/FFI — the MEGA model), never from a subprocess.
  **This is now real: KAlign v3 (Apache-2.0) is compiled-in** as a selectable
  second backend (Align → Engine: Progressive | KAlign). **The FFI lives in a
  separate feature-gated crate `align-extern` — `align-core` stays pure and
  FFI-free.** The `kalign` feature is OFF by default (default builds + CI stay
  pure-Rust, no submodule / C toolchain); a dedicated Windows CI job covers it.
  Phylogenetic **trees** still shell out to FastTree/IQ-TREE (separate concern).
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
npm run tauri:dev                               # full app — PREFERRED (clears stale state first)
npm run tauri dev                               # full app, raw (no pre-clean — may hit the hang below)
```

Build the engine crates before the Tauri shell when iterating — they're
dependency-light and surface toolchain/linker issues fast.

**Windows dev-launch hang.** A `tauri dev` stopped uncleanly leaves orphans that
make the next launch fail or hang at 0% CPU: a stale Vite on **port 1420**
("Port 1420 is already in use"), a stale `iberalign.exe` holding the
`target\debug\iberalign.exe` lock, or an orphaned `cargo` holding the artifact-dir
lock ("Blocking waiting for file lock"). The 0%-CPU stall is a LOCK, not a slow
linker. Fix: **use `npm run tauri:dev`** (or `npm run tauri:kalign`) — both run
`scripts/dev-clean.ps1` first to free port 1420 + kill stale `iberalign.exe`/`cargo`
(surgical: only the port-1420 owner + those image names; never node broadly). For a
cold-launch stall (no orphans), exclude `target\` from Defender:
`Add-MpPreference -ExclusionPath "M:\claud_projects\IberPrime\target"` (run elevated).

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
- **Trailing-gap padding renders FAINT GREY — GUI smoke PASSED (2026-06-25, user "all
  works").** Smoke-driven follow-up: insert-mode "appears to grow all sequences" because
  splicing a column into the active row trailing-pads every OTHER row to keep the matrix
  rectangular (the trailing-pad-only invariant — buffer MUST stay rectangular, so this is
  a RENDER fix, not an engine change). The grid draws each row's trailing gap run (gaps
  past its last residue) as a recessive grey fill (`ColorScheme.trailingStyle` =
  `[230,230,230]`) with NO `-` glyph — so rows read "ragged right" instead of looking
  grown; INTERIOR gaps still show as full gaps. (Shipped as bare BACKGROUND first; user
  smoke-passed it, then chose faint grey `[241]`, then — too close to the `[250]`
  background to see (Δ9) — settled on `[230]`, GUI smoke PASSED 2026-06-25.) **Color
  resolution (advisor):** the interior-gap↔background band (`232`–`250`) is too narrow to
  fit a third clearly-separated grey, so trailing sits at ~gap lightness and is told from
  interior gaps by the ABSENT glyph, NOT by color — spending the contrast where the eye
  needs it (Δ20 vs background). `colors.test.ts` now asserts a PERCEPTIBILITY floor
  (`background − trailing ≥ 12`), not bare `!==` (the old `!==` passed at the invisible
  Δ9 — that's how `[241]` shipped). Generalized to ALL trailing
  padding (file-loaded ragged lengths, cut-shorten pad), advisor-confirmed as
  more-correct not scope-creep. New pure `model/trailing.ts::trailingGapStarts`
  (ends-in-residue → `width`, all-gap row → `0`; `trailing.test.ts` pins the boundaries);
  `trailingStyle` lives on `ColorScheme` (themeable; `colors.test.ts` asserts it ≠ gap,
  ≠ background). `Canvas2DRenderer` caches the per-row starts by view identity like
  occupancy and **drops them in `invalidateContentCaches`** (the in-place edit path
  reuses the view object — without the reset, insert shows the old padding boundary until
  reload); `drawCells` clamps fills + glyphs to `[cols.first, trailStart)` then paints one
  grey rect for the tail. Letter/block tiers only (density already fades gaps);
  trailing only. An all-gap row renders as a recessive-grey row. typecheck + 225 vitest +
  build green.
- **Consensus + coloring + shell — ALL PHASES COMPLETE; GUI smoke PASSED + committed +
  pushed (2026-06-29).** Phase 1 (quick wins, smoke 2026-06-25 + trailing-gap follow-up);
  Phase 2 (engine, `924a0c5`); Phase 3 (options dialog, smoke 2026-06-29, `65dba05`);
  Phase 4 (coloring — 4A data layer `e0eaf6a`; 4B renderers + 4C "Consensus & coloring"
  dialog section `674fb4b`; smoke 2026-06-29); **Phase 5 (shell — menu bar replacing the
  flat toolbar) + a Phase-5 follow-up (dialog help glyphs + draggable window), smoke PASSED
  2026-06-29.** Phase 5: **`ui/MenuBar.tsx`** (+ `.css`) replaces `ui/Toolbar.{tsx,css}`
  (deleted) — `Edit`/`View`/`Consensus` click-to-open dropdowns (`position:fixed` to escape
  the strip clip; outside-mousedown + Esc close; no backdrop so bar buttons switch in one
  click); mode groups are click-to-open `▸` flyout SUBMENUS (radio; the collapsed parent row
  shows the current value). `Edit` = Copy/Cut/Paste/Delete-seqs/Delete-cols + 6 mode submenus
  (copy format · paste mode · insert shift · cut mode · delete key · typing); `View` = Color
  scheme · Grid coloring · Track coloring + Show-consensus-track toggle; `Consensus` =
  Options… (the dialog). Right side keeps the selection readout + a compact destructive-mode
  glance-state (paste/cut/del) + the message. `Grid.tsx`: `schemeId`/`trackVisible` state +
  View quick-pick handlers that patch the SAME `coloringConfig` the dialog edits; live-apply
  effects (`[schemeId]`→all 3 renderers + minimap aggregate rebuild; `[trackVisible]`→
  `track.setVisible` + `--track-h:0` collapse so the grid reclaims the height); `menuOpenRef`
  keydown guard (mirrors `consensusOpenRef`) so Delete/arrows can't mutate the selection
  behind an open menu. `TrackLaneRenderer` gained `setColorScheme` + `setVisible`.
  **Follow-up:** every `ConsensusDialog` option row's left label carries an inline ⓘ help
  glyph (native `title` tooltip; the Full-vs-Conserved coloring answer lives in the
  "Consensus track"/"Main grid"/"Conserved at"/"Highlight" tooltips — highlight is GRID-ONLY,
  track "Conserved" keeps the glyph and only drops the fill); the dialog is drag-to-move by
  its header (pointer-capture, same pattern as the name-gutter selection; resets on reopen;
  never drags from ×). typecheck + **295 vitest** + build green. **The batch is closed** —
  only carry-over smokes remain (keyboard entry + strict-IUPAC track, low-risk). Detail in
  `docs/plans/consensus-coloring-{plan,context,tasks}.md`.
  <details><summary>Earlier phase notes (kept for reference)</summary>
  **Phase 2 (consensus engine) — pure model, NO UI, the consensus track is byte-for-byte
  unchanged** (typecheck + 253 vitest + build; +28 new tests; advisor-reviewed +
  back-compat verified byte-identical). New **`model/profile.ts`**: a per-column
  `ColumnProfiles` (structure-of-arrays — `nonGap`/`gap`/`topByte`[uppercase, smallest-byte
  tie]/`topCount`/`distinct`/`baseMask`) that the advisor confirmed is sufficient for EVERY
  rule AND both Phase-4 colorings (no full histograms; ~15 bytes/col; one reused 256-count
  table, column-major, `touched`-reset). New pipeline in **`model/consensus.ts`**:
  `consensusBytes(profiles, config, alphabet)` runs **gap short-circuit FIRST**
  (`gap-priority`/`star-if-gap`/`ignore`) → `nonGap==0→'-'` guard → agreement rule
  (`strict-iupac` | `all-identical` | `same-type{ry-code|majority-base|iupac-class}` |
  `majority{threshold}`) → `noConsensus` fallback (non-strict rules only). `columnConsensus`
  reimplemented on top via `defaultConfigFor(alphabet)` (DNA/RNA → strict-IUPAC; else →
  plurality == `majority@0`). **Four advisor fixes baked in:** RNA U-rewrite centralized in
  `decodeMask` (hits strict-iupac AND same-type/iupac-class); **integer-exact** majority
  threshold (`topCount*1000 > round(threshold*1000)*nonGap`, fp `>` mis-rounds 3/5 vs 0.6);
  `same-type/iupac-class` cutoff = **≤2 distinct bases** (OPEN QUESTION for the Phase-3
  dialog — defensible plain reading, must cut below 4 or it's strict-iupac; user hasn't
  explicitly confirmed); pipeline order pinned so `star-if-gap` reaches an all-gap column.
  **Profile caching is deferred to Phase 4** (transient profile per `columnConsensus` call;
  the track's by-view byte cache is untouched). Known limitation: `majority-base`/
  `iupac-class` can echo a literal ambiguity code (`R`/`N`/`*`) from malformed source data.
  See `docs/plans/consensus-coloring-plan.md` (Phase 2 status + Open questions). **Phase 1
  (quick wins)** (frontend-only;
  typecheck + 221 vitest + build green): **spacebar → gap** (new pure
  `model/typing.ts::residueForKey` maps space → `-`, residue-glyph → itself, else
  `null`-to-fall-through; `isResidueKey` stays strict; `Grid.tsx` keydown routes
  through it so space writes a gap at the cursor — Replace overwrites, Insert splices
  a gap column into the active row); **`cons` → `Consensus`** gutter label (renders
  `CONSENSUS`, uppercase kept, fits the 124px box); **minimap sharpness**
  (`MinimapLayer` sizes the aggregate to `min(content, strip-device-px, cap)` per axis
  ⇒ blit is upscale-or-1:1 ⇒ `imageSmoothingEnabled=false` unconditionally safe; cache
  keyed on the CLAMPED resolution so it rebuilds on a strip-resolution change but stops
  past the cap; the now-per-resize O(w×r) rebuild is a noted cost at the 10k×10k
  ceiling, debounce only if it janks); **insert-mode-only-grows-active-row** already
  correct in code (`pasteInsert(…, shiftAll=false)`), smoke-only. The rest of the batch —
  configurable consensus pipeline + conservation coloring + menu bar — is a big set
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
  </details>
- **M3 pairwise alignment — COMPLETE; all phases COMMITTED; GUI smoke PASSED + pushed
  (2026-06-29).** Hand-rolled Gotoh
  affine NW/SW in `align-core` (`align.rs` `pairwise(a,b,&matrix,mode,scoring)` — 3-state
  M/X/Y DP, `NEG=-1e9` sentinel, deterministic tie M>X>Y, %-identity = identical-non-gap-
  cols / length) + `matrix.rs` `SubstitutionMatrix` (BLOSUM62/45/80 + PAM250 + match/
  mismatch; symmetry + reference-cell validation tests; `by_name`/`default_for`).
  **Committed:** Phase A engine + Phase B CLI (`align <a> <b> [--mode --matrix --gap-open
  --gap-extend]`) = `85b2252`; Phase C `pairwise_align(row_a,row_b,mode,matrix?,gap_open?,
  gap_extend?)` command (reads UNGAPPED residues, applies a reversible `SpliceRows` via
  `realign_splice` — replace the 2 rows padded to `target=max(W,aligned)` or `W` when only
  2 rows, widen others; returns `{score,percent_identity,length}` DTO) + `ipc/edit.ts::
  pairwiseAlign` wrapper = `b5d5305`. **Phase D (UI) is GLOBAL-ONLY, COMMITTED + pushed**
  (typecheck / 295 vitest / build green; GUI smoke PASSED 2026-06-29, user "all works") —
  `Grid.tsx` (`doAlign`) + `MenuBar.tsx` (Align menu) + the `commands.rs` empty-result guard,
  landed atomically. **User-decided 2026-06-29:** (1) **NO lossy in-place edit ⇒ GLOBAL only** —
  the Local (SW) option was REMOVED from "Align selected" (in-place Local trims rows to the
  matched region, discarding residues); the engine + CLI KEEP Local for a future
  non-destructive view/report. (2) **Adjacent-only** for now (selection is one rectangle ⇒
  contiguous rows). The Align menu = a single "Align selected sequences" action (disabled
  <2 rows; <2 ⇒ "select 2", 3+ ⇒ "needs MAFFT"); `doAlign` aligns the two WHOLE ungapped
  rows Global and IGNORES the selection's column extent. **Block/sub-area align +
  non-adjacent multi-select — DESIGN DECIDED 2026-06-30 (design-only session, no code yet;
  see `docs/plans/block-align-{plan,context,tasks}.md`).** Block align (build next session):
  a **sub-column** selection (window `[c0,c1]`) re-aligns only the windowed ungapped
  residues, leaving other cells untouched; a **full-width** selection keeps today's
  whole-row align (additive — whole-row path stays byte-for-byte unchanged). Width overflow
  (`wblock > worig`) ⇒ a **choosable `Grow | Fit` toggle, default `Fit`** (Fit packs in
  place when it fits, else refuses "needs N more cols — widen or Grow"; Grow inserts
  columns) — **no constrained-width DP, no new `EditCmd`** (Fit = `SetCells`, Grow = mixed
  `SpliceRows`). Implicit trigger (user's choice over the advisor's explicit-toggle pick;
  trade-off recorded — reversible to an explicit toggle later). **Non-adjacent / N≥2
  multi-select is a SEPARATE, explicitly-gated milestone** — the backend already takes
  `Vec<usize>` (`msa_align`); the cost is the cross-cutting frontend selection rework
  (copy/cut/delete too). Local stays deferred as a read-only view.
- **Progressive MSA (in-process, N≥2) — code complete + green; all phases COMMITTED;
  GUI smoke PASSED (2026-06-30).** Our own ClustalW-class progressive aligner now backs "Align
  selected sequences" for **N≥2** — the old "needs MAFFT" warning is GONE (2 rows still
  route to pairwise; 3+ route to the new MSA). **In-process, no shell** (architecture
  invariant). **Phase A engine** (`align-core::msa`, `19fca13`): all-pairs global
  `pairwise` → distance `d = 1 − %id/100` (`i<j` triangle mirrored) → **UPGMA** guide
  tree fused into the merge loop (deterministic smallest-index-pair tie-break,
  leaves→root) → `Profile` (equal-width rows + per-column residue counts, each leaf
  carrying its INPUT index) → profile–profile **3-state Gotoh** DP over columns (M>X>Y
  ties, affine column gaps, **integer** sum-of-pairs column score; inserting a gap column
  gaps every row of one profile) → `progressive_align(seqs,&matrix,scoring) ->
  MsaResult{rows,length}` emitting rows in INPUT order (N=0 empty, N=1 unchanged). Tests:
  keystone 1×1 byte-exact vs `pairwise`; fidelity/equal-width/input-order/N=0/N=1/one-
  empty/all-identical/guide-tree-grouping/determinism (9 unit + 2 proptest), plus a
  **3-seq quality anchor** guarding against over-gapping (`5cf28d2`). **Phase B CLI**
  (`19fca13`): `align-cli msa <file.fasta> [--matrix --gap-open --gap-extend]` (alphabet
  widened over ALL records → `default_for`). **Phase C IPC** (`39ee16c`): `realign_splice`
  generalized to `msa_splice(ds,rows,aligned)` (`target = w` when rows==all else
  `max(w,cur)`); `msa_align(rows,matrix?,gap_open?,gap_extend?)` validates the row list
  (in-bounds/sorted/dedup/≥2), widens the alphabet over all rows, degaps, runs
  `progressive_align`, applies `msa_splice` (reversible N-row splice), skips when
  `length==0`, returns `MsaResultDto{num_seqs,length}`; `ipc/edit.ts::msaAlign` wrapper.
  **Phase D UI** (`ed1af00`): `Grid.tsx::doAlign` routes 3+ rows ⇒ `msaAlign(rowList)`,
  2 rows ⇒ `pairwiseAlign` unchanged, readout `N sequences · L cols`, undo/redo ride the
  existing `runEdit`+`getRenderBuffer` route; `MenuBar.tsx` Align copy updated (2 ⇒
  pairwise, 3+ ⇒ progressive MSA), `canAlign = rows>=2`. Like pairwise, **column extent is
  IGNORED — whole ungapped rows are aligned** (sub-area/block align stays deferred).
  align-core + iberalign + 295 vitest + clippy + fmt green. **GUI smoke PASSED (2026-06-30,
  user "all work"):** steps 1–5 confirmed (3+ DNA → rows replaced + `N sequences · L cols`
  readout; Ctrl+Z restores; 2 rows still pairwise; protein picks the right default matrix;
  column-subset selection aligns whole rows). Step 6 (all-gap row in selection) NOT
  GUI-exercised (no all-gap row in the fixture) but **engine-covered by the `one-empty` unit
  test** (all-gap row degaps to empty → `progressive_align` emits it gapped to consensus
  width). Smoke fixtures: `fixtures/smoke-msa-{dna,protein}.fasta`. Higher quality later
  via bundling permissive aligners in-process (KAlign v3 Apache-2.0, POA/`spoa` MIT — the
  MEGA model). Detail in `docs/plans/progressive-msa-{plan,context,tasks}.md`.
- **In-process KAlign v3 backend (compiled-in quality engine) — code complete + green;
  Phases 0/C/A/D/E committed + pushed; GUI smoke PASSED (2026-07-01, user "all works").**
  KAlign v3.5.1 (Apache-2.0,
  ≈MUSCLE/Clustal) is now a selectable second MSA backend alongside the progressive
  aligner (**Align → Engine: Progressive | KAlign**). **`align-core` stays pure** — all
  FFI lives in the new feature-gated crate **`crates/align-extern`**; the `kalign` feature
  is OFF by default so default builds + CI stay pure-Rust (no submodule / C toolchain).
  **Phase 0 spike (GO):** KAlign builds under MSVC 2022 via the **`cc` crate (no CMake —
  it isn't installed and we don't force it on contributors/CI)**; minimal contained shims,
  ZERO upstream patches (exclude `msa_cmp.c` — its lone VLA is the only blocker and the
  `kalign()` align path never calls it). **Phase C (`28e0521`):** KAlign vendored as a git
  submodule pinned to **v3.5.1** under `crates/align-extern/vendor/kalign`; `build.rs`
  compiles the 35-file source list + force-includes `shim/kalign_compat.h` (MSVC compat) +
  stub POSIX/intrinsic headers; safe wrapper `align_extern::kalign_align(seqs, alphabet)
  -> Result<MsaResult, ExternError>` (legacy `kalign()` entry; v3.5.1 `KALIGN_TYPE_*`
  **DNA=0/RNA=2/PROTEIN=3** — differ from `main`!; `n_threads=1` deterministic; negative
  gaps ⇒ KAlign's tuned defaults; frees the malloc'd `char***`). Verified: input-order
  preserved, deterministic, **case-preserved** (soft-masking), debug+release link clean.
  **Phase A (`897c31e`):** pure `align_core::MsaEngine { Progressive, Kalign }`; `msa_align`
  command + `align-cli msa --engine` dispatch (both gain an optional `align-extern` dep
  behind a `kalign` feature; selecting kalign without it ⇒ clear "not built" error).
  **Phase D (`0738d7e`):** `ipc/edit.ts::msaAlign` engine arg; `Grid.tsx` engine state/ref
  + `doAlign` dispatch (2-row pairwise keeps its score readout under Progressive; KAlign
  aligns N≥2 uniformly); `MenuBar` Align → Engine submenu; **`npm run tauri:kalign`** /
  `tauri:build:kalign` scripts (the GUI needs `--features kalign` to use KAlign). **Phase E:**
  dedicated **Windows CI job** builds/tests `align-extern --features kalign` (submodule
  checkout); root **NOTICE** attributes KAlign (Apache-2.0). **GUI smoke PASSED (2026-07-01,
  user "all works")** via `npm run tauri:kalign` (align triggers on the Align action, not on
  the Engine radio — a first-run gotcha the user hit: switching engines doesn't align; you
  must click "Align selected sequences"). The carry-over smokes (keyboard nucleotide entry
  Replace/Insert + strict-IUPAC consensus track) also PASSED this session. **Default still
  Progressive** — the remaining follow-up is a decision, not a smoke: flip the default to
  KAlign + decide release-shipping (kalign-on release build). **Deferred:** pure-Rust POA
  (dropped per user — build proven so the seam-prover was redundant); block/sub-area align.
  Detail in `docs/plans/extern-aligner-{plan,context,tasks}.md`.

## Dev-docs

Per work batch, keep `docs/plans/<batch>-{plan,context,tasks}.md` current:
the accepted plan, key files/decisions, and the remaining checklist. Update them
(and this file) at the end of a batch, before committing.
