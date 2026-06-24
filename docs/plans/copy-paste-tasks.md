# Copy / Paste / Cut — Tasks

Companion to `copy-paste-plan.md` / `copy-paste-context.md`.

## Batch A — Copy ✅ (code complete + green; GUI smoke pending)

- [x] Clipboard plugin deps (npm + Cargo) + `lib.rs` init + `clipboard-manager:
      allow-write-text` capability (compile-time validated).
- [x] `model/copy.ts` — `buildCopyText` (Raw/FASTA, gaps kept) + `COPY_CELL_CAP`;
      `copy.test.ts` (raw/fasta/single-cell/full-width/missing-name).
- [x] `ipc/clipboard.ts` — `copyText` seam (write only).
- [x] `GridStore.setSelectionListener` + notify from the write paths; `store.test.ts`.
- [x] `ui/Toolbar.tsx` + CSS — Sel readout, Copy button, Raw|FASTA toggle, message.
- [x] `Grid.tsx` — copy state/refs, `doCopy` (+ size guard), `Ctrl/⌘+C`, selection
      mirror → `selInfo`, Toolbar render.
- [x] Verify: typecheck ✓, 152 vitest ✓, `npm run build` ✓, `cargo build -p
      iberalign` ✓, `cargo fmt --check` ✓.
- [x] **GUI smoke (human, 2026-06-24): PASSED, all good.** `npm run tauri dev` →
      select a rect → Copy (and Ctrl/⌘+C) → paste into a text editor; Raw vs FASTA,
      gaps kept, the Sel readout, the size-guard message all confirmed.

## Batch B — Edit foundation ✅ (code complete + green; **GUI smoke PASSED** 2026-06-23)

- [x] **B1** `edit.rs`: `apply → Result<EditOutcome{inverse, changed_rows}, EditError>`
      (atomic — validates all writes before mutating); first concrete cmd `SetCells`
      (in-place overwrite, inverse replays in reverse for overlaps); `EditStack`
      undo/redo history over a **`Dataset`** (`apply_to_dataset` wraps the matrix
      apply + **resyncs derived ungapped residues** for changed rows so undo is
      lossless on derived state); `AppState{dataset, history}`, history reset on load.
      12 align-core tests (round-trip, width preserved, atomicity, overlap inverse,
      undo/redo, redo-fork, residue resync).
- [x] **B2** IPC `clear_cells`/`undo_edit`/`redo_edit` returning the **full post-edit
      render buffer** as raw bytes (advisor #1 — dropped the hand-rolled changed-rows
      binary patch; C/D change width and rebuild anyway, so the patch was a B2-only
      orphan). Frontend `ipc/edit.ts` + `AlignmentView.replaceContents` (in-place copy,
      same buffer object ⇒ scroll + selection survive). `Grid`: **Delete/Backspace →
      clear-to-gap** (the first reversible edit; doubles as cut-mask), `Ctrl/⌘+Z` undo,
      `Ctrl/⌘+Shift+Z` / `Ctrl/⌘+Y` redo, all serialized via an `editingRef` in-flight
      guard. Empty buffer ⇒ no-op ⇒ skip repaint. 2 view tests + 1 commands test.
- [x] Verify: align-core 12 ✓ + clippy ✓; `cargo test -p iberalign` 5 ✓; typecheck ✓,
      154 vitest ✓, `npm run build` ✓, `cargo fmt --check` ✓.
- [x] **GUI smoke (human, 2026-06-23):** select a rect → Delete (cells → gaps,
      repaint) → Ctrl+Z (restored) → Ctrl+Y (re-applied); scroll + selection survive;
      load a new file → undo stack cleared. **All PASSED.** Three follow-up fixes
      landed during the smoke (below) and were re-confirmed.

### B2 smoke fixes (2026-06-23)
- [x] **OOM on open-after-edit (FIXED).** Opening a 2nd large file right after an
      edit crashed the WebView2 renderer with "Error code: Out of Memory" (clean Rust
      terminal ⇒ renderer, not engine — confirmed by a throwaway headless repro that
      the pure engine survives the worst case). Cause: `App.tsx::showAlignment` held
      the old view's ~100MB *contiguous* buffer live while `getRenderBuffer` allocated
      the new one (+ the IPC transport copy) → contiguous-allocation failure. Fix:
      **null the view/summary BEFORE the fetch** so A's buffer is reclaimable before
      B's is allocated. User re-test: Ctrl+A→Delete *alone* on the 100MB fixture works
      (renderer survives the ~200MB edit transient), and the crash no longer
      reproduces ⇒ the trigger was open-path allocation churn, **not** the per-edit
      transport ⇒ no transport shrink needed. Consequence: a *failed* open now drops to
      the open screen rather than keeping A (Rust already swapped to B by then).
