# Progressive MSA — context / key files

Companion to `progressive-msa-plan.md` (design) and `-tasks.md` (checklist).
Current state of the files the work touches, from the code map (read 2026-06-29).

## Engine — `crates/align-core`

- `src/align.rs` — the **pairwise** Gotoh DP to generalize. Public
  `pairwise(a, b, &matrix, mode, scoring) -> PairwiseResult { aligned_a,
  aligned_b, score, percent_identity, length }`. Operates on **ungapped** byte
  slices, **preserves case**, returns equal-length gapped rows. Internals to
  mirror: 3-state `M/X/Y` arrays, `NEG = -1_000_000_000` sentinel, `argmax3` tie
  order **M>X>Y**, affine cost `gap_open + (k−1)·gap_extend`. Its module doc
  ("MSA is intentionally *not* here") gets updated. `finish()` shows the
  %-identity convention (matches / length, case-insensitive compare).
- `src/matrix.rs` — `SubstitutionMatrix::score(a,b)` (uppercases on lookup),
  `match_mismatch`, `blosum62/45/80`, `pam250`, `by_name`, `default_for(alphabet)`.
  Reused as-is for column scoring.
- `src/model.rs` — `Alphabet {Dna,Rna,Protein}` + `infer()` + `widen()`;
  `Sequence { residues: Vec<u8> /* ungapped, case-preserved */ }`;
  `AlignedRow { gapped }`; `Alignment { width, rows }`; `Dataset { alignment,
  sequences }`; `Dataset::from_records` (trailing-pad-only invariant).
- `src/coords.rs` — `is_gap(b)` (`-`/`.`), used by fidelity checks.
- `src/edit.rs` — `EditCmd::SpliceRows { splices: Vec<RowSplice{row,col,remove,
  bytes}> }`, reversible/atomic; `apply_to_dataset`, `EditStack`. The MSA splice
  reuses `SpliceRows` (no new variant), exactly like the pairwise `realign_splice`.
- `src/lib.rs` — add `pub mod msa;` + re-export `progressive_align`, `MsaResult`;
  bump the milestone comment.
- **New:** `src/msa.rs` — distance matrix, UPGMA, `Profile`, profile–profile
  Gotoh, `progressive_align`.

## CLI — `crates/align-cli/src/main.rs`

- `match args.first()` dispatch (`summary`/`composition`/`generate`/`align`). Add
  an `msa` arm. The **`align_cmd`** fn (lines ~99–222) is the worked template for
  flag parsing (`--matrix`/`--gap-open`/`--gap-extend`), `by_name`/`default_for`
  resolution, and `widen`-ing the alphabet. `first_sequence()` shows parse →
  `Dataset::from_records` → residues; `msa` reads **all** records' residues.
- Add a `usage()` line and a fixture smoke test alongside the existing ones.

## Tauri — `src-tauri`

- `src/commands.rs` — `pairwise_align` (lines ~867–932) + **`realign_splice`**
  (lines ~809–856) are the direct templates. `realign_splice` already does the
  N-row generalization shape: replace rows padded to `target` (`= w` when only
  those rows exist else `max(w,cur)`), trailing-pad others if `target > cur`, one
  `EditCmd::SpliceRows`. Generalize to a `Vec<usize>` of rows ⇒ `msa_splice`. Lock
  + split-borrow `let AppState { dataset, history } = &mut *guard;`. Skip the edit
  when `length == 0`. Add `MsaResultDto { num_seqs, length }`.
- `src/state.rs` — `AppState { dataset: Option<Dataset>, history: EditStack }`.
- `src/lib.rs` — `tauri::generate_handler![…]`; add `commands::msa_align`.

## Frontend — `src`

- `src/ipc/edit.ts` — `pairwiseAlign(...)` (lines ~153+) + `PairwiseResult`/
  `*Wire`/`fromWire` are the template for `msaAlign(rows, matrix?, gapOpen?,
  gapExtend?)` + `MsaResult`. The in-place/`getRenderBuffer` resync comment block
  (top of file) documents the width-changing-but-row-count-stable transport the
  MSA edit also uses.
- `src/ui/Grid.tsx` — `doAlign` (lines ~993–1030, effect-scoped, behind
  `doAlignRef`): currently 2 ⇒ `pairwiseAlign`, `rows > 2` ⇒ `showMsg("…needs
  MAFFT…")`. Replace the `rows > 2` branch with `msaAlign(rows)` via `runEdit`
  (capture the DTO in a closure, return `getRenderBuffer()`); readout `N
  sequences · length L`. `canAlign = (selInfo?.rows ?? 0) >= 2` stays. Selected
  rows come from `store.getSelection()`; serialized via `editingRef`.
