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
    /// An aligned row was not the input with gaps inserted — KAlign canonicalized a
    /// residue. Rejected so the lossless in-place edit can't silently rewrite data.
    OutputMismatch,
}

impl fmt::Display for ExternError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ExternError::Failed => write!(f, "KAlign alignment failed"),
            ExternError::EmptyResult => write!(f, "KAlign produced no output"),
            ExternError::InteriorNul => {
                write!(f, "input sequence contains an interior NUL byte")
            }
            ExternError::OutputMismatch => {
                write!(
                    f,
                    "KAlign altered residues (not gap-only); refusing to avoid data loss"
                )
            }
        }
    }
}

/// True iff `row` is exactly `input` with `-` gaps inserted — i.e. the non-gap
/// bytes of `row`, in order, equal `input` byte-for-byte (NO case folding). This is
/// the losslessness invariant our in-place edit depends on.
fn is_input_with_gaps(row: &[u8], input: &[u8]) -> bool {
    let mut want = input.iter();
    for &b in row {
        if b == b'-' {
            continue;
        }
        match want.next() {
            Some(&x) if x == b => {}
            _ => return false,
        }
    }
    want.next().is_none()
}

impl std::error::Error for ExternError {}

/// Align ungapped sequences with KAlign v3.
///
/// Returns equal-width gapped rows in **input order**. Mirrors
/// `progressive_align`'s degenerate-input guards: `N == 0` -> empty, `N == 1` ->
/// the single sequence unchanged. Gap penalties use KAlign's matrix-tuned
/// defaults (passing negatives tells `aln_param_init` not to override), and
/// `n_threads == 1` keeps the result deterministic.
///
/// Errors (never a panic across the FFI): [`ExternError::Failed`] when KAlign's
/// own biotype check rejects the input — notably *pathologically* ambiguous DNA
/// (≥~half non-ACGT reads as protein under `--type dna`); the caller surfaces it
/// and the user can fall back to the progressive engine. [`ExternError::OutputMismatch`]
/// if a returned row isn't the input with gaps inserted (KAlign preserves bytes +
/// case in practice, so this guards an invariant rather than a known case).
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

    // Losslessness guard. Our in-place edit (apply_to_dataset resyncs each row's
    // ungapped residues from the spliced bytes) trusts that every aligned row is the
    // input with gaps inserted. KAlign preserves input bytes + case in practice, but
    // if it ever canonicalized a residue (RNA U->T, an ambiguity code, …) the edit
    // would silently rewrite the user's data — so reject rather than return it.
    for (row, &input) in rows.iter().zip(seqs.iter()) {
        if !is_input_with_gaps(row, input) {
            return Err(ExternError::OutputMismatch);
        }
    }

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

    // The losslessness invariant the in-place edit depends on must hold across the
    // residue domain — not just clean uppercase DNA. If KAlign ever canonicalized a
    // residue (RNA U->T, an ambiguity code, soft-masked lowercase) the guard would
    // turn this Ok into Err(OutputMismatch), failing loudly instead of corrupting.
    #[test]
    fn preserves_residues_across_alphabets() {
        let cases: [(Alphabet, [&[u8]; 3]); 4] = [
            // RNA with U.
            (Alphabet::Rna, [b"ACGUACGU", b"ACGUAACGU", b"ACGUACGU"]),
            // Protein with X (unknown) and * (stop).
            (Alphabet::Protein, [b"HEAGAWX", b"HEAGAW", b"HEAGAW*"]),
            // DNA with realistic (occasional) ambiguity codes (N, R). KAlign's own
            // biotype detector rejects *pathologically* ambiguous DNA (≥~half
            // non-ACGT) as mistyped protein — a clean Err(Failed), not corruption —
            // so keep the ambiguity sparse, like real data.
            (
                Alphabet::Dna,
                [
                    b"ACGTACGTNACGTACGT",
                    b"ACGTACGTACGTACGT",
                    b"ACGTANGTRACGTACGT",
                ],
            ),
            // Soft-masked (lowercase) DNA.
            (Alphabet::Dna, [b"acgtacgt", b"acgtaacgt", b"acgtacgt"]),
        ];
        for (alphabet, inputs) in cases {
            let r = kalign_align(&inputs, alphabet)
                .unwrap_or_else(|e| panic!("{alphabet:?} {inputs:?}: {e}"));
            for (row, inp) in r.rows.iter().zip(inputs.iter()) {
                let degapped: Vec<u8> = row.iter().filter(|&&b| b != b'-').copied().collect();
                assert_eq!(
                    &degapped, inp,
                    "{alphabet:?}: KAlign must return input + gaps byte-for-byte"
                );
            }
        }
    }

    // Empty (all-gap) sequences reach KAlign across the FFI (the length==0 skip is one
    // layer up in commands.rs). Must return cleanly or error — never crash the process.
    #[test]
    fn empty_among_nonempty_does_not_crash() {
        let inputs: [&[u8]; 3] = [b"ACGTACGT", b"", b"ACGTACGT"];
        // Either a valid lossless MSA or a clean ExternError — just not a segfault.
        if let Ok(r) = kalign_align(&inputs, Alphabet::Dna) {
            assert_eq!(r.rows.len(), 3);
            for (row, inp) in r.rows.iter().zip(inputs.iter()) {
                let degapped: Vec<u8> = row.iter().filter(|&&b| b != b'-').copied().collect();
                assert_eq!(&degapped, inp);
            }
        }
    }

    #[test]
    fn all_empty_does_not_crash() {
        let inputs: [&[u8]; 2] = [b"", b""];
        let _ = kalign_align(&inputs, Alphabet::Dna); // Ok or Err, just no crash.
    }
}
