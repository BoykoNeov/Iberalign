//! `iberalign-cli` — headless front end over `align-core`.
//!
//! Usage:
//!   iberalign-cli summary <file.fasta>   # print a load summary
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
        Ok(seqs) => {
            let s = align_core::summarize(&seqs);
            println!("sequences : {}", s.count);
            println!("alphabet  : {}", s.alphabet.label());
            println!("lengths   : {}..{}", s.min_len, s.max_len);
            println!("aligned   : {}", if s.equal_length { "yes" } else { "no" });
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
    eprintln!("usage: iberalign-cli summary <file.fasta | ->");
}
