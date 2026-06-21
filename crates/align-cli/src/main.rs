//! `iberalign-cli` — headless front end over `align-core`.
//!
//! Usage:
//!   iberalign-cli summary <file.fasta>       # print a load summary
//!   iberalign-cli composition <file.fasta>   # print composition stats
//!   cat file.fasta | iberalign-cli summary -
//!
//! Exists so the full parse → analyze → export path can be exercised in CI
//! without the webview. Subcommands grow alongside the engine milestones.

use std::io::Read;
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
    eprintln!("usage: iberalign-cli <summary|composition> <file.fasta | ->");
}
