# In-process KAlign v3 backend — task checklist

Companion to `extern-aligner-plan.md` (accepted plan + Phase 0 spike results).
Status: **Phases 0/C/A/D/E code complete + committed + pushed; GUI smoke PENDING.**

## Phase 0 — build spike (GO/NO-GO) ✅ GO
- [x] Vendor KAlign v3.5.1, build static lib under MSVC via the `cc` crate (no CMake)
- [x] Hand-written `extern "C"`, call `kalign()` on 3 seqs, correct output
- [x] Determinism (`n_threads=1`, 3 runs identical); output-free contract (plain `free`)
- [x] Decide route = **`cc` crate**; exclude `msa_cmp.c` ⇒ zero upstream patches

## Phase C — `align-extern` crate + KAlign FFI ✅ `28e0521`
- [x] Submodule `crates/align-extern/vendor/kalign` pinned to v3.5.1
- [x] `build.rs` (feature-gated `kalign`; 35-file list; shims; defines; `/FI` compat)
- [x] `shim/` (kalign_compat.h, mm_malloc.h, unistd.h, sys/time.h, version.h)
- [x] `kalign_align(seqs, alphabet) -> Result<MsaResult, ExternError>` (types DNA=0/
      RNA=2/PROTEIN=3; n_threads=1; tuned-default gaps; frees output)
- [x] 4 tests (empty/single/input-order+equal-width/determinism); clippy + fmt clean
- [x] Default workspace stays pure-Rust green; debug + release link clean

## Phase A — `MsaEngine` seam ✅ `897c31e`
- [x] `align_core::MsaEngine { Progressive, Kalign }` + from_name/as_str (tested)
- [x] `commands.rs::msa_align` engine param + dispatch; optional align-extern + `kalign` feature
- [x] `align-cli msa --engine progressive|kalign`; feature-off ⇒ clear error
- [x] Verified end-to-end via CLI; src-tauri compiles both ways; clippy + fmt clean

## Phase D — UI engine picker ✅ `0738d7e`
- [x] `ipc/edit.ts::msaAlign` engine arg
- [x] `Grid.tsx` alignEngine state/ref + handler + doAlign dispatch (2-row pairwise
      under Progressive; KAlign N≥2 via MSA path; readout tags KAlign)
- [x] `MenuBar.tsx` Align → Engine submenu (`AlignEngine` type)
- [x] `npm run tauri:kalign` / `tauri:build:kalign` scripts
- [x] typecheck + 295 vitest + build green

## Phase E — CI, licensing, docs (this batch)
- [x] CI: Windows `kalign` job (submodule checkout; build/test/clippy align-extern
      --features kalign + build align-cli --features kalign); default jobs untouched
- [x] NOTICE: KAlign v3.5.1 Apache-2.0 attribution (compiled-in, feature-gated)
- [x] CLAUDE.md invariant + milestone; memory; docs trio
- [x] commit + push Phase E (`52a76ef`); **CI green incl. the new Windows kalign job**
- [x] Review hardening (`5739a6f`): losslessness guard (degap(out)==in ⇒ else
      OutputMismatch) + cross-alphabet (RNA U / protein X,* / ambiguity / lowercase)
      + empty-FFI tests; documented KAlign's biotype rejection of pathological
      ambiguity. CI green (incl. kalign job, twice).

## PENDING (user-driven)
- [ ] **GUI smoke**: `npm run tauri:kalign` → 3+ rows → Align (Engine=KAlign) → rows
      replaced + "· KAlign" readout; Ctrl+Z restores; Progressive still works; 2 rows
      pairwise; DNA vs protein default type; column-subset + all-gap-row still align.

## Deferred / follow-ups
- [ ] Flip GUI default to KAlign + decide RELEASE shipping (kalign-on release build,
      so end users get the quality engine without a flag) — needs a decision.
- [ ] Pure-Rust POA backend (dropped this batch — build proven, seam-prover redundant).
- [ ] Block / sub-area align (Variant 1 grow vs Variant 2 within-space).
- [ ] Expose KAlign-native knobs (refine/ensemble/consistency); per-engine params.
