# Copy / Paste / Cut — Plan

The selection foundation (cursor + rectangular selection, committed `4215cd4`) is
the substrate; this is the **clipboard + editing** work built on top. Pairs with
`copy-paste-context.md` (where things live) and `copy-paste-tasks.md` (the
checklist). Design accepted by the user (with advisor review) 2026-06-23.

## The asymmetry that shapes everything

**Copy is small and read-only. Paste/cut are the M5 edit foundation in disguise.**

- **Copy** — the frontend already holds the residues (`AlignmentView.rowSlice`)
  and the names (`nameAt`). It builds the text in JS and only the clipboard
  *write* crosses to the Tauri `clipboard-manager` plugin. No mutation, so it does
  not touch Rust's authoritative state. ~one focused batch (**Batch A — done**).
- **Paste / Cut** — mutations. Per CLAUDE.md ("Rust owns the truth", "Editing =
  commands") they MUST go through a reversible Rust `EditCmd`. That machinery does
  not exist yet: `crates/align-core/src/edit.rs::apply` is `todo!()` and the
  undo/redo stack in `src-tauri/src/state.rs` is a comment. So paste/cut == build
  the edit foundation (apply/inverse + undo stack + changed-rows buffer patching),
  which delete and gap-edit later reuse. Split into small chunks (Batches B–D).

## Model fit — all four edit modes are legal & reversible

The runtime model enforces ONE hard invariant: **every row shares one `width`**
(`Alignment.width` is a single field; `from_rows` asserts it — `model.rs:148`).
The "trailing-pad-only" rule is just the **construction-time** padding policy for
ragged input (`model.rs:214`), NOT a standing ban on interior gaps — an alignment
is full of interior gaps by nature. So each mode stays a legal equal-width matrix
by trailing-padding whichever rows didn't grow/shrink:

| Mode | Keep it equal-width | Inverse |
|---|---|---|
| **Paste insert — shift only pasted rows** *(default)* | width += W; insert block at col c in target rows; trailing-pad other rows W gaps | delete W cols in target rows; trim pad |
| **Paste insert — shift all (keep alignment)** | width += W; insert block at col c in target rows; insert W gaps at col c in **all** other rows | delete W cols across all rows |
| **Paste overwrite** | block-set in place (pad right only on overflow) | restore old bytes |
| **Cut — shorten** | delete W cols in target rows; trailing-pad them back to width | re-insert the cut bytes |
| **Cut — mask (gaps)** | set selected cells to `-` | restore old bytes |

**Known consequence of the default insert ("shift only pasted rows"):** it
*de-aligns the columns to the right* in the pasted rows — column N no longer
corresponds across rows. That is an intended editing choice (confirmed with the
user); the "shift all" toggle is the one-click way back to a synchronized
alignment. It invalidates the consensus/conservation caches, which rebuild.

## Decisions (user, 2026-06-23)

- **Copy gaps:** WYSIWYG — **keep gaps** (`-`) for both Raw and FASTA. The copied
  block is exactly the slice shown, so copy→paste round-trips. ("Strip gaps to the
  biological sequence" is a later sub-toggle, not the default.)
- **Paste default mode:** **insert** (not overwrite).
- **Paste insert sub-toggle:** **shift only the pasted rows** is the DEFAULT;
  **shift every other sequence (insert gaps to keep the alignment)** is the toggle.
- **Cut toggle:** **mask-to-gaps** vs **shorten**. **Default = shorten**
  (user-decided 2026-06-23), symmetric with the local paste default; mask-to-gaps
  is the toggle alternative.
- **Alphabet validation on paste:** **warn** (do not reject).
- **Paste format:** auto-detect — clipboard text starting with `>` is parsed as
  FASTA (headers stripped); otherwise raw lines. No third toggle.
- **Undo/redo (Ctrl+Z / Ctrl+Y):** ships WITH the first mutation (Batch B).

## Roadmap (paste split small, as the user asked)

**Batch A — Copy (DONE, green).** Clipboard plugin + `clipboard-manager:allow-
write-text` capability; `model/copy.ts` pure builder (Raw/FASTA, keep gaps,
`COPY_CELL_CAP` guard) + tests; `ipc/clipboard.ts` seam; `GridStore`
selection-change listener (coarse React mirror); `ui/Toolbar.tsx` (Sel readout +
Copy button + Raw|FASTA toggle + ephemeral message); `Ctrl/⌘+C` in `Grid`.

**Batch B — Edit foundation (DONE, green; GUI smoke pending)** *(prerequisite for
every mutation)*
- **B1** `apply → Result<EditOutcome, EditError>` (atomic) + `SetCells` + the
  `EditStack` undo/redo history over a **`Dataset`** (`apply_to_dataset` resyncs the
  derived ungapped residues so undo is lossless on derived state). `AppState{dataset,
  history}`; history reset on load. 12 tests.
- **B2** IPC `clear_cells`/`undo_edit`/`redo_edit` returning the **full post-edit
  render buffer** (advisor: the changed-rows patch was a B2-only orphan — C/D change
  width and rebuild anyway; the full buffer is the transport they extend, and copying
  it in place preserves scroll + selection). `Ctrl+Z`/`Shift+Z`/`Ctrl+Y` + **Delete =
  clear-to-gap** (first reversible edit; doubles as cut-mask). Editing round-trips end
  to end (pending GUI smoke).

**Batch C — Paste**
- **C1** Paste **overwrite** (clipboard read → parse → `SetCells`). Smallest real paste.
- **C2** Paste **insert, shift-only-pasted-rows** (default) — `InsertBlock` cmd.
- **C3** Paste **insert, shift-all** toggle — reuses C2 + gap-insert in other rows.
- **C4** Polish: FASTA auto-detect, alphabet-validation warning, size-guard,
  multi-row fill-down geometry, the Insert|Overwrite + shift-mode toggle buttons.

**Batch D — Cut**
- **D1** Cut → mask-to-gaps (cut = copy + `SetCells`-to-`-`).
- **D2** Cut → shorten (`DeleteBlock` cmd).
- **D3** Cut toggle button.

## Deferred (settle when designing paste)

Multi-row fill-down geometry (spreadsheet-style block fill at the cursor);
FASTA-header→row matching (recommend positional/ignore-headers first); past-the-
right-edge overflow on overwrite; clipboard READ permission (only granted when
paste-from-system-clipboard lands in Batch C).

## Risks / traps

- **Copy freeze** — select-all on the 10k×10k stress fixture is ~100M cells;
  `COPY_CELL_CAP` (10M) warns instead of building the string. (Done.)
- **Stale React mirror** — the selection→React listener is throttled to the
  selection's *size* identity; `setDims` (load) fires it with `null`. (Done.)
- **Edit invariants (Batch B+)** — every mutation keeps rows equal-width and
  invalidates the changed rows' coord indexes + the per-column caches.
- **Render-buffer drift (Batch B+)** — after an edit, patch the frontend buffer
  from `changed_rows` (or re-fetch); never let the JS copy diverge from Rust.
