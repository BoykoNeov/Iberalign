//! Compiles vendored KAlign v3 in-process when the `kalign` feature is on.
//! Pure no-op otherwise, so the default workspace build needs no C toolchain
//! and no submodule.

use std::path::PathBuf;

fn main() {
    // Build scripts receive features as env vars, not cfg().
    if std::env::var_os("CARGO_FEATURE_KALIGN").is_none() {
        return;
    }

    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let kalign = manifest.join("vendor/kalign");
    let lib_src = kalign.join("lib/src");
    let lib_inc = kalign.join("lib/include");
    let shim = manifest.join("shim");

    if !lib_src.join("aln_wrap.c").exists() {
        panic!(
            "KAlign submodule not found at {}.\n\
             Run: git submodule update --init crates/align-extern/vendor/kalign",
            kalign.display()
        );
    }

    // Explicit lib source list from lib/CMakeLists.txt, MINUS:
    //   - coretralign.c (already excluded upstream — pthread, not built)
    //   - msa_cmp.c (only the kalign_msa_compare* API; its single VLA is the
    //     lone MSVC blocker and the kalign() align path never calls it)
    let files = [
        "test.c",
        "tldevel.c",
        "tlmisc.c",
        "tlrng.c",
        "esl_stopwatch.c",
        "msa_alloc.c",
        "msa_op.c",
        "msa_io.c",
        "msa_misc.c",
        "msa_check.c",
        "msa_sort.c",
        "alphabet.c",
        "task.c",
        "bisectingKmeans.c",
        "sequence_distance.c",
        "bpm.c",
        "euclidean_dist.c",
        "pick_anchor.c",
        "aln_wrap.c",
        "aln_apair_dist.c",
        "aln_param.c",
        "aln_run.c",
        "aln_mem.c",
        "aln_setup.c",
        "aln_controller.c",
        "aln_seqseq.c",
        "aln_seqprofile.c",
        "aln_profileprofile.c",
        "aln_refine.c",
        "sp_score.c",
        "weave_alignment.c",
        "poar.c",
        "consensus_msa.c",
        "anchor_consistency.c",
        "ensemble.c",
    ];

    let mut build = cc::Build::new();
    build
        .include(&lib_inc) // <kalign/kalign.h>
        .include(&lib_src) // internal "foo.h"
        .include(&shim) // version.h + stub POSIX/intrinsic headers
        .define("KALIGN_PACKAGE_VERSION", "\"3.5.1\"")
        // CMake CACHE compile-defs (root CMakeLists.txt:200-201).
        .define("KALIGN_ALN_SERIAL_THRESHOLD", "250")
        .define("KALIGN_KMEANS_UPGMA_THRESHOLD", "50")
        // No GCC -mavx2 detection here -> take KAlign's scalar fallback path.
        // (We intentionally do NOT define HAVE_OPENMP -> single-threaded.)
        .define("NOHAVE_AVX2", None)
        .warnings(false);

    if build.get_compiler().is_like_msvc() {
        // Force-include the MSVC compat shim before every TU.
        let fi = shim.join("kalign_compat.h");
        build.flag(format!("/FI{}", fi.display()));
        build.flag("/std:c11");
    }

    for f in files {
        let p = lib_src.join(f);
        println!("cargo:rerun-if-changed={}", p.display());
        build.file(p);
    }
    println!("cargo:rerun-if-changed={}", shim.display());
    build.compile("kalign");
}
