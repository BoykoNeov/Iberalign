//! Safe wrapper over vendored KAlign v3 (Apache-2.0), compiled in by `build.rs`.
//!
//! We call only the legacy single-function entry point:
//! ```c
//! int kalign(char **seq, int *len, int numseq, int n_threads, int type,
//!            float gpo, float gpe, float tgpe, char ***aligned, int *out_aln_len);
//! ```
//! It takes ungapped sequences and returns equal-width gapped rows in INPUT
//! order. The output `char***` is built with plain `malloc`, so we free each row
//! then the array with `free`.

use std::ffi::{c_char, c_float, c_int, c_void};
use std::fmt;
use std::ptr;

use align_core::{Alphabet, MsaResult};

extern "C" {
    fn kalign(
        seq: *mut *mut c_char,
        len: *mut c_int,
        numseq: c_int,
        n_threads: c_int,
        ty: c_int,
        gpo: c_float,
        gpe: c_float,
        tgpe: c_float,
        aligned: *mut *mut *mut c_char,
        out_aln_len: *mut c_int,
    ) -> c_int;

    // KAlign's output array is plain malloc'd (MMALLOC == malloc); free with the
    // matching CRT free.
    fn free(ptr: *mut c_void);
}

// v3.5.1 KALIGN_TYPE_* constants (lib/include/kalign/kalign.h).
// NB: these differ from the `main` branch (where DNA == 5) — pinned to the tag.
const KALIGN_TYPE_DNA: c_int = 0;
const KALIGN_TYPE_RNA: c_int = 2;
const KALIGN_TYPE_PROTEIN: c_int = 3;

fn kalign_type(a: Alphabet) -> c_int {
    match a {
        Alphabet::Dna => KALIGN_TYPE_DNA,
        Alphabet::Rna => KALIGN_TYPE_RNA,
        Alphabet::Protein => KALIGN_TYPE_PROTEIN,
    }
}

/// Failure modes of the KAlign FFI call. Never panics across the FFI boundary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExternError {
    /// `kalign()` returned non-OK (internal FAIL).
    Failed,
    /// `kalign()` returned OK but produced empty/missing output.
    EmptyResult,
    /// An input sequence contained an interior NUL byte (not a valid residue).
    InteriorNul,
}

impl fmt::Display for ExternError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ExternError::Failed => write!(f, "KAlign alignment failed"),
            ExternError::EmptyResult => write!(f, "KAlign produced no output"),
            ExternError::InteriorNul => {
                write!(f, "input sequence contains an interior NUL byte")
            }
        }
    }
}

impl std::error::Error for ExternError {}

