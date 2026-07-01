//! `iberalign-cli` — headless front end over `align-core`.
//!
//! Usage:
//!   iberalign-cli summary <file.fasta>          # print a load summary
//!   iberalign-cli composition <file.fasta>      # print composition stats
//!   iberalign-cli generate <rows> <cols> <out>  # write a synthetic FASTA
//!   iberalign-cli translate <file.fasta>        # translate to protein
//!   cat file.fasta | iberalign-cli summary -
//!
//! Exists so the full parse → analyze → export path can be exercised in CI
//! without the webview. Subcommands grow alongside the engine milestones.

use std::io::{BufWriter, Read, Write};
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("summary") => match read_input(args.get(1).map(String::as_str)) {
            Ok(bytes) => summary(&bytes),
            Err(e) => {
                eprintln!("error: {e}");
                ExitCode::FAILURE
            }
        },
        Some("composition") => match read_input(args.get(1).map(String::as_str)) {
            Ok(bytes) => composition(&bytes),
            Err(e) => {
                eprintln!("error: {e}");
                ExitCode::FAILURE
            }
        },
        Some("generate") => generate(&args[1..]),
        Some("align") => align_cmd(&args[1..]),
        Some("msa") => msa_cmd(&args[1..]),
        Some("translate") => translate_cmd(&args[1..]),
        Some(other) => {
            eprintln!("error: unknown subcommand '{other}'");
            usage();
            ExitCode::FAILURE
        }
        None => {
            usage();
            ExitCode::FAILURE
        }
    }
}

fn summary(bytes: &[u8]) -> ExitCode {
    match align_core::parse_fasta(bytes) {
        Ok(out) => {
            let s = align_core::summarize(&out.records);
            println!("sequences    : {}", s.count);
            println!("alphabet     : {}", s.alphabet.label());
            println!("ungapped len : {}..{}", s.min_len, s.max_len);
            println!("aligned width: {}", s.width);
            let equal = if s.equal_width { "yes" } else { "no" };
            println!("equal width  : {equal}");
            for w in &out.warnings {
                eprintln!("warning: {w}");
            }
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("parse error: {e}");
            ExitCode::FAILURE
        }
    }
}

fn composition(bytes: &[u8]) -> ExitCode {
    match align_core::parse_fasta(bytes) {
        Ok(out) => {
            let ds = align_core::Dataset::from_records(&out.records);
            let comp = align_core::Composition::of(&ds);
            for (i, seq) in ds.sequences.iter().enumerate() {
                println!(
                    "seq {i:>3}  {:<20} len={:<6} gc={:.3}",
                    seq.name, comp.lengths[i], comp.gc_content[i]
                );
            }
            let rows = &comp.gap_fraction_per_row;
            let mean_row_gap = if rows.is_empty() {
                0.0
            } else {
                rows.iter().sum::<f32>() / rows.len() as f32
            };
            println!("columns       : {}", ds.alignment.width);
            println!("mean row gap  : {mean_row_gap:.3}");
            for w in &out.warnings {
                eprintln!("warning: {w}");
            }
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("parse error: {e}");
            ExitCode::FAILURE
        }
    }
}

