//! Tolerant FASTA parsing and a cheap summary for the load path.
//!
//! Parsing is text-level only: it splits records on `>` headers, tolerates
//! mixed line endings (LF/CRLF/CR), ignores blank and `;` comment lines, strips
//! interior whitespace, normalizes `.` gaps to `b'-'`, and **preserves residue
//! case** (lowercase soft-masking is data). The result is a [`RawRecord`] per
//! record carrying the literal gap-preserving stream plus a non-fatal
//! [`ParseOutcome::warnings`] channel. Turning records into a padded
//! [`crate::model::Dataset`] (and the ungapped `Sequence`s) is a separate step
//! — see [`crate::model::Dataset::from_records`].

use crate::coords::is_gap;
use crate::model::{Alphabet, RawRecord};
use std::collections::HashMap;

#[derive(thiserror::Error, Debug, PartialEq, Eq)]
pub enum ParseError {
    #[error("input contained no FASTA records (no '>' header found)")]
    NoRecords,
}

/// The result of parsing: the records plus any non-fatal warnings (duplicate
/// names that were disambiguated, empty records that were skipped, …).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ParseOutcome {
    pub records: Vec<RawRecord>,
    pub warnings: Vec<String>,
}

/// Lightweight, UI-facing description of a parsed set of records.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Summary {
    pub count: usize,
    pub alphabet: Alphabet,
    /// Min/max **ungapped** residue length across records.
    pub min_len: usize,
    pub max_len: usize,
    /// Aligned width = the widest record's gapped length (the padded width).
    pub width: usize,
    /// True if every record already shares one gapped width (a rectangular
    /// matrix; no trailing padding was needed). This is a *necessary* condition
    /// for an alignment, not a sufficient one — a file whose sequences are
    /// merely gap-padded to equal length passes too, without being column-
    /// homologous. So it answers "equal width?", not "is this a good MSA?".
    pub equal_width: bool,
}

/// Parse FASTA bytes into gap-preserving records.
///
/// Header line: everything after `>` up to the first whitespace is the name;
/// the remainder is the description. Residue lines are concatenated with
/// interior whitespace stripped, `.`→`-` normalized, and case preserved.
///
/// Tolerant by design: blank/comment lines are ignored, an empty record body is
/// skipped with a warning, and duplicate names are disambiguated with a
/// warning. The only hard error is input with no `>` header at all.
pub fn parse_fasta(bytes: &[u8]) -> Result<ParseOutcome, ParseError> {
    let mut records: Vec<RawRecord> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    let mut seen_header = false;
    let mut header_ordinal = 0usize;

    let mut cur_name: Option<String> = None;
    let mut cur_desc = String::new();
    let mut cur_gapped: Vec<u8> = Vec::new();
    let mut cur_ordinal = 0usize;

    // Flush the in-progress record: push it, or warn + skip if its body is empty.
    let flush = |name: &mut Option<String>,
                 desc: &mut String,
                 gapped: &mut Vec<u8>,
                 ordinal: usize,
                 out: &mut Vec<RawRecord>,
                 warns: &mut Vec<String>| {
        if let Some(n) = name.take() {
            let gapped = std::mem::take(gapped);
            if gapped.is_empty() {
                warns.push(format!(
                    "record {ordinal} '{n}' has an empty sequence body; skipped"
                ));
                desc.clear();
            } else {
                out.push(RawRecord {
                    name: n,
                    description: std::mem::take(desc),
                    gapped,
                });
            }
        }
    };

    for raw_line in split_lines(bytes) {
        let line = trim_ascii(raw_line);
        if line.is_empty() || line[0] == b';' {
            continue; // blank or comment line
        }
        if line[0] == b'>' {
            seen_header = true;
            flush(
                &mut cur_name,
                &mut cur_desc,
                &mut cur_gapped,
                cur_ordinal,
                &mut records,
                &mut warnings,
            );
            let (name, desc) = split_header(&line[1..]);
            cur_name = Some(name);
            cur_desc = desc;
            cur_ordinal = header_ordinal;
            header_ordinal += 1;
        } else {
            for &b in line {
                if b.is_ascii_whitespace() {
                    continue;
                }
                // Normalize `.` gaps to `-`; preserve residue case otherwise.
                cur_gapped.push(if b == b'.' { b'-' } else { b });
            }
        }
    }
    flush(
        &mut cur_name,
        &mut cur_desc,
        &mut cur_gapped,
        cur_ordinal,
        &mut records,
        &mut warnings,
    );

    if !seen_header {
        return Err(ParseError::NoRecords);
    }

    disambiguate_names(&mut records, &mut warnings);
    warn_if_malformed_alignment(&records, &mut warnings);
    Ok(ParseOutcome { records, warnings })
}