/// Align ungapped sequences with KAlign v3.
///
/// Returns equal-width gapped rows in **input order**. Mirrors
/// `progressive_align`'s degenerate-input guards: `N == 0` -> empty, `N == 1` ->
/// the single sequence unchanged. Gap penalties use KAlign's matrix-tuned
/// defaults (passing negatives tells `aln_param_init` not to override), and
/// `n_threads == 1` keeps the result deterministic.
pub fn kalign_align(seqs: &[&[u8]], alphabet: Alphabet) -> Result<MsaResult, ExternError> {
    match seqs.len() {
        0 => {
            return Ok(MsaResult {
                rows: Vec::new(),
                length: 0,
            })
        }
        1 => {
            let row = seqs[0].to_vec();
            let length = row.len();
            return Ok(MsaResult {
                rows: vec![row],
                length,
            });
        }
        _ => {}
    }

    // Build NUL-terminated C strings. KAlign mutates nothing it shouldn't, but
    // the API is non-const, so hand it owned, writable buffers.
    let mut owned: Vec<Vec<c_char>> = Vec::with_capacity(seqs.len());
    for s in seqs {
        if s.contains(&0) {
            return Err(ExternError::InteriorNul);
        }
        let mut v: Vec<c_char> = s.iter().map(|&b| b as c_char).collect();
        v.push(0);
        owned.push(v);
    }
    let mut ptrs: Vec<*mut c_char> = owned.iter_mut().map(|v| v.as_mut_ptr()).collect();
    let mut lens: Vec<c_int> = seqs.iter().map(|s| s.len() as c_int).collect();

    let mut aligned: *mut *mut c_char = ptr::null_mut();
    let mut out_len: c_int = 0;

    let rc = unsafe {
        kalign(
            ptrs.as_mut_ptr(),
            lens.as_mut_ptr(),
            seqs.len() as c_int,
            1, // n_threads
            kalign_type(alphabet),
            -1.0, // gpo  < 0 => KAlign's tuned default
            -1.0, // gpe
            -1.0, // tgpe
            &mut aligned,
            &mut out_len,
        )
    };

    if rc != 0 {
        if !aligned.is_null() {
            free_aligned(aligned, seqs.len());
        }
        return Err(ExternError::Failed);
    }
    if aligned.is_null() || out_len <= 0 {
        if !aligned.is_null() {
            free_aligned(aligned, seqs.len());
        }
        return Err(ExternError::EmptyResult);
    }

    let width = out_len as usize;
    let mut rows: Vec<Vec<u8>> = Vec::with_capacity(seqs.len());
    for i in 0..seqs.len() {
        let row_ptr = unsafe { *aligned.add(i) };
        if row_ptr.is_null() {
            free_aligned(aligned, seqs.len());
            return Err(ExternError::EmptyResult);
        }
        let mut row = Vec::with_capacity(width);
        for j in 0..width {
            row.push(unsafe { *row_ptr.add(j) } as u8);
        }
        rows.push(row);
    }
    free_aligned(aligned, seqs.len());

    Ok(MsaResult {
        rows,
        length: width,
    })
}

/// Free the `char***` KAlign returned: each row, then the outer array.
fn free_aligned(aligned: *mut *mut c_char, n: usize) {
    unsafe {
        for i in 0..n {
            let p = *aligned.add(i);
            if !p.is_null() {
                free(p.cast());
            }
        }
        free(aligned.cast());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn degap(row: &[u8]) -> Vec<u8> {
        row.iter().filter(|&&b| b != b'-').copied().collect()
    }

    #[test]
    fn empty_input() {
        let r = kalign_align(&[], Alphabet::Dna).unwrap();
        assert_eq!(r.length, 0);
        assert!(r.rows.is_empty());
    }

    #[test]
    fn single_sequence_unchanged() {
        let r = kalign_align(&[b"ACGT"], Alphabet::Dna).unwrap();
        assert_eq!(r.rows, vec![b"ACGT".to_vec()]);
        assert_eq!(r.length, 4);
    }

    #[test]
    fn three_dna_equal_width_input_order() {
        let inputs: [&[u8]; 3] = [b"ACGTACGT", b"ACGTAACGT", b"ACGTACGT"];
        let r = kalign_align(&inputs, Alphabet::Dna).unwrap();
        assert_eq!(r.rows.len(), 3);
        // Equal width, >= longest input.
        assert!(r.rows.iter().all(|row| row.len() == r.length));
        assert!(r.length >= 9);
        // Rows come back in INPUT order: degapped row == input (case-insensitive).
        for (row, inp) in r.rows.iter().zip(inputs.iter()) {
            assert_eq!(
                degap(row).to_ascii_uppercase(),
                inp.to_ascii_uppercase(),
                "degapped row must match its input residues in order"
            );
        }
    }

    #[test]
    fn deterministic() {
        let inputs: [&[u8]; 3] = [b"ACGTACGT", b"ACGTAACGT", b"TTACGTACGT"];
        let a = kalign_align(&inputs, Alphabet::Dna).unwrap();
        let b = kalign_align(&inputs, Alphabet::Dna).unwrap();
        assert_eq!(a.rows, b.rows);
        assert_eq!(a.length, b.length);
    }
}