/// `align <a.fasta> <b.fasta> [--mode global|local] [--matrix NAME]
///        [--gap-open N] [--gap-extend N]`
///
/// Aligns the **first** sequence of each file (their ungapped residues) and
/// prints the aligned pair, score, %-identity, and length. Matrix and gap
/// penalties default to the inferred alphabet when not given. The headless
/// exercise of the M3 engine.
fn align_cmd(args: &[String]) -> ExitCode {
    let mut files: Vec<&str> = Vec::new();
    let mut mode = align_core::AlignMode::Global;
    let mut matrix_name: Option<String> = None;
    let mut gap_open: Option<i32> = None;
    let mut gap_extend: Option<i32> = None;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--mode" => {
                match args.get(i + 1).map(String::as_str) {
                    Some("global") => mode = align_core::AlignMode::Global,
                    Some("local") => mode = align_core::AlignMode::Local,
                    _ => {
                        eprintln!("error: --mode expects 'global' or 'local'");
                        return ExitCode::FAILURE;
                    }
                }
                i += 2;
            }
            "--matrix" => match args.get(i + 1) {
                Some(n) => {
                    matrix_name = Some(n.clone());
                    i += 2;
                }
                None => {
                    eprintln!("error: --matrix expects a name");
                    return ExitCode::FAILURE;
                }
            },
            "--gap-open" => match args.get(i + 1).map(|s| s.parse::<i32>()) {
                Some(Ok(v)) => {
                    gap_open = Some(v);
                    i += 2;
                }
                _ => {
                    eprintln!("error: --gap-open expects an integer");
                    return ExitCode::FAILURE;
                }
            },
            "--gap-extend" => match args.get(i + 1).map(|s| s.parse::<i32>()) {
                Some(Ok(v)) => {
                    gap_extend = Some(v);
                    i += 2;
                }
                _ => {
                    eprintln!("error: --gap-extend expects an integer");
                    return ExitCode::FAILURE;
                }
            },
            s if s.starts_with("--") => {
                eprintln!("error: unknown flag '{s}'");
                return ExitCode::FAILURE;
            }
            s => {
                files.push(s);
                i += 1;
            }
        }
    }

    if files.len() != 2 {
        eprintln!(
            "usage: iberalign-cli align <a.fasta> <b.fasta> [--mode global|local] \
             [--matrix blosum62|blosum45|blosum80|pam250|dna] [--gap-open N] [--gap-extend N]"
        );
        return ExitCode::FAILURE;
    }

    let a = match first_sequence(files[0]) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("error: {e}");
            return ExitCode::FAILURE;
        }
    };
    let b = match first_sequence(files[1]) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("error: {e}");
            return ExitCode::FAILURE;
        }
    };

    let alphabet = align_core::Alphabet::infer(&a).widen(align_core::Alphabet::infer(&b));
    let matrix = match &matrix_name {
        Some(n) => match align_core::SubstitutionMatrix::by_name(n) {
            Some(m) => m,
            None => {
                eprintln!(
                    "error: unknown matrix '{n}' (try blosum62|blosum45|blosum80|pam250|dna)"
                );
                return ExitCode::FAILURE;
            }
        },
        None => align_core::SubstitutionMatrix::default_for(alphabet),
    };
    let defaults = align_core::Scoring::default_for(alphabet);
    let scoring = align_core::Scoring {
        gap_open: gap_open.unwrap_or(defaults.gap_open),
        gap_extend: gap_extend.unwrap_or(defaults.gap_extend),
    };

    let r = align_core::pairwise(&a, &b, &matrix, mode, scoring);
    let mode_label = match mode {
        align_core::AlignMode::Global => "global",
        align_core::AlignMode::Local => "local",
    };
    println!("mode     : {mode_label}");
    println!("alphabet : {}", alphabet.label());
    println!("a: {}", String::from_utf8_lossy(&r.aligned_a));
    println!("b: {}", String::from_utf8_lossy(&r.aligned_b));
    println!("score    : {}", r.score);
    println!("identity : {:.1}% ({} cols)", r.percent_identity, r.length);
    ExitCode::SUCCESS
}

/// Read a FASTA file and return the first sequence's ungapped residues.
fn first_sequence(path: &str) -> Result<Vec<u8>, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("cannot read '{path}': {e}"))?;
    let out = align_core::parse_fasta(&bytes).map_err(|e| format!("parse '{path}': {e}"))?;
    let ds = align_core::Dataset::from_records(&out.records);
    match ds.sequences.first() {
        Some(seq) => Ok(seq.residues.clone()),
        None => Err(format!("'{path}' has no sequences")),
    }
}

/// Read a FASTA file and return every sequence's name + ungapped residues.
fn all_sequences(path: &str) -> Result<Vec<(String, Vec<u8>)>, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("cannot read '{path}': {e}"))?;
    let out = align_core::parse_fasta(&bytes).map_err(|e| format!("parse '{path}': {e}"))?;
    let ds = align_core::Dataset::from_records(&out.records);
    if ds.sequences.is_empty() {
        return Err(format!("'{path}' has no sequences"));
    }
    Ok(ds
        .sequences
        .iter()
        .map(|s| (s.name.clone(), s.residues.clone()))
        .collect())
}

