//! Pairwise alignment (M3). Needleman–Wunsch (global) and Smith–Waterman
//! (local) with affine (Gotoh) gaps. MSA is intentionally *not* here — it is
//! delegated to external aligners (MAFFT/MUSCLE/Clustal Omega), see spec §5.
//!
//! The DP is a textbook 3-state Gotoh: `M` (residue·residue), `X` (a-residue vs
//! a gap), `Y` (gap vs a b-residue). A gap of length `k` costs
//! `gap_open + (k − 1)·gap_extend` (so `gap_open` is the first position's cost).
//! Ties in every `max` resolve `M > X > Y`, which makes hand-worked test cases
//! reproducible. Scoring is delegated to a [`SubstitutionMatrix`]; gap penalties
//! live in [`Scoring`].

use crate::coords::is_gap;
use crate::matrix::SubstitutionMatrix;

/// A score standing in for −∞. Far enough below any real path score that no
/// reachable cell ties it, yet far enough above `i32::MIN` that adding a gap
/// penalty (or thousands of them) can never overflow.
const NEG: i32 = -1_000_000_000;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum AlignMode {
    /// Needleman–Wunsch: align end-to-end.
    Global,
    /// Smith–Waterman: best local subalignment.
    Local,
}

/// Affine gap penalties (typically negative). Substitution scoring is supplied
/// separately as a [`SubstitutionMatrix`].
#[derive(Clone, Copy, Debug)]
pub struct Scoring {
    /// Cost of the first position of a gap.
    pub gap_open: i32,
    /// Cost of each subsequent position of a gap.
    pub gap_extend: i32,
}

impl Scoring {
    /// Conventional nucleotide gap penalties (`-10` / `-1`).
    pub fn dna_default() -> Self {
        Scoring {
            gap_open: -10,
            gap_extend: -1,
        }
    }

    /// Conventional protein gap penalties for BLOSUM62 (`-11` / `-1`).
    pub fn protein_default() -> Self {
        Scoring {
            gap_open: -11,
            gap_extend: -1,
        }
    }

    /// The default gap penalties for an alphabet.
    pub fn default_for(alphabet: crate::model::Alphabet) -> Self {
        use crate::model::Alphabet::*;
        match alphabet {
            Dna | Rna => Self::dna_default(),
            Protein => Self::protein_default(),
        }
    }
}

/// Result of a pairwise alignment. `aligned_a`/`aligned_b` are equal-length
/// gapped byte rows (input case preserved). `percent_identity` is
/// `100 · (identical non-gap columns) / length`, where `length` is the
/// alignment length (`0` ⇒ `0.0`).
#[derive(Clone, Debug)]
pub struct PairwiseResult {
    pub aligned_a: Vec<u8>,
    pub aligned_b: Vec<u8>,
    pub score: i32,
    pub percent_identity: f32,
    pub length: usize,
}