- [x] **Focus (FIXED).** `Delete`/`Ctrl+Z`/`Ctrl+Y`/`Ctrl+C`/nav now fire without the
      grid cell holding focus — `Grid` binds `onKeyDown` on `window` (was the grid
      cell), with a guard that bails when an editable field (`input`/`textarea`/
      `select`/`contenteditable`) is focused so real typing is never hijacked. The cell
      stays `tabIndex=0` + focused-on-click for a11y.
- [x] **Gap glyph (FIXED).** Gap cells render a `-` at the letter tier
      (`Canvas2DRenderer.ts` `GAP_GLYPH`) instead of a blank fill, so a gap reads as a
      gap and a deleted/masked cell visibly shows the dash.

### B2 design notes / known consequences
- **Delete = clear-to-gap (mask), Cut = remove + close up (shorten).** Delete is a
  *new user-facing key* (advisor #4) — spreadsheet-consistent with cut=shorten, but
  surfaced for veto.
- **Full-buffer transport** is fine at the design target; only heavy at the 10k×10k
  ceiling (the edit's ~200MB live transient survives; the *open-after-edit* peak was
  the crash, now fixed on the open path). Add a changed-rows patch later *only* if a
  profile shows width-preserving edits on big alignments are slow.
- **Undo memory:** the inverse stores the old bytes, so select-all-delete parks the
  whole old block per edit (ceiling consequence, not a target concern).

## Batch C — Paste

- [x] **C1** Paste overwrite ✅ (code complete + green; GUI smoke deferred to after
      C2 so the default *insert* mode exists — advisor). Clipboard read perm
      (`clipboard-manager:allow-read-text`) + `readClipboardText` seam; pure
      `model/paste.ts::parseClipboard` (split CRLF/LF, drop FASTA `>` headers so this
      app's unwrapped FASTA copy round-trips, drop trailing blanks, keep internal
      blanks) + 5 tests; Rust `paste_overwrite` cmd + `paste_overwrite_writes` helper
      (clamps: drop rows past the end, truncate to remaining width — width-preserving,
      reuses `SetCells`) + 3 tests; `ipc/edit.ts::pasteOverwrite`; `Grid` `doPaste`
      (read+parse OUTSIDE `runEdit`, guards empty/denied clipboard; overflow → clip +
      message; expands the selection to the pasted block), `Ctrl/⌘+V`, `runEdit` now
      returns a `boolean`; Toolbar **Paste** button. Verify: cargo fmt/clippy ✓,
      `cargo test -p iberalign` 8 ✓, typecheck ✓, 159 vitest ✓, build ✓.
- [x] **C2** Paste insert, shift-only-pasted-rows (default) ✅ (code complete + green;
      GUI smoke deferred to batch end). The first **width-CHANGING** edit. Built on a
      general engine primitive `EditCmd::SpliceRows { Vec<RowSplice{row,col,remove,bytes}> }`
      (chosen over a dedicated `InsertBlock`/`DeleteBlock` because per-splice old-byte
      capture gives a symmetric inverse — insert and the future cut-shorten are the same
      primitive, no inverse-coupling). Atomic: bounds pre-checked; the **equal-width
      result is a real `EditError::WidthMismatch`** (advisor — not a `debug_assert`,
      which would vanish in release and ship a corrupt buffer); one-splice-per-row IS a
      `debug_assert`. `apply` sets `aln.width` from the post-splice rows. Command
      `paste_insert(r0,c0,rows,shift_all)` + `paste_insert_splices` helper (target rows
      insert their gap-padded line at c0; others insert W gaps trailing (shift-only) or
      at c0 (shift-all) — **both flag paths implemented + tested now**; only `shift_all=
      false` wired in the UI, the toggle is C3). **Transport unified on `resizeContents`**:
      replaced `replaceContents` (in-place, threw on width change) — derives newWidth =
      bytes.len/numRows, reassigns buffer + meta.width on the SAME view object;
      `runEdit` always uses it + new `store.updateDims` (re-clamps, KEEPS scroll +
      selection, clamps+notifies on shrink). This makes width-changing **undo/redo** work
      for free. `App` header width follows via an `onResized` callback. `Grid.doPaste` →
      insert (shift-only), selects the inserted block, messages dropped overflow rows.
      Verify: align-core 17 (+5 splice) ✓, iberalign 11 (+3 paste_insert) ✓, clippy/fmt
      ✓, typecheck ✓, 160 vitest ✓, build ✓.
- [x] **C5** Paste FASTA as NEW sequences + Insert|Overwrite toggle ✅ (code complete +
      green; **GUI smoke PASSED 2026-06-24** — user: "all works"; the landmine
      undo/redo-across-row-count path held). Two user asks landed together:
      - **FASTA paste ⇒ insert new sequences** (not splice residues into existing rows).
        New Dataset-level engine commands `EditCmd::InsertRows { at, rows: Vec<RowData> }`
        / `DeleteRows { at, count }` (symmetric inverse like `SpliceRows`; ids/names
        captured for a lossless round-trip), dispatched in `apply_to_dataset` (structural
        — they own the whole `Dataset`, skip the matrix `apply` + residue-resync). Rust
        `paste_sequences(at, text)` parses via the tolerant `parse_fasta` (wrapped FASTA,
        dup names free), clamps each seq to the alignment width (**warn** on truncate,
        grow-to-fit deferred), fresh non-colliding ids, returns a small JSON
        `PasteSeqDto{inserted, truncated}`. Frontend routes on `looksLikeFasta` (first
        non-blank line `>`); inserts at the selection top (append if none); re-syncs the
        view from `getAlignmentMeta` + `getRenderBuffer` via new
        `AlignmentView.replaceAll(bytes, names)` (row-count + names + width on the SAME
        object). **Landmine fixed:** undo/redo now go through the resync path
        (`runResyncEdit`) — a generic undo/redo can reverse a row-count change, and
        deriving width from a fixed numRows would corrupt the render.
      - **Insert | Overwrite toggle** (default Insert; the user pulled C4's toggle forward).
        Raw block paste routes on `pasteMode`. **Overwrite rewritten to GROW-to-fit**
        (`paste_overwrite_cmd`: `SetCells` when the block fits, `SpliceRows` when it runs
        past the right edge — never truncates horizontally; rows past the bottom dropped).
      Verify: align-core 25 (+8), iberalign 15 (+4), clippy/fmt ✓, typecheck ✓, 166 vitest
      (+6) ✓, build ✓.
- [x] **C3** Paste insert, shift-all toggle — **DONE + green** (this batch). Engine was
      already done (`shift_all` flag + `paste_insert_shift_only_*` / `paste_insert_shift_all_*`
      tests); pure toolbar wiring. `Grid` gained `shiftAll` state + `shiftAllRef` (default
      `false`) + `handleSetShiftAll`; `pasteRawBlock` reads `shiftAllRef.current` (forced
      `false` in Overwrite) and passes it to `pasteInsert` — replacing the hardwired `false`
      at the single call site. `Toolbar` got a third segmented toggle (`shift` label +
      `Pasted | All`), **disabled (not hidden, to avoid reflowing the right-pinned message)
      when mode is Overwrite** — which exposed a missing `.toolbar-toggle button:disabled`
      CSS rule (without it the custom bg/color made a disabled toggle look active); added it
      (opacity 0.5 + `cursor:default`, keeps the toggle-on fill). Message now appends
      `(kept aligned)` for shift-all so the modes are distinguishable in the readout (notes
      joined with the dropped-rows note). Stale text fixed: Insert tooltip no longer claims
      "shifting existing columns right" (that was shift-all); Ctrl+V comment updated.
      **Engine test strengthened:** `paste_insert_shift_all_keeps_columns_aligned` only
      asserted the forward result; since shift-all emits one splice PER ROW (a larger inverse
      than shift-only's one-per-pasted-row), added undo + redo round-trip assertions to cover
      the inverse (advisor-flagged as the highest-risk path). Verify: align-core 25, iberalign
      15, fmt ✓, typecheck ✓, 166 vitest ✓, build ✓. **GUI smoke PASSED 2026-06-24** (user:
      "all works") — ragged-vs-aligned visible on an interior paste, `(kept aligned)` shows
      only for All, undo/redo after shift-all round-trips, toggle dims in Overwrite.
- [x] **C4** leftovers — **DONE + green; GUI smoke PASSED 2026-06-24 (user "all works")** (this
      batch). The three remaining polish items (the Insert|Overwrite buttons + FASTA auto-detect
      landed in C5):
      - **Alphabet warn on paste** (frontend-pure, advisory — warn, never reject). New
        `model/paste.ts::pasteAlphabetWarning(lines, alphabet)`: flags residue LETTERS
        outside the alignment's alphabet. Only DNA/RNA flag (non-nucleotide letters, e.g.
        protein residues pasted into a DNA alignment — the IUPAC nucleotide set is accepted);
        a Protein alignment accepts every letter ⇒ never warns. Gaps / `*` / digits / case
        ignored. Computed ONCE in `Grid.doPaste` over `parseClipboard(text)` (headers/gaps
        stripped) and threaded into both paste paths, appended to the result message (bumps
        tone → warn). 6 new vitest tests.
      - **Paste size-guard.** TWO caps, because input length and output cells are different
        risks: `PASTE_TEXT_CAP` (10M chars, mirrors `COPY_CELL_CAP`) on the clipboard input —
        `doPaste` refuses over-cap before routing (also bounds the alphabet scan + IPC payload);
        and `PASTE_RESULT_CELL_CAP` (100M cells) on the raw-block OUTPUT — insert/grow-overwrite
        widen EVERY row by the block width `w`, so a single very long line into a tall alignment
        blows up to `numRows × (width + w)` cells, which the input cap can't catch (advisor —
        the FASTA path already has the engine-side `PASTE_GROW_CELL_CAP`; this closes the
        raw-block hole that C2/C3 shipped uncapped). `pasteRawBlock` refuses above it.
      - **Grow-to-fit for paste-as-sequences** (engine). Replaces clamp+truncate: the
        alignment WIDENS to the widest pasted sequence (existing rows trailing-pad), so
        nothing truncates — except the rare blow-up-guard fallback. Built on a new GENERAL
        engine primitive **`EditCmd::Batch { commands }`** (atomic compound edit: sub-commands
        run in order, batch inverse = sub-inverses REVERSED, rollback-on-failure; routes
        through `apply_to_dataset` since sub-commands may be structural OR matrix). Grow =
        `Batch[ SpliceRows(pad every existing row to the new width), InsertRows(the wider new
        rows) ]` = one undo. `commands.rs`: `grow_target_width` (grow / clamp / keep decision +
        `PASTE_GROW_CELL_CAP` = 100M-cell guard so one huge sequence × a tall alignment can't
        OOM) + `paste_sequences_cmd`. `PasteSeqDto.truncated` is now 0 in the common case
        (nonzero only in the cap fallback); `Grid.pasteFasta` adds an "alignment widened to W"
        info note. align-core +3 tests (Batch order/rollback/grow-round-trip), iberalign +6
        (`grow_target_width`, `paste_sequences_cmd` ×5 incl. an **interior-row** grow at `at=1`
        with undo+redo — advisor-flagged: the append-only grow tests didn't pin the
        DeleteRows-before-trim inverse ordering for `at < num_rows`). Verify: align-core 28,
        iberalign 18, clippy (incl. iberalign) / fmt ✓, typecheck ✓, 172 vitest ✓, build ✓.

## Messages — info/warn tone + persist-until-action ✅ (this batch)

- [x] `showMsg(text, tone)`; `warn` (failures / dropped / truncated) → **bold red**;
      `info` (copied / inserted) plain. `Toolbar` `message` prop → `{text, tone}`;
      `.toolbar-msg.warn` styling (light + dark). All call sites tagged.
- [x] **Messages no longer auto-expire** (user, 2026-06-24): the `setTimeout` auto-clear
      (`msgTimerRef`, 4.5s/2.5s) is removed; a message PERSISTS until the user's next
      action clears it (or a new message replaces it). A passive `useEffect` keyed on
      `copyMsg` registers capture-phase `keydown`/`mousedown`/`wheel` window listeners
      that clear it; because the effect runs AFTER the producing event has dispatched, that
      event can never self-clear (no `armed` flag needed — advisor-confirmed). The `[view]`
      effect also clears it on file-open so a prior file's message can't linger. Verify:
      typecheck ✓, 166 vitest ✓, build ✓.

## Batch D — Cut ✅ (code complete + green; GUI smoke pending)

Built D1+D2+D3 together (one Cut button + one toggle). **Cut = copy THEN remove.**
Advisor-reviewed before building (greenlit the `SpliceRows` → `SetCells` deviation
below + the `r1`-clamp fix).

- [x] **D2 (default) Cut → shorten** — delete the selected columns in the selected
      rows and shift each cut row's tail left, trailing-padding `W` gaps so the row
      keeps the alignment width. **Deviation from the plan's `DeleteBlock`/`SpliceRows`:**
      because the cut rows trailing-pad back to width, the net length change is ZERO, so
      this is a plain width-PRESERVING **`SetCells`** (the most-tested primitive; rides
      the fast in-place transport; no `WidthMismatch` path). The captured old tail bytes
      give the re-insert inverse for free. New `commands.rs::cut_shorten_writes` (sibling
      of `gap_fill_writes`, but it **reads** each row's bytes to build the shifted tail —
      so it **clamps `r1` to the last row** and bails on `r0 >= num_rows`; a stale index
      would otherwise *panic* the direct row access — advisor) + `cut_shorten` command +
      `lib.rs` registration. **The alignment keeps its overall width** (it does not narrow
      — it adds `W` trailing-gap columns to the cut rows); documented user decision —
      a GUI-smoke observation point, message stays neutral (`Cut C × R (shortened)`).
- [x] **D1 (toggle) Cut → mask** — clear the selected cells to gaps. No new backend:
      cut-mask == **copy + `clearCells`** (the existing Delete command). Message
      `Cut C × R (masked)`.
- [x] **D3 Cut toggle + button.** Toolbar `Cut` button (disabled when no selection) +
      a `Shorten | Mask` segmented toggle (`CutMode` type; default **shorten**).
      `Ctrl/⌘+X` mirrors the button.
- [x] Frontend wiring (`Grid.tsx`): `cutMode` state + `cutModeRef`; a shared
      **`writeClipboard(rect, dims)`** extracted from `doCopy` (build text + cap-guard +
      clipboard write → boolean) reused by Copy and Cut; effect-scoped `doCut` (copy
      FIRST via `writeClipboard`, and **only remove if the copy reached the clipboard** —
      else a cut would silently lose data; then `runEdit(cutShorten | clearCells)`),
      exposed via `doCutRef`; `handleCut` / `handleSetCutMode`. `ipc/edit.ts::cutShorten`.
- [x] **Cut is capped at `COPY_CELL_CAP`** even in mask mode (cut must reach the
      clipboard). Plain **Delete stays the uncapped masking escape hatch** — kept distinct
      in the refused-cut message ("Selection too large to copy …").
- [x] No new capability (clipboard WRITE already granted for copy; custom app commands
      aren't capability-gated). No new clipboard READ perm (cut writes, doesn't read).
- [x] Tests — engine helper in `commands.rs` (no new align-core primitive): shift-left +
      neighbors-untouched, through-history width-preserved + undo round-trip, single-cell,
      right-edge (empty `keep` ⇒ pure trailing gaps), stale-`r1` clamp + `r0`-past-end
      no-op. align-core 28 / **iberalign 22 (+4)** / 172 vitest; clippy (iberalign) + fmt
      clean; typecheck + build ✓.
- [ ] **GUI smoke (human):** select a rect → Cut (Shorten) → cells shift left, trailing
      gaps appear, width unchanged, block on the clipboard (paste elsewhere to confirm) →
      Ctrl+Z restores. Toggle to Mask → Cut clears to gaps (+ clipboard). `Ctrl/⌘+X`
      mirrors the button. Verify a `warn` message (e.g. cut with no selection) stays
      visible at a normal window width (toolbar is now full — advisor flag #4).

## Resolved (Batch D)

- **`SetCells` over `SpliceRows` for cut-shorten** (advisor 2026-06-24). Trailing-padding
  the cut rows back to width makes the per-row length change zero, so the honest primitive
  is the width-preserving overwrite, not a width-changing splice. Simpler, faster transport,
  no width-recompute path.

## Resolved

- [x] **Cut default = shorten** (user, 2026-06-23). Symmetric with the local paste
      default; mask-to-gaps becomes the toggle alternative.