/// `msa <file.fasta> [--matrix NAME] [--gap-open N] [--gap-extend N]`
///
/// Progressively aligns **all** sequences in the file (their ungapped residues)
/// with the in-process aligner and prints the result as aligned FASTA. Matrix and
/// gap penalties default to the alphabet inferred across all records (`widen`).
/// Always global — progressive alignment has no local mode. The headless exercise
/// of the MSA engine.
fn msa_cmd(args: &[String]) -> ExitCode {
    let mut files: Vec<&str> = Vec::new();
    let mut engine_name: Option<String> = None;
    let mut matrix_name: Option<String> = None;
    let mut gap_open: Option<i32> = None;
    let mut gap_extend: Option<i32> = None;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--engine" => match args.get(i + 1) {
                Some(n) => {
                    engine_name = Some(n.clone());
                    i += 2;
                }
                None => {
                    eprintln!("error: --engine expects a name (progressive|kalign)");
                    return ExitCode::FAILURE;
                }
            },
            "--matrix" => match args.get(i + 1) {
                Some(n) => {
                    matrix_name = Some(n.clone());
                    i += 2;
                }
                None => {
                    eprintln!("error: --matrix expects a name");
                    return ExitCode::FAILURE;
                }
            },
            "--gap-open" => match args.get(i + 1).map(|s| s.parse::<i32>()) {
                Some(Ok(v)) => {
                    gap_open = Some(v);
                    i += 2;
                }
                _ => {
                    eprintln!("error: --gap-open expects an integer");
                    return ExitCode::FAILURE;
                }
            },
            "--gap-extend" => match args.get(i + 1).map(|s| s.parse::<i32>()) {
                Some(Ok(v)) => {
                    gap_extend = Some(v);
                    i += 2;
                }
                _ => {
                    eprintln!("error: --gap-extend expects an integer");
                    return ExitCode::FAILURE;
                }
            },
            s if s.starts_with("--") => {
                eprintln!("error: unknown flag '{s}'");
                return ExitCode::FAILURE;
            }
            s => {
                files.push(s);
                i += 1;
            }
        }
    }

    if files.len() != 1 {
        eprintln!(
            "usage: iberalign-cli msa <file.fasta> [--engine progressive|kalign] \
             [--matrix blosum62|blosum45|blosum80|pam250|dna] [--gap-open N] [--gap-extend N]"
        );
        return ExitCode::FAILURE;
    }

    let seqs = match all_sequences(files[0]) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("error: {e}");
            return ExitCode::FAILURE;
        }
    };

    // Infer the alphabet across every sequence (widen), like `align` does over two.
    let alphabet = seqs
        .iter()
        .map(|(_, r)| align_core::Alphabet::infer(r))
        .reduce(|acc, a| acc.widen(a))
        .unwrap_or(align_core::Alphabet::Dna);
    let matrix = match &matrix_name {
        Some(n) => match align_core::SubstitutionMatrix::by_name(n) {
            Some(m) => m,
            None => {
                eprintln!(
                    "error: unknown matrix '{n}' (try blosum62|blosum45|blosum80|pam250|dna)"
                );
                return ExitCode::FAILURE;
            }
        },
        None => align_core::SubstitutionMatrix::default_for(alphabet),
    };
    let defaults = align_core::Scoring::default_for(alphabet);
    let scoring = align_core::Scoring {
        gap_open: gap_open.unwrap_or(defaults.gap_open),
        gap_extend: gap_extend.unwrap_or(defaults.gap_extend),
    };

    let engine = match &engine_name {
        Some(n) => match align_core::MsaEngine::from_name(n) {
            Some(e) => e,
            None => {
                eprintln!("error: unknown engine '{n}' (try progressive|kalign)");
                return ExitCode::FAILURE;
            }
        },
        None => align_core::MsaEngine::Progressive,
    };

    let refs: Vec<&[u8]> = seqs.iter().map(|(_, r)| r.as_slice()).collect();
    let res = match engine {
        align_core::MsaEngine::Progressive => {
            align_core::progressive_align(&refs, &matrix, scoring)
        }
        align_core::MsaEngine::Kalign => {
            // KAlign uses its own tuned defaults; `--matrix`/`--gap-*` apply only
            // to the progressive backend.
            #[cfg(feature = "kalign")]
            {
                match align_extern::kalign_align(&refs, alphabet) {
                    Ok(r) => r,
                    Err(e) => {
                        eprintln!("error: {e}");
                        return ExitCode::FAILURE;
                    }
                }
            }
            #[cfg(not(feature = "kalign"))]
            {
                eprintln!(
                    "error: the KAlign engine is not built (rebuild align-cli \
                     with --features kalign)"
                );
                return ExitCode::FAILURE;
            }
        }
    };

    eprintln!(
        "aligned {} sequences ({}) via {} to width {}",
        seqs.len(),
        alphabet.label(),
        engine.as_str(),
        res.length
    );
    for ((name, _), row) in seqs.iter().zip(&res.rows) {
        println!(">{name}");
        println!("{}", String::from_utf8_lossy(row));
    }
    ExitCode::SUCCESS
}

