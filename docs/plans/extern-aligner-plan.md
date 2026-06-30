# In-process KAlign v3 aligner (compiled-in quality backend)

> Plan-mode scratch name. On execution this becomes the conventional
> `docs/plans/extern-aligner-{plan,context,tasks}.md` trio.

## Context

We ship our own ClustalW-class progressive aligner (`align-core::msa`) for N≥2
"Align selected sequences". It is correct but **≤ ClustalW** in quality — fine
for similar sequences, weaker on divergent families. The project's stated path to
MUSCLE/Clustal-tier quality (CLAUDE.md invariant) is to **bundle a permissively
licensed aligner in-process** (the MEGA model — compiled-in/FFI, never a
subprocess). After a licensing/maturity survey (`progressive-msa-context.md`
appendix), the chosen target is **KAlign v3** (Apache-2.0, ≈MUSCLE/Clustal,
actively maintained — v3.5.1, Feb 2026). This batch compiles KAlign in as a
*second, selectable* MSA backend; our progressive aligner stays the default and
the zero-dependency fallback.

**User decisions (this session):** target = KAlign (accept the C build + CI cost);
**spike the build first**; pure-Rust POA wired first as a zero-risk seam-prover +
genuine fallback. **Advisor guidance baked in:** sequence the decisive unknown
(does KAlign's C build in-process on Windows/MSVC + ship in the Tauri release?)
*before* any plumbing; hand-write `extern "C"` (no bindgen → no libclang/Windows
pain); feature-gate so the default build stays pure-Rust; keep `align-core` pure
by putting FFI in a new crate; POA is scaffolding, **not** allowed to masquerade
as the quality deliverable.

### Verified KAlign facts (already researched this session)
- **Clean single-function C API** — the perfect FFI target, no opaque struct needed:
  ```c
  int kalign(char **seq, int *len, int numseq, int n_threads, int type,
             float gpo, float gpe, float tgpe, char ***aligned, int *out_aln_len);
  ```
  (`lib/include/kalign/kalign.h`; `type` = `KALIGN_TYPE_DNA|RNA|PROTEIN` constants
  that map 1:1 to our `Alphabet`). Output `char***` is malloc'd, caller-freed.
- **Build:** CMake-based, 43 `.c` files in `lib/src`, generated headers
  (`version.h.in` via `configure_file`, `generate_export_header`). **No SIMD/AVX
  per-file flags** in the lib CMake (low risk). License Apache-2.0 (compatible with
  our Apache-2.0 workspace).

## Approach

A **new feature-gated crate `crates/align-extern`** holds every compiled-in/FFI
backend; it depends on `align-core` and returns `align_core::MsaResult` (the common
currency). `align-core` stays pure and FFI-free (invariant preserved). Backend
selection is a pure `MsaEngine` enum in `align-core`; the **dispatch** lives in
`src-tauri/commands.rs` and `align-cli` (both gain an optional `align-extern` dep
behind a `kalign` / `poa` feature). When a feature is off, that engine errors
cleanly ("engine not built") and the default Progressive path is unaffected.

Because every backend yields `MsaResult{ rows (input order), length }`, the
existing `msa_splice` → `EditCmd::SpliceRows` edit/undo path is reused **unchanged**
— no new reversible-edit machinery. No new Tauri capability (alignment is a custom
command, already un-gated).

## Phases

### Phase 0 — KAlign build spike (throwaway; GO/NO-GO gate) ⚠️ decisive
Prove feasibility *before* any plumbing. In a scratch crate (not wired into the app):
- Vendor KAlign v3.5.1 source (scratch copy for the spike).
- Build the static lib. **Primary route: the `cmake` crate** (runs KAlign's own
  CMake → produces the static lib + generated `version.h`/export header; cost = a
  CMake build-time dependency). **Fallback: the `cc` crate** (glob the 43 `.c`,
  hand-provide `version.h`, `-D` away the export header; no CMake dep, more brittle).
- Hand-write `extern "C" { fn kalign(...) }`; call it on 3 sequences **on this
  Windows/MSVC box**; confirm aligned output.
- Confirm a **`tauri build` release** still links with the static lib in the graph.
- Pin the **output-free contract** (free each `aligned[i]` + the array — `free` vs
  `_mm_free`; read `lib/src/aln_wrap.c` / `kalign_msa_to_arr`).
- Check **determinism**: `n_threads=1`, repeated runs byte-identical (our
  undo/redo + caches assume deterministic re-alignment).

**Output:** GO/NO-GO + the chosen build route. **NO-GO branch** → fall back to
`spoa` (C++ FFI, confirmed MSA output) or ship POA as the deliverable; escalate to
the user with spike findings before proceeding. *(If the route needs CMake as a
build dep, surface that to the user — it affects every contributor + CI.)*

### Phase A — backend seam (pure)
- `align-core`: add `pub enum MsaEngine { Progressive, Kalign, Poa }` + `from_name`
  / `as_str` (pure value type, no deps). Unit-tested.
- `src-tauri/commands.rs`: refactor `msa_align`'s body so the engine dispatch is a
  single `match` — `Progressive` → `progressive_align` (today's path, unchanged
  default). Stubs for `Kalign`/`Poa` return a clear "engine not built" error until
  their features land.

### Phase B — `align-extern` crate + pure-Rust POA backend (zero build risk)
- New `crates/align-extern` (feature-gated; depends on `align-core`). Add to the
  workspace members + `[workspace.dependencies]`.
- `poa` feature → wire **rust-bio `bio::alignment::poa`** (MIT) or `poasta` (BSD-3):
  `poa_align(seqs, alphabet) -> Result<MsaResult, ExternError>`.
- **Verify columnar MSA output** (advisor flag: rust-bio POA's columnar-vs-consensus
  output is unconfirmed) — if it only yields a consensus, switch to `spoa`/`poasta`
  or drop POA to CLI-only. POA exercises the multi-backend dispatch end-to-end with
  **no native build**, and is the live fallback if Phase 0 ever regresses.

### Phase C — KAlign FFI backend (build proven in Phase 0)
- Vendor KAlign v3.5.1 as a **git submodule pinned to the v3.5.1 tag** under
  `crates/align-extern/vendor/kalign` (alt: copied source if CI submodule friction).
- `align-extern` `kalign` feature: `build.rs` (the route Phase 0 chose) compiles the
  static lib; hand-written `extern "C"` decl; a **safe wrapper**
  `kalign_align(seqs: &[&[u8]], alphabet, scoring_overrides) -> Result<MsaResult, ExternError>`
  that maps `Alphabet → KALIGN_TYPE_*`, passes `n_threads=1`, marshals `char**` in /
  `char***` out, frees correctly, and reorders rows to input order. Errors (non-OK
  return, empty result) surface as `ExternError`, never a panic across FFI.
- Tests: small fixture vs a known-good KAlign CLI output (golden); determinism;
  empty/1-seq guards mirror `progressive_align`.

### Phase D — CLI + IPC + UI engine picker
- `align-cli msa <file> --engine progressive|kalign|poa` (default progressive).
- `commands.rs::msa_align` gains `engine: Option<String>`; `ipc/edit.ts::msaAlign`
  gains an `engine` arg + payload field; `MsaResultDto` optionally echoes the engine.
- `MenuBar.tsx` Align: a small **engine submenu** (radio: Progressive | KAlign;
  POA if surfaced) next to "Align selected sequences"; `Grid.tsx::doAlign` threads
  the chosen engine into `msaAlign`. **Default stays Progressive** until the KAlign
  GUI smoke passes; flip the default to KAlign as a follow-up once confident.

### Phase E — CI, licensing, docs
- CI: a **dedicated Windows job** building `align-extern --features kalign` (+ the
  Linux/mac matrix if present); the default workspace build/test stays **feature-off
  / pure-Rust** so `align-core`/`align-cli` CI and contributors need no C toolchain.
- Licensing: commit KAlign's `LICENSE` + a top-level **NOTICE** attribution
  (Apache-2.0 §4). Confirm no GPL transitively (KAlign v3 is clean; kalign2 was GPL —
  pin v3 only).
- Docs: update the CLAUDE.md MSA invariant (FFI backends live in `align-extern`
  behind a feature; `align-core` stays pure) + the milestone block + memory; create
  `docs/plans/extern-aligner-{plan,context,tasks}.md`.

## Decisions (recommended defaults; spike may revise)
- **Build route:** `cmake` crate primary (handles generated headers), `cc` fallback —
  Phase 0 decides. If CMake-as-build-dep is required, confirm with the user.
- **Vendoring:** git submodule pinned to v3.5.1 (clean third-party separation).
- **Determinism:** `n_threads=1`; if KAlign is non-deterministic, document that
  re-align is not byte-stable (affects nothing structurally, but note it).
- **Default GUI engine:** Progressive until KAlign GUI-smoke-passes.
- **POA surfacing:** seam-prover + fallback; keep in CLI, surface in GUI only if its
  columnar output proves worthwhile.

## Verification
- **Phase 0 (the gate):** `cargo run` the scratch FFI on 3 seqs on Windows → aligned
  FASTA; `cargo tauri build` links; valgrind/leak sanity on the output free (or a
  loop-and-watch-memory smoke).
- **Engine parity:** `align-cli msa fixtures/sample.fasta --engine kalign` vs
  `--engine progressive` — both produce equal-width rows in input order; KAlign
  matches a reference KAlign CLI run (golden).
- **Rust tests:** `cargo test --workspace` (default, feature-off) stays green;
  `cargo test -p align-extern --features kalign` for the FFI wrapper; clippy + fmt.
- **Frontend:** `npm run typecheck && npm run build`; vitest green.
- **GUI smoke (`npm run tauri dev`):** select 3+ rows → Align with **KAlign** engine
  → rows replaced, readout shows count/cols; **Ctrl+Z restores**; switch engine →
  Progressive still works; 2 rows still pairwise; DNA vs protein pick the right
  KAlign `type`; a column-subset / all-gap-row selection still aligns.
- **Owed (non-blocking):** the progressive-MSA GUI smoke is still outstanding —
  worth running early as cheap insurance before layering this batch on top.

## Phase 0 — SPIKE RESULT: ✅ GO (2026-06-30)

KAlign v3.5.1 **builds under MSVC 2022 (BuildTools 14.44) via the `cc` crate —
no CMake**, links into a Rust binary, runs, and produces correct output
(3 DNA seqs → expected gap column, width 13, rc=0). **Deterministic** with
`n_threads=1` (3 runs byte-identical). Scratch crate:
`scratchpad/kalign-spike` (throwaway).

**Build route decided: `cc` crate** (CMake isn't installed on the box and we
don't want to force it on contributors/CI; `cc` reuses the MSVC `cl.exe` the
Rust toolchain already requires). The shim surface Phase C must carry — all
small, all in *our* crate (only one upstream line touched):
- **Compile defines:** `KALIGN_PACKAGE_VERSION="3.5.1"`,
  `KALIGN_ALN_SERIAL_THRESHOLD=250`, `KALIGN_KMEANS_UPGMA_THRESHOLD=50`,
  `NOHAVE_AVX2` (scalar path; no GCC `-mavx2` detection on MSVC). Do **not**
  define `HAVE_OPENMP` → single-threaded (matches `n_threads=1`).
- **Force-included `kalign_compat.h`** (MSVC only): `__builtin_popcount`→
  `__popcnt`, `write`→`_write`, `getpid`→`_getpid`, `localtime_r`→`localtime_s`,
  `ssize_t` typedef.
- **Stub headers on the include path:** `mm_malloc.h`→`<malloc.h>` (MSVC has
  `_mm_malloc`/`_mm_free` there), `unistd.h`→io/process, `sys/time.h` (tiny
  `gettimeofday` via `GetSystemTimeAsFileTime`). Plus a static `version.h`
  (generate from `version.h.in` in `build.rs`).
- **No upstream patch needed — exclude `msa_cmp.c`.** Its only MSVC blocker was a
  VLA (`msa_cmp.c:341`), and the file provides just the `kalign_msa_compare*` API
  (not the `kalign()` align path). **Verified:** building the 35-file list *without*
  `msa_cmp.c` links + runs correctly. So a git submodule pinned to v3.5.1 stays
  **pristine** (zero in-place edits); `build.rs` compiles 35 files.
- **Output-free contract:** `kalign_msa_to_arr` builds the `char***` with
  `MMALLOC` = plain `malloc`; the wrapper frees each `aligned[i]` then the array
  with `free()`. `kalign_free_msa` is for the `struct msa`, not the array.
- **Source list:** the explicit 36-file `lib/CMakeLists.txt` list (coretralign
  already excluded there); `test.c` has no `main()` (safe to include).
- **FFI entry:** `int kalign(char**seq,int*len,int numseq,int n_threads,int type,
  float gpo,float gpe,float tgpe,char***aligned,int*out_aln_len)`; `type` =
  `KALIGN_TYPE_DNA(5)/RNA(7)/PROTEIN`.

**Still to verify in Phase C:** a `tauri build` *release* (LTO=thin) links the
static lib (low risk; deferred because `align-extern` doesn't exist yet).

## Out of scope / deferred
- Block / sub-area align (Variant 1 grow vs Variant 2 within-space — user leans V2).
- `spoa` (only if Phase 0 NO-GO or POA columnar output fails).
- Flipping the GUI default to KAlign (a small follow-up after its smoke).
- Per-engine advanced params (KAlign refine/ensemble/consistency knobs) — defaults
  only for now.
