//! `iberalign-cli` — headless front end over `align-core`.
//!
//! Usage:
//!   iberalign-cli summary <file.fasta>          # print a load summary
//!   iberalign-cli composition <file.fasta>      # print composition stats
//!   iberalign-cli generate <rows> <cols> <out>  # write a synthetic FASTA
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
}