/// Align two **ungapped** sequences with affine gaps.
pub fn pairwise(
    a: &[u8],
    b: &[u8],
    matrix: &SubstitutionMatrix,
    mode: AlignMode,
    scoring: Scoring,
) -> PairwiseResult {
    match mode {
        AlignMode::Global => global(a, b, matrix, scoring),
        AlignMode::Local => local(a, b, matrix, scoring),
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum State {
    M,
    X,
    Y,
}

#[inline]
fn max2(a: i32, b: i32) -> i32 {
    if a >= b {
        a
    } else {
        b
    }
}

#[inline]
fn max3(a: i32, b: i32, c: i32) -> i32 {
    max2(max2(a, b), c)
}

/// Argmax of the three states with tie order `M > X > Y`.
#[inline]
fn argmax3(m: i32, x: i32, y: i32) -> State {
    if m >= x && m >= y {
        State::M
    } else if x >= y {
        State::X
    } else {
        State::Y
    }
}

/// Needleman–Wunsch (global), Gotoh affine.
fn global(a: &[u8], b: &[u8], matrix: &SubstitutionMatrix, scoring: Scoring) -> PairwiseResult {
    let n = a.len();
    let m = b.len();
    let w = m + 1;
    let (go, ge) = (scoring.gap_open, scoring.gap_extend);
    let idx = |i: usize, j: usize| i * w + j;

    let mut mm = vec![NEG; (n + 1) * w];
    let mut xx = vec![NEG; (n + 1) * w]; // a-residue vs gap (consumes a)
    let mut yy = vec![NEG; (n + 1) * w]; // gap vs b-residue (consumes b)

    mm[idx(0, 0)] = 0;
    for i in 1..=n {
        xx[idx(i, 0)] = go + (i as i32 - 1) * ge;
    }
    for j in 1..=m {
        yy[idx(0, j)] = go + (j as i32 - 1) * ge;
    }

    for i in 1..=n {
        for j in 1..=m {
            let s = matrix.score(a[i - 1], b[j - 1]);
            let diag = max3(
                mm[idx(i - 1, j - 1)],
                xx[idx(i - 1, j - 1)],
                yy[idx(i - 1, j - 1)],
            );
            mm[idx(i, j)] = diag + s;
            xx[idx(i, j)] = max2(mm[idx(i - 1, j)] + go, xx[idx(i - 1, j)] + ge);
            yy[idx(i, j)] = max2(mm[idx(i, j - 1)] + go, yy[idx(i, j - 1)] + ge);
        }
    }

    let score = max3(mm[idx(n, m)], xx[idx(n, m)], yy[idx(n, m)]);

    // Traceback from the corner.
    let mut state = argmax3(mm[idx(n, m)], xx[idx(n, m)], yy[idx(n, m)]);
    let (mut i, mut j) = (n, m);
    let mut ra = Vec::new();
    let mut rb = Vec::new();
    while i > 0 || j > 0 {
        match state {
            State::M => {
                ra.push(a[i - 1]);
                rb.push(b[j - 1]);
                state = argmax3(
                    mm[idx(i - 1, j - 1)],
                    xx[idx(i - 1, j - 1)],
                    yy[idx(i - 1, j - 1)],
                );
                i -= 1;
                j -= 1;
            }
            State::X => {
                ra.push(a[i - 1]);
                rb.push(b'-');
                let from_m = mm[idx(i - 1, j)] + go;
                let from_x = xx[idx(i - 1, j)] + ge;
                state = if from_m >= from_x { State::M } else { State::X };
                i -= 1;
            }
            State::Y => {
                ra.push(b'-');
                rb.push(b[j - 1]);
                let from_m = mm[idx(i, j - 1)] + go;
                let from_y = yy[idx(i, j - 1)] + ge;
                state = if from_m >= from_y { State::M } else { State::Y };
                j -= 1;
            }
        }
    }
    ra.reverse();
    rb.reverse();
    finish(ra, rb, score)
}

/// Smith–Waterman (local), Gotoh affine.
fn local(a: &[u8], b: &[u8], matrix: &SubstitutionMatrix, scoring: Scoring) -> PairwiseResult {
    let n = a.len();
    let m = b.len();
    let w = m + 1;
    let (go, ge) = (scoring.gap_open, scoring.gap_extend);
    let idx = |i: usize, j: usize| i * w + j;

    // M boundaries start at 0 (a local alignment can begin anywhere); the gap
    // states stay at NEG (a local alignment never opens on a leading gap).
    let mut mm = vec![0i32; (n + 1) * w];
    let mut xx = vec![NEG; (n + 1) * w];
    let mut yy = vec![NEG; (n + 1) * w];

    let mut best = 0i32;
    let (mut bi, mut bj) = (0usize, 0usize);
    for i in 1..=n {
        for j in 1..=m {
            let s = matrix.score(a[i - 1], b[j - 1]);
            let diag = max3(
                mm[idx(i - 1, j - 1)],
                xx[idx(i - 1, j - 1)],
                yy[idx(i - 1, j - 1)],
            );
            let cell = max2(0, diag + s);
            mm[idx(i, j)] = cell;
            xx[idx(i, j)] = max2(mm[idx(i - 1, j)] + go, xx[idx(i - 1, j)] + ge);
            yy[idx(i, j)] = max2(mm[idx(i, j - 1)] + go, yy[idx(i, j - 1)] + ge);
            if cell > best {
                best = cell;
                bi = i;
                bj = j;
            }
        }
    }

    // Traceback from the best M cell to the first M == 0.
    let mut state = State::M;
    let (mut i, mut j) = (bi, bj);
    let mut ra = Vec::new();
    let mut rb = Vec::new();
    loop {
        match state {
            State::M => {
                if mm[idx(i, j)] == 0 {
                    break;
                }
                ra.push(a[i - 1]);
                rb.push(b[j - 1]);
                state = argmax3(
                    mm[idx(i - 1, j - 1)],
                    xx[idx(i - 1, j - 1)],
                    yy[idx(i - 1, j - 1)],
                );
                i -= 1;
                j -= 1;
            }
            State::X => {
                ra.push(a[i - 1]);
                rb.push(b'-');
                let from_m = mm[idx(i - 1, j)] + go;
                let from_x = xx[idx(i - 1, j)] + ge;
                state = if from_m >= from_x { State::M } else { State::X };
                i -= 1;
            }
            State::Y => {
                ra.push(b'-');
                rb.push(b[j - 1]);
                let from_m = mm[idx(i, j - 1)] + go;
                let from_y = yy[idx(i, j - 1)] + ge;
                state = if from_m >= from_y { State::M } else { State::Y };
                j -= 1;
            }
        }
    }
    ra.reverse();
    rb.reverse();
    finish(ra, rb, best)
}

/// Assemble a [`PairwiseResult`] from the (un-reversed) aligned rows + score,
/// computing length and %-identity.
fn finish(aligned_a: Vec<u8>, aligned_b: Vec<u8>, score: i32) -> PairwiseResult {
    debug_assert_eq!(aligned_a.len(), aligned_b.len());
    let length = aligned_a.len();
    let matches = aligned_a
        .iter()
        .zip(&aligned_b)
        .filter(|(x, y)| {
            let (a, b) = (**x, **y);
            !is_gap(a) && !is_gap(b) && a.eq_ignore_ascii_case(&b)
        })
        .count();
    let percent_identity = if length == 0 {
        0.0
    } else {
        100.0 * matches as f32 / length as f32
    };
    PairwiseResult {
        aligned_a,
        aligned_b,
        score,
        percent_identity,
        length,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mm(m: i32, x: i32) -> SubstitutionMatrix {
        SubstitutionMatrix::match_mismatch(m, x)
    }

    fn gaps(open: i32, extend: i32) -> Scoring {
        Scoring {
            gap_open: open,
            gap_extend: extend,
        }
    }

    #[test]
    fn global_identical() {
        let r = pairwise(
            b"ACGT",
            b"ACGT",
            &mm(1, -1),
            AlignMode::Global,
            gaps(-2, -1),
        );
        assert_eq!(r.aligned_a, b"ACGT");
        assert_eq!(r.aligned_b, b"ACGT");
        assert_eq!(r.score, 4);
        assert_eq!(r.length, 4);
        assert_eq!(r.percent_identity, 100.0);
    }

    #[test]
    fn global_one_mismatch() {
        let r = pairwise(
            b"ACGT",
            b"ACTT",
            &mm(1, -1),
            AlignMode::Global,
            gaps(-2, -1),
        );
        assert_eq!(r.aligned_a, b"ACGT");
        assert_eq!(r.aligned_b, b"ACTT");
        assert_eq!(r.score, 2); // 3 matches − 1 mismatch
        assert_eq!(r.length, 4);
        assert_eq!(r.percent_identity, 75.0);
    }

    #[test]
    fn global_leading_gap() {
        // Aligning CGT to ACGT must open one leading gap, not mismatch through.
        let r = pairwise(b"CGT", b"ACGT", &mm(1, -1), AlignMode::Global, gaps(-2, -1));
        assert_eq!(r.aligned_a, b"-CGT");
        assert_eq!(r.aligned_b, b"ACGT");
        assert_eq!(r.score, 1); // gap_open(-2) + 3 matches
        assert_eq!(r.length, 4);
        assert_eq!(r.percent_identity, 75.0);
    }

    #[test]
    fn global_affine_gap_cost_convention() {
        // a needs two gaps in b; affine makes them contiguous: go + 1·ge = -4,
        // not 2·go = -6. Best score = 2 matches − 4 = -2. (Several equal-score
        // placements exist, so assert the score, which pins the convention.)
        let r = pairwise(b"AAAA", b"AA", &mm(1, -1), AlignMode::Global, gaps(-3, -1));
        assert_eq!(r.score, -2);
        // round-trips: removing gaps recovers the inputs.
        assert_eq!(degap(&r.aligned_a), b"AAAA");
        assert_eq!(degap(&r.aligned_b), b"AA");
        assert_eq!(r.aligned_a.len(), r.aligned_b.len());
    }

    #[test]
    fn global_empty_sequence() {
        let r = pairwise(b"", b"ACGT", &mm(1, -1), AlignMode::Global, gaps(-2, -1));
        assert_eq!(r.aligned_a, b"----");
        assert_eq!(r.aligned_b, b"ACGT");
        assert_eq!(r.score, -5); // one gap of length 4: gap_open(-2) + 3·gap_extend(-1)
        assert_eq!(r.length, 4);
        assert_eq!(r.percent_identity, 0.0);
    }

    #[test]
    fn global_both_empty() {
        let r = pairwise(b"", b"", &mm(1, -1), AlignMode::Global, gaps(-2, -1));
        assert!(r.aligned_a.is_empty());
        assert_eq!(r.score, 0);
        assert_eq!(r.length, 0);
        assert_eq!(r.percent_identity, 0.0);
    }

    #[test]
    fn local_embedded_match() {
        let r = pairwise(
            b"AAGGTTCC",
            b"GGTT",
            &mm(2, -1),
            AlignMode::Local,
            gaps(-5, -1),
        );
        assert_eq!(r.aligned_a, b"GGTT");
        assert_eq!(r.aligned_b, b"GGTT");
        assert_eq!(r.score, 8);
        assert_eq!(r.length, 4);
        assert_eq!(r.percent_identity, 100.0);
    }

    #[test]
    fn local_no_positive_alignment() {
        let r = pairwise(b"AAAA", b"CCCC", &mm(2, -1), AlignMode::Local, gaps(-5, -1));
        assert_eq!(r.score, 0);
        assert_eq!(r.length, 0);
        assert!(r.aligned_a.is_empty());
        assert_eq!(r.percent_identity, 0.0);
    }

    #[test]
    fn protein_blosum62_global() {
        // A short protein pair under BLOSUM62 defaults.
        let matrix = SubstitutionMatrix::blosum62();
        let r = pairwise(
            b"HEAGAWGHEE",
            b"PAWHEAE",
            &matrix,
            AlignMode::Global,
            Scoring::protein_default(),
        );
        // Sanity: round-trips + equal length; identity in a plausible band.
        assert_eq!(degap(&r.aligned_a), b"HEAGAWGHEE");
        assert_eq!(degap(&r.aligned_b), b"PAWHEAE");
        assert_eq!(r.aligned_a.len(), r.aligned_b.len());
        assert!(r.percent_identity > 0.0 && r.percent_identity <= 100.0);
    }

    fn degap(s: &[u8]) -> Vec<u8> {
        s.iter().copied().filter(|&b| !is_gap(b)).collect()
    }
}