/// `translate <file.fasta> [--mode degap|codon] [--code N]`
///
/// Translates **every** sequence in the file to protein under a genetic code
/// (default NCBI table 1, Standard) and prints the result as FASTA. `--mode
/// degap` (default) strips gaps then reads codons per sequence; `--mode codon`
/// reads codons through the alignment columns (all-gap codon → `-`, a codon
/// spanning a gap → `X`, keeping 1:3 column correspondence). The headless
/// exercise of the translate engine.
fn translate_cmd(args: &[String]) -> ExitCode {
    let mut files: Vec<&str> = Vec::new();
    let mut mode = align_core::TranslateMode::Degap;
    let mut code_id: u8 = 1;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--mode" => {
                match args.get(i + 1).map(String::as_str) {
                    Some("degap") => mode = align_core::TranslateMode::Degap,
                    Some("codon") => mode = align_core::TranslateMode::CodonThrough,
                    _ => {
                        eprintln!("error: --mode expects 'degap' or 'codon'");
                        return ExitCode::FAILURE;
                    }
                }
                i += 2;
            }
            "--code" => match args.get(i + 1).map(|s| s.parse::<u8>()) {
                Some(Ok(v)) => {
                    code_id = v;
                    i += 2;
                }
                _ => {
                    eprintln!("error: --code expects an integer table id");
                    return ExitCode::FAILURE;
                }
            },
            s if s.starts_with("--") => {
                eprintln!("error: unknown flag '{s}'");
                return ExitCode::FAILURE;
            }
            s => {
                files.push(s);
                i += 1;
            }
        }
    }

    if files.len() != 1 {
        eprintln!("usage: iberalign-cli translate <file.fasta> [--mode degap|codon] [--code N]");
        return ExitCode::FAILURE;
    }

    let code = match align_core::GeneticCode::by_id(code_id) {
        Some(c) => c,
        None => {
            eprintln!("error: unknown genetic code table '{code_id}' (only 1/Standard available)");
            return ExitCode::FAILURE;
        }
    };

    let bytes = match std::fs::read(files[0]) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("error: cannot read '{}': {e}", files[0]);
            return ExitCode::FAILURE;
        }
    };
    let out = match align_core::parse_fasta(&bytes) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("parse error: {e}");
            return ExitCode::FAILURE;
        }
    };
    let ds = align_core::Dataset::from_records(&out.records);
    if ds.sequences.is_empty() {
        eprintln!("error: '{}' has no sequences", files[0]);
        return ExitCode::FAILURE;
    }

    for (i, seq) in ds.sequences.iter().enumerate() {
        // Degap reads the ungapped residues; codon-through walks the aligned row
        // in column coordinates (feeding degapped residues here would make
        // --mode codon a silent no-op identical to degap).
        let input: &[u8] = match mode {
            align_core::TranslateMode::Degap => &seq.residues,
            align_core::TranslateMode::CodonThrough => &ds.alignment.rows[i].gapped,
        };
        let protein = align_core::translate(input, &code, mode);
        println!(">{}", seq.name);
        println!("{}", String::from_utf8_lossy(&protein));
    }
    for w in &out.warnings {
        eprintln!("warning: {w}");
    }
    ExitCode::SUCCESS
}