/// Warn when records are unequal length yet some carry *interior* gaps — i.e.
/// the input looks like an alignment but is ragged (so it will be
/// trailing-padded, possibly not what the user intended). Plain unaligned
/// sequences (unequal length, no interior gaps) are normal and draw no warning.
fn warn_if_malformed_alignment(records: &[RawRecord], warnings: &mut Vec<String>) {
    if records.len() < 2 {
        return;
    }
    let mut min = usize::MAX;
    let mut max = 0usize;
    for r in records {
        min = min.min(r.gapped.len());
        max = max.max(r.gapped.len());
    }
    if min == max {
        return; // cleanly aligned (equal width)
    }
    if records.iter().any(|r| has_interior_gap(&r.gapped)) {
        warnings.push(format!(
            "records have unequal lengths ({min}..{max}) but some contain interior \
             gaps; trailing-padded to width {max} — the input may be a malformed alignment"
        ));
    }
}

/// True if `gapped` has a gap that is not part of its trailing run of gaps.
fn has_interior_gap(gapped: &[u8]) -> bool {
    let mut end = gapped.len();
    while end > 0 && is_gap(gapped[end - 1]) {
        end -= 1;
    }
    gapped[..end].iter().any(|&b| is_gap(b))
}

/// Compute a [`Summary`] over parsed records.
pub fn summarize(records: &[RawRecord]) -> Summary {
    let count = records.len();
    let mut min_len = usize::MAX;
    let mut max_len = 0usize;
    let mut min_gapped = usize::MAX;
    let mut max_gapped = 0usize;
    let mut alphabet = Alphabet::Dna;
    for r in records {
        let ungapped: Vec<u8> = r.gapped.iter().copied().filter(|&b| !is_gap(b)).collect();
        min_len = min_len.min(ungapped.len());
        max_len = max_len.max(ungapped.len());
        min_gapped = min_gapped.min(r.gapped.len());
        max_gapped = max_gapped.max(r.gapped.len());
        alphabet = alphabet.widen(Alphabet::infer(&ungapped));
    }
    if count == 0 {
        min_len = 0;
        min_gapped = 0;
    }
    Summary {
        count,
        alphabet,
        min_len,
        max_len,
        width: max_gapped,
        equal_width: count > 0 && min_gapped == max_gapped,
    }
}

/// Disambiguate duplicate record names in place: the first occurrence keeps its
/// name, later ones become `name.1`, `name.2`, …, each with a warning.
fn disambiguate_names(records: &mut [RawRecord], warnings: &mut Vec<String>) {
    let mut totals: HashMap<&str, usize> = HashMap::new();
    for r in records.iter() {
        *totals.entry(r.name.as_str()).or_insert(0) += 1;
    }
    // Only names seen more than once need disambiguation; clone those keys so we
    // can mutate `records` freely below.
    let dup: HashMap<String, usize> = totals
        .iter()
        .filter(|&(_, &c)| c > 1)
        .map(|(&k, _)| (k.to_string(), 0usize))
        .collect();
    if dup.is_empty() {
        return;
    }
    let mut seen = dup;
    for r in records.iter_mut() {
        if let Some(n) = seen.get_mut(&r.name) {
            if *n > 0 {
                let renamed = format!("{}.{}", r.name, *n);
                warnings.push(format!(
                    "duplicate sequence name '{}' renamed to '{}'",
                    r.name, renamed
                ));
                r.name = renamed;
            }
            *n += 1;
        }
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
