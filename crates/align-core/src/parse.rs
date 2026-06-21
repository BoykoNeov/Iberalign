//! Tolerant FASTA parsing and a cheap summary for the load path.
//!
//! Scope for this scaffold (M1 baseline): records split on `>` headers,
//! mixed line endings (LF/CRLF/CR), `;` comment lines and blank lines
//! ignored, residues uppercased, gaps/whitespace handled. Fuller real-world
//! mess (duplicate-name disambiguation, soft-mask preservation, streaming
//! large files) is tracked for M1 polish in the spec §7.

use crate::model::{Alphabet, SeqId, Sequence};

#[derive(thiserror::Error, Debug, PartialEq, Eq)]
pub enum ParseError {
    #[error("input contained no FASTA records (no '>' header found)")]
    NoRecords,
    #[error("record {0} has an empty sequence body")]
    EmptyRecord(usize),
}

/// Lightweight, UI-facing description of a parsed set of sequences.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Summary {
    pub count: usize,
    pub alphabet: Alphabet,
    pub min_len: usize,
    pub max_len: usize,
    /// True if all sequences share one length (i.e. already aligned).
    pub equal_length: bool,
}

/// Parse FASTA bytes into ungapped sequences.
///
/// Header line: everything after `>` up to the first whitespace is the name;
/// the remainder is the description. Residues from following lines are
/// concatenated, uppercased, with interior whitespace stripped.
pub fn parse_fasta(bytes: &[u8]) -> Result<Vec<Sequence>, ParseError> {
    let mut seqs: Vec<Sequence> = Vec::new();
    let mut next_id: SeqId = 0;

    let mut cur_name: Option<String> = None;
    let mut cur_desc = String::new();
    let mut cur_residues: Vec<u8> = Vec::new();

    // Flush the in-progress record into `seqs`.
    let flush = |name: &mut Option<String>,
                 desc: &mut String,
                 residues: &mut Vec<u8>,
                 id: &mut SeqId,
                 out: &mut Vec<Sequence>| {
        if let Some(n) = name.take() {
            let residues = std::mem::take(residues);
            let alphabet = infer_alphabet(&residues);
            out.push(Sequence {
                id: *id,
                name: n,
                description: std::mem::take(desc),
                alphabet,
                residues,
            });
            *id += 1;
        }
    };

    for raw_line in split_lines(bytes) {
        let line = trim_ascii(raw_line);
        if line.is_empty() || line[0] == b';' {
            continue; // blank or comment line
        }
        if line[0] == b'>' {
            flush(
                &mut cur_name,
                &mut cur_desc,
                &mut cur_residues,
                &mut next_id,
                &mut seqs,
            );
            let header = &line[1..];
            let (name, desc) = split_header(header);
            cur_name = Some(name);
            cur_desc = desc;
        } else {
            for &b in line {
                if b.is_ascii_whitespace() {
                    continue;
                }
                cur_residues.push(b.to_ascii_uppercase());
            }
        }
    }
    flush(
        &mut cur_name,
        &mut cur_desc,
        &mut cur_residues,
        &mut next_id,
        &mut seqs,
    );

    if seqs.is_empty() {
        return Err(ParseError::NoRecords);
    }
    if let Some(i) = seqs.iter().position(|s| s.residues.is_empty()) {
        return Err(ParseError::EmptyRecord(i));
    }
    Ok(seqs)
}

/// Compute a [`Summary`] over parsed sequences. The reported alphabet is the
/// "widest" present (Protein > Rna > Dna), so a mixed set is described by its
/// most general member.
pub fn summarize(seqs: &[Sequence]) -> Summary {
    let count = seqs.len();
    let mut min_len = usize::MAX;
    let mut max_len = 0usize;
    let mut alphabet = Alphabet::Dna;
    for s in seqs {
        let n = s.residues.len();
        min_len = min_len.min(n);
        max_len = max_len.max(n);
        alphabet = widen(alphabet, s.alphabet);
    }
    if count == 0 {
        min_len = 0;
    }
    Summary {
        count,
        alphabet,
        min_len,
        max_len,
        equal_length: count > 0 && min_len == max_len,
    }
}

/// Pick the more general alphabet of two.
fn widen(a: Alphabet, b: Alphabet) -> Alphabet {
    use Alphabet::*;
    match (a, b) {
        (Protein, _) | (_, Protein) => Protein,
        (Rna, _) | (_, Rna) => Rna,
        _ => Dna,
    }
}

/// Infer alphabet from residue composition.
///
/// Heuristic: if non-ACGTUN letters dominate, it's protein; otherwise nucleic,
/// and the presence of `U` (without `T`) marks RNA.
fn infer_alphabet(residues: &[u8]) -> Alphabet {
    let mut nucleic = 0usize;
    let mut letters = 0usize;
    let mut has_u = false;
    let mut has_t = false;
    for &b in residues {
        let c = b.to_ascii_uppercase();
        if !c.is_ascii_alphabetic() {
            continue; // ignore gaps, '*', etc. for inference
        }
        letters += 1;
        match c {
            b'A' | b'C' | b'G' | b'T' | b'U' | b'N' => {
                nucleic += 1;
                has_u |= c == b'U';
                has_t |= c == b'T';
            }
            // Common nucleotide IUPAC ambiguity codes.
            b'R' | b'Y' | b'S' | b'W' | b'K' | b'M' | b'B' | b'D' | b'H' | b'V' => {
                nucleic += 1;
            }
            _ => {}
        }
    }
    if letters == 0 {
        return Alphabet::Dna;
    }
    // >= 90% of letters look nucleic -> treat as nucleic acid.
    if nucleic * 10 >= letters * 9 {
        if has_u && !has_t {
            Alphabet::Rna
        } else {
            Alphabet::Dna
        }
    } else {
        Alphabet::Protein
    }
}

/// Split a header (after the `>`) into `(name, description)`.
fn split_header(header: &[u8]) -> (String, String) {
    let s = String::from_utf8_lossy(header);
    match s.find(char::is_whitespace) {
        Some(i) => (s[..i].to_string(), s[i..].trim_start().to_string()),
        None => (s.to_string(), String::new()),
    }
}

/// Split bytes into lines, tolerating LF, CRLF, and lone-CR endings.
fn split_lines(bytes: &[u8]) -> impl Iterator<Item = &[u8]> {
    LineSplit { bytes, idx: 0 }
}

struct LineSplit<'a> {
    bytes: &'a [u8],
    idx: usize,
}

impl<'a> Iterator for LineSplit<'a> {
    type Item = &'a [u8];
    fn next(&mut self) -> Option<&'a [u8]> {
        if self.idx >= self.bytes.len() {
            return None;
        }
        let start = self.idx;
        let mut i = start;
        while i < self.bytes.len() && self.bytes[i] != b'\n' && self.bytes[i] != b'\r' {
            i += 1;
        }
        let line = &self.bytes[start..i];
        // Consume the line terminator (handles \r\n as one break).
        if i < self.bytes.len() {
            if self.bytes[i] == b'\r' && i + 1 < self.bytes.len() && self.bytes[i + 1] == b'\n' {
                i += 2;
            } else {
                i += 1;
            }
        }
        self.idx = i;
        Some(line)
    }
}

/// Trim ASCII whitespace from both ends of a byte slice.
fn trim_ascii(mut s: &[u8]) -> &[u8] {
    while let [first, rest @ ..] = s {
        if first.is_ascii_whitespace() {
            s = rest;
        } else {
            break;
        }
    }
    while let [rest @ .., last] = s {
        if last.is_ascii_whitespace() {
            s = rest;
        } else {
            break;
        }
    }
    s
}