/// `generate <rows> <cols> <out.fasta> [gap_pct]` — write a synthetic
/// equal-width FASTA to a file, for the rendering perf smoke (spec §12).
///
/// Writes bytes straight from Rust to an explicit path — **not** stdout — so a
/// console redirect can't corrupt the file (on Windows PowerShell `>` emits
/// UTF-16LE+BOM, which the parser rejects). The large fixture is gitignored;
/// this command is the reproducible artifact. Content is uniform random ACGT
/// with ~`gap_pct`% interior gaps (default 8): real rows have no horizontal
/// correlation, so this already yields realistic short fill-runs for the
/// renderer without faking per-column conservation.
fn generate(args: &[String]) -> ExitCode {
    let (rows, cols) = match (args.first(), args.get(1)) {
        (Some(r), Some(c)) => match (r.parse::<usize>(), c.parse::<usize>()) {
            (Ok(r), Ok(c)) => (r, c),
            _ => {
                eprintln!("error: <rows> and <cols> must be non-negative integers");
                return ExitCode::FAILURE;
            }
        },
        _ => {
            eprintln!("usage: iberalign-cli generate <rows> <cols> <out.fasta> [gap_pct]");
            return ExitCode::FAILURE;
        }
    };
    let out_path = match args.get(2) {
        Some(p) => p,
        None => {
            eprintln!("usage: iberalign-cli generate <rows> <cols> <out.fasta> [gap_pct]");
            return ExitCode::FAILURE;
        }
    };
    let gap_pct: u64 = match args.get(3).map(|s| s.parse::<u64>()) {
        None => 8,
        Some(Ok(p)) if p <= 100 => p,
        _ => {
            eprintln!("error: [gap_pct] must be an integer in 0..=100");
            return ExitCode::FAILURE;
        }
    };

    let file = match std::fs::File::create(out_path) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("error: cannot create '{out_path}': {e}");
            return ExitCode::FAILURE;
        }
    };
    let mut w = BufWriter::new(file);
    match write_fasta(&mut w, rows, cols, gap_pct, GEN_SEED).and_then(|()| w.flush()) {
        Ok(()) => {
            eprintln!("wrote {rows} × {cols} FASTA ({gap_pct}% gaps) to {out_path}");
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("error: writing '{out_path}': {e}");
            ExitCode::FAILURE
        }
    }
}

/// Fixed seed so a given `(rows, cols, gap_pct)` regenerates byte-for-byte.
const GEN_SEED: u64 = 0x1B_E5_A1_16_C0_DE_F0_0D;

/// Stream a `rows × cols` FASTA of uniform-random ACGT with `gap_pct`% gaps to
/// `w`. Deterministic in `seed`; one unwrapped sequence line per row. Generic
/// over `Write` so tests can target a `Vec<u8>` without touching the filesystem.
fn write_fasta<W: Write>(
    w: &mut W,
    rows: usize,
    cols: usize,
    gap_pct: u64,
    seed: u64,
) -> std::io::Result<()> {
    const BASES: [u8; 4] = [b'A', b'C', b'G', b'T'];
    let mut state = seed;
    // Reused per-row scratch: `cols` residues + the trailing newline.
    let mut line = Vec::with_capacity(cols + 1);
    for r in 0..rows {
        writeln!(w, ">seq{r}")?;
        line.clear();
        for _ in 0..cols {
            let roll = next_u64(&mut state);
            let byte = if roll % 100 < gap_pct {
                b'-'
            } else {
                BASES[((roll >> 8) & 0b11) as usize]
            };
            line.push(byte);
        }
        line.push(b'\n');
        w.write_all(&line)?;
    }
    Ok(())
}

