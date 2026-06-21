//! Alignment format I/O. Reading FASTA lives in [`crate::parse`]; this module
//! holds writers and (later) Clustal/Phylip/Stockholm readers + project save.
//!
//! `write_fasta` is implemented now so M0 has a real read→write→read path to
//! test; the rest is stubbed until M5.

use crate::model::Alignment;

/// Serialize an alignment back to (gapped) FASTA. Names are taken from the
/// row's `seq_id` placeholder header for now; real names are threaded through
/// when the alignment carries `Sequence` metadata (M1+).
pub fn write_fasta(aln: &Alignment, names: &[String]) -> String {
    let mut out = String::new();
    for (i, row) in aln.rows.iter().enumerate() {
        let name = names
            .get(i)
            .cloned()
            .unwrap_or_else(|| format!("seq{}", row.seq_id));
        out.push('>');
        out.push_str(&name);
        out.push('\n');
        // Wrap residues at 60 columns, the FASTA convention.
        for chunk in row.gapped.chunks(60) {
            out.push_str(&String::from_utf8_lossy(chunk));
            out.push('\n');
        }
    }
    out
}

/// Write Clustal `.aln`. Implemented in M5.
pub fn write_clustal(_aln: &Alignment, _names: &[String]) -> String {
    todo!("M5: Clustal .aln writer")
}

/// Write Phylip. Implemented in M5.
pub fn write_phylip(_aln: &Alignment, _names: &[String]) -> String {
    todo!("M5: Phylip writer")
}