- `src/ui/MenuBar.tsx` — the Align menu item (`onAlign`/`canAlign`). Drop the
  MAFFT-deferral copy.

## Watch-outs

- Align the **ungapped** residues (`sequences[row].residues`), not the gapped
  rows — degap first (the rows may already carry gaps from a prior alignment).
- **Residue/case fidelity is automatic** — we only insert `b'-'` columns; never
  alter residues. Proptest `degap(out[i]) == in[i]`. No foreign-residue risk
  (unlike a future FFI/shell aligner).
- **Row order:** each leaf carries its original input index; emit rows in input
  order. The guide tree reorders *internally* only.
- **Determinism:** pin every tie-break — UPGMA equal-distance ⇒ smallest index
  pair; DP `max` ⇒ M>X>Y (as pairwise). Same input ⇒ byte-identical output.
- **Width:** `target = max(aligned_width, current_width)` unless the selection is
  every row (then `target = aligned_width`, allowing shrink). Realigned rows pad
  to `target`; others trailing-pad if widened (the established `realign_splice`
  rule + the faint-grey trailing-gap render already covers the look).
- **Performance:** distance matrix is `O(N²·L²)`, merges `O(N·L²·Σ)`. Fine at the
  design target (tens of sequences, hundreds–low-thousands of columns); NOT the
  10k-sequence stress ceiling. Note in code; don't optimize prematurely.

## Appendix — future "bundle permissive aligners" research (2026-06-29)

Survey of **in-process** options (compiled-in, no subprocess) to seed the future
MEGA-style bundling batch. Verdicts:

| Option | In-process? | License | Maturity | Quality |
|---|---|---|---|---|
| **KAlign v3** (FFI, write bindings) | Yes — real `extern "C"` C lib | **Apache-2.0** ✅ | Active (v3.5.1, Feb 2026) | **≈ MUSCLE / Clustal Omega** (Lassmann 2020) |
| **`poasta`** (pure-Rust POA) | Yes — `cargo add` | **BSD-3** ✅ | New (v0.1, 2025) | POA (consensus-flavored) |
| **rust-bio `bio::alignment::poa`** | Yes — `cargo add bio` | **MIT** ✅ | Very mature | POA (consensus-flavored) |
| **`spoa`** (FFI, rvaser C++) | Yes — C++ build dep | **MIT** ✅ | Mature (4.1.5, 2025) | POA, SIMD, emits MSA-FASTA |
| **Clustal Omega** (`libclustalo`) | Yes — real C++ lib | **GPL-2.0** ⛔ | Stale (2016) | High — but copyleft infects the app |
| **MUSCLE** | **No library API** (CLI) | v3 PD / **v5 GPL-3.0** ⛔ | v5.3 (2024) | shell-out only |
| **MAFFT** | **No library API** (CLI) | BSD-3 | Mature | shell-out only |
| **`rust-MAFFT`** (pure-Rust port) | In principle | MIT/BSD-3 | **Too new/unproven** | self-reported MAFFT parity — watch, don't adopt |

**Takeaways for the bundling batch:**
- **KAlign v3 is the top permissive, respectable, *linkable* target** — the closest
  analog to what we want (genuine general MSA ≈ MUSCLE/Clustal, Apache-2.0). Cost:
  no Rust crate ⇒ we write bindgen bindings + carry a C build dependency. ⚠️ Use the
  **v3 `TimoLassmann/kalign`** repo — kalign2 was GPL.
- **POA (`poasta` pure-Rust / rust-bio / `spoa`)** = the low-friction permissive
  route, but consensus-oriented (similar sequences), weaker on divergent families,
  no global-SP-optimality guarantee. Verify columnar-MSA output (not just consensus)
  if used for the viewer — confirmed for C++ `spoa`, unconfirmed for rust-bio POA.
- **Ruled out in-process:** Clustal Omega (GPL-2.0), MUSCLE (no API; v5 GPL-3.0),
  MAFFT (no API at all). MAFFT/MUSCLE would only ever be shell-out — which the user
  has excluded.
- **MEGA reality:** compiles in a *ClustalW source port* but **bundles MUSCLE.exe and
  shells out** — even the flagship doesn't link MUSCLE in-process. Our own aligner
  lands **≤ ClustalW**; KAlign v3 (later) is the path to MUSCLE/Clustal-tier quality
  without copyleft.
