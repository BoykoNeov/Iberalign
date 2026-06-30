# In-process KAlign v3 backend — context (key files + decisions)

Companion to `extern-aligner-plan.md` + `-tasks.md`. The non-obvious facts a
future session needs.

## Architecture
- **`align-core` stays pure / FFI-free** (invariant). All compiled-in backends
  live in the new feature-gated crate **`crates/align-extern`**, which depends on
  `align-core` and returns `align_core::MsaResult` (equal-width gapped rows in
  input order) — the same currency `progressive_align` produces, so the reversible
  `msa_splice` → `EditCmd::SpliceRows` edit is backend-agnostic and reused unchanged.
- **Engine selection** = pure `align_core::MsaEngine { Progressive, Kalign }`;
  dispatch in `src-tauri/commands.rs::msa_align` and `align-cli`. Both gain an
  **optional** `align-extern` dep behind their own `kalign` feature; selecting
  Kalign without the feature returns a clear "not built" error (no panic).
- **Feature OFF by default** everywhere: default `cargo build/test --workspace`,
  CI default jobs, and `npm run tauri dev` are all pure-Rust and need no submodule
  or C toolchain. KAlign is built only with `--features kalign`.

## KAlign build (the spike's payoff)
- Vendored as a **git submodule pinned to v3.5.1** at
  `crates/align-extern/vendor/kalign`. Default builds never touch it.
- **Route = `cc` crate, NOT CMake** (CMake isn't installed on the dev box; we don't
  force it on contributors/CI). `build.rs` compiles the explicit 35-file
  `lib/CMakeLists.txt` source list **minus `msa_cmp.c`** (its lone VLA is the only
  MSVC blocker, and the `kalign()` align path never calls it ⇒ **zero upstream
  patches**, submodule stays pristine) **minus `coretralign.c`** (excluded upstream
  too; pthread).
- **Shims** (`crates/align-extern/shim/`, all ours): force-included
  `kalign_compat.h` (MSVC: `__builtin_popcount`→`__popcnt`, `write`→`_write`,
  `getpid`→`_getpid`, `localtime_r`→`localtime_s`, `ssize_t`), stub `mm_malloc.h`→
  `<malloc.h>`, `unistd.h`, `sys/time.h` (tiny `gettimeofday`), static `version.h`.
- **Compile defines**: `KALIGN_PACKAGE_VERSION="3.5.1"`,
  `KALIGN_ALN_SERIAL_THRESHOLD=250`, `KALIGN_KMEANS_UPGMA_THRESHOLD=50`,
  `NOHAVE_AVX2` (scalar path). **Do NOT define `HAVE_OPENMP`** ⇒ single-threaded.

## FFI wrapper (`crates/align-extern/src/kalign.rs`)
- Calls only the legacy single entry point
  `int kalign(char**seq,int*len,int numseq,int n_threads,int type,float gpo,float
  gpe,float tgpe,char***aligned,int*out_aln_len)`.
- **v3.5.1 `KALIGN_TYPE_*`: DNA=0, RNA=2, PROTEIN=3** — these DIFFER from the
  `main`-branch header (where DNA=5 = PFASUM43 protein). Always read the pinned tag.
- `n_threads=1` ⇒ deterministic. **Negative gpo/gpe/tgpe ⇒ KAlign's matrix-tuned
  defaults** (`aln_param_init` overrides only when `>= 0`); our progressive-scale
  `--matrix`/`--gap-*` apply only to the Progressive backend.
- Output `char***` is plain `malloc`'d (`MMALLOC`==malloc) ⇒ free each row then the
  array with `free`. KAlign **preserves input order** and **case** (soft-masking).
- **Losslessness guard** (advisor-driven): the in-place edit resyncs residues from the
  spliced bytes, so it TRUSTS each row == input + gaps. The wrapper verifies
  `degap(out[i]) == in[i]` byte-for-byte and returns `ExternError::OutputMismatch`
  otherwise — turning any future canonicalization into a safe visible failure, not
  silent corruption. Verified preserved across RNA (`U`), protein (`X`/`*`), DNA
  ambiguity, and lowercase.
- **Biotype limitation:** KAlign's own detector rejects *pathologically* ambiguous DNA
  (≥~half non-ACGT reads as protein under `--type dna`) with a clean
  `ExternError::Failed` — realistic/sparse `N` is fine; the user falls back to
  Progressive. Empty/all-gap inputs across the FFI return cleanly (no crash) — tested.

## Key files
- `crates/align-extern/{Cargo.toml,build.rs,src/lib.rs,src/kalign.rs,shim/*}`
- `crates/align-core/src/msa.rs` (`MsaEngine`), `…/lib.rs` (re-export)
- `src-tauri/src/commands.rs::msa_align` (engine param + dispatch), `src-tauri/Cargo.toml`
- `crates/align-cli/src/main.rs` (`--engine`), `crates/align-cli/Cargo.toml`
- `src/ipc/edit.ts::msaAlign`, `src/ui/Grid.tsx` (doAlign + alignEngine), `src/ui/MenuBar.tsx`
- `.github/workflows/ci.yml` (kalign job), `NOTICE`, `package.json` (tauri:kalign)

## Decisions
- **POA dropped** (user, 2026-06-30): the spike proved the KAlign build, so POA-as-
  seam-prover was redundant scope. Straight Progressive + KAlign.
- **Default engine Progressive** until the KAlign GUI smoke passes.
- **Open (follow-up):** how the SHIPPED app enables kalign (release build with the
  feature so end users get quality without a flag) — not yet wired; default build
  stays pure-Rust.