/// SplitMix64 — a tiny self-contained PRNG (no `rand` dependency). Good enough
/// for synthetic fixture content; not for anything security-sensitive.
fn next_u64(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// Read from a path, or from stdin when the arg is missing or "-".
fn read_input(path: Option<&str>) -> std::io::Result<Vec<u8>> {
    match path {
        None | Some("-") => {
            let mut buf = Vec::new();
            std::io::stdin().read_to_end(&mut buf)?;
            Ok(buf)
        }
        Some(p) => std::fs::read(p),
    }
}

fn usage() {
    eprintln!("usage:");
    eprintln!("  iberalign-cli summary     <file.fasta | ->");
    eprintln!("  iberalign-cli composition <file.fasta | ->");
    eprintln!("  iberalign-cli generate    <rows> <cols> <out.fasta> [gap_pct]");
    eprintln!("  iberalign-cli align       <a.fasta> <b.fasta> [--mode global|local]");
    eprintln!("                            [--matrix NAME] [--gap-open N] [--gap-extend N]");
    eprintln!("  iberalign-cli msa         <file.fasta> [--matrix NAME]");
    eprintln!("                            [--gap-open N] [--gap-extend N]");
    eprintln!("  iberalign-cli translate   <file.fasta> [--mode degap|codon] [--code N]");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_fasta_parses_to_expected_shape() {
        let mut buf = Vec::new();
        write_fasta(&mut buf, 7, 13, 8, GEN_SEED).unwrap();

        let out = align_core::parse_fasta(&buf).expect("synthetic FASTA parses");
        assert!(
            out.warnings.is_empty(),
            "unexpected warnings: {:?}",
            out.warnings
        );
        let ds = align_core::Dataset::from_records(&out.records);
        assert_eq!(ds.sequences.len(), 7, "row count");
        assert_eq!(
            ds.alignment.width, 13,
            "alignment width (equal-width input)"
        );
    }

    #[test]
    fn generation_is_deterministic() {
        let mut a = Vec::new();
        let mut b = Vec::new();
        write_fasta(&mut a, 20, 40, 10, GEN_SEED).unwrap();
        write_fasta(&mut b, 20, 40, 10, GEN_SEED).unwrap();
        assert_eq!(
            a, b,
            "same (rows, cols, gap_pct, seed) -> byte-identical output"
        );
    }

    #[test]
    fn zero_gap_pct_yields_no_gaps() {
        let mut buf = Vec::new();
        write_fasta(&mut buf, 5, 50, 0, GEN_SEED).unwrap();
        assert!(
            !buf.contains(&b'-'),
            "gap_pct=0 must produce no '-' residues"
        );
    }

    /// The `msa` subcommand's decision path: infer + widen the alphabet across
    /// all sequences, pick the default matrix/scoring, align. Asserts the engine
    /// output is equal-width with input fidelity (the property `msa` prints).
    #[test]
    fn msa_path_aligns_to_equal_width_with_fidelity() {
        use align_core::{progressive_align, Alphabet, Scoring, SubstitutionMatrix};
        let seqs: Vec<Vec<u8>> = vec![
            b"ACGTACGTACGT".to_vec(),
            b"ACGTTCGTACGT".to_vec(),
            b"ACGAACGTAGT".to_vec(),
        ];
        let alphabet = seqs
            .iter()
            .map(|r| Alphabet::infer(r))
            .reduce(|acc, a| acc.widen(a))
            .unwrap();
        let matrix = SubstitutionMatrix::default_for(alphabet);
        let scoring = Scoring::default_for(alphabet);
        let refs: Vec<&[u8]> = seqs.iter().map(|v| v.as_slice()).collect();
        let res = progressive_align(&refs, &matrix, scoring);

        let degap = |s: &[u8]| -> Vec<u8> {
            s.iter()
                .copied()
                .filter(|&b| b != b'-' && b != b'.')
                .collect()
        };
        for (row, src) in res.rows.iter().zip(&seqs) {
            assert_eq!(row.len(), res.length, "every row is the alignment width");
            assert_eq!(degap(row), *src, "row de-gaps to its input");
        }
        assert!(res.length >= 12, "width at least the longest input");
    }

    #[test]
    fn matrix_names_resolve_case_insensitively() {
        use align_core::SubstitutionMatrix;
        assert!(SubstitutionMatrix::by_name("BLOSUM62").is_some());
        assert!(SubstitutionMatrix::by_name("pam250").is_some());
        assert!(SubstitutionMatrix::by_name("dna").is_some());
        assert!(SubstitutionMatrix::by_name("nt").is_some());
        assert!(SubstitutionMatrix::by_name("nonsense").is_none());
    }
}
