//! Progressive multiple-sequence alignment (MSA), **in-process** (no shelling
//! out). This is our own aligner, built on the pairwise Gotoh engine in
//! [`crate::align`]; the algorithm is compiled into the binary and called as a
//! function — the MEGA model — per the user's "no shell integration for
//! alignment" decision (2026-06-29). It supersedes the earlier "delegate MSA to
//! MAFFT/MUSCLE/Clustal" plan.
//!
//! **Quality ceiling (honest):** this is *basic progressive* alignment, the
//! ClustalW class — respectable on similar sequences, below MAFFT on divergent
//! sets, with no iterative refinement. A from-scratch in-process aligner cannot
//! reach MAFFT-grade (that essentially requires MAFFT, a subprocess).
//!
//! ## Algorithm (textbook progressive)
//! 1. **Distance matrix** — all-pairs global [`pairwise`]; `d = 1 − %id/100`.
//!    Computed on the `i<j` triangle and mirrored (the pairwise *score* is
//!    symmetric but the *traceback* need not be under tie-breaking).
//! 2. **Guide tree** — **UPGMA**, fused into the merge loop: each cluster carries
//!    its current [`Profile`]; merging the two closest clusters profile-aligns
//!    them. UPGMA's merge order *is* a valid post-order of the guide tree.
//! 3. **Profile–profile merge** — a 3-state Gotoh DP over *columns* (the M/X/Y
//!    structure of [`crate::align`], tie order M>X>Y), the column substitution
//!    score being the integer sum-of-pairs average.
//!
//! ## i32 discipline (determinism)
//! Every score stays `i32`: column scores use **integer division**
//! (`sum_pair_scores / pair_count`) and counts accumulate in linear `(residue,
//! count)` lists — **no floats, no hashing in the byte-determining path**. Float
//! sums are non-associative, so unordered accumulation would make the output
//! order-dependent and break determinism intermittently. (The guide-tree
//! distances are `f64`, but they only pick the merge *order*; ties there break by
//! cluster index, so the bytes are fully reproducible.) Keeping the column score
//! integer also makes the 1×1 case **byte-exact** to [`pairwise`].
//!
//! ## Fidelity
//! We only ever **insert gap columns** — residues and case are never altered — and
//! each leaf carries its original input index, so `degap(out[i]) == in[i]` by
//! construction and the output maps back to input order. (Unlike a future
//! FFI/shell aligner, there is no foreign output to reconcile.)

use crate::align::{pairwise, AlignMode, Scoring};
use crate::coords::is_gap;
use crate::matrix::SubstitutionMatrix;

/// Stand-in for −∞, matching [`crate::align`]: far below any real path score, far
/// above `i32::MIN` so adding gap penalties never overflows.
const NEG: i32 = -1_000_000_000;

/// The result of a progressive alignment: equal-width gapped rows in **input
/// order** (`rows[i]` is `seqs[i]` aligned), plus the alignment width.
#[derive(Clone, Debug)]
pub struct MsaResult {
    pub rows: Vec<Vec<u8>>,
    pub length: usize,
}

/// One aligned row inside a profile, tagged with its original input index so the
/// final MSA can be emitted in input order regardless of guide-tree shuffling.
#[derive(Clone)]
struct Row {
    index: usize,
    gapped: Vec<u8>,
}

/// Per-column tally of **non-gap, upper-cased** residues (case folded only for
/// *scoring*; the row bytes keep their original case). `total` is the non-gap
/// count. `counts` is a short linear list (distinct residues per column ≤ the
/// alphabet, ~25), so the column–column score is O(distinct²).
#[derive(Clone)]
struct ColCounts {
    counts: Vec<(u8, i32)>,
    total: i32,
}

/// A group of already-aligned, equal-width rows plus their per-column counts.
struct Profile {
    rows: Vec<Row>,
    width: usize,
    cols: Vec<ColCounts>,
}

impl Profile {
    /// A single-sequence leaf profile (the ungapped sequence, width = its length).
    fn leaf(index: usize, seq: &[u8]) -> Profile {
        let row = Row {
            index,
            gapped: seq.to_vec(),
        };
        let width = seq.len();
        let cols = Self::tally(std::slice::from_ref(&row), width);
        Profile {
            rows: vec![row],
            width,
            cols,
        }
    }

    /// Recompute the per-column residue counts for a set of rows.
    fn tally(rows: &[Row], width: usize) -> Vec<ColCounts> {
        let mut cols = Vec::with_capacity(width);
        for c in 0..width {
            let mut counts: Vec<(u8, i32)> = Vec::new();
            let mut total = 0i32;
            for row in rows {
                let b = row.gapped[c];
                if is_gap(b) {
                    continue;
                }
                total += 1;
                let up = b.to_ascii_uppercase();
                match counts.iter_mut().find(|(r, _)| *r == up) {
                    Some(e) => e.1 += 1,
                    None => counts.push((up, 1)),
                }
            }
            cols.push(ColCounts { counts, total });
        }
        cols
    }
}

/// Sum-of-pairs column score: the integer average over non-gap residue pairs
/// `(x∈A, y∈B)` of `matrix.score(x, y)`. Within-column gaps contribute no
/// substitution term (the affine gap penalty is applied at the DP level when a
/// *gap column* is opened against the other profile).
///
/// Accumulated in `i64` (overflow-safe at the stress ceiling) then integer-divided
/// to an `i32` — the per-column average is bounded by the matrix's extreme score,
/// so it always fits.
fn column_score(a: &ColCounts, b: &ColCounts, matrix: &SubstitutionMatrix) -> i32 {
    let pair_count = a.total as i64 * b.total as i64;
    // Safe today: every column of any *merged* profile has ≥1 non-gap residue, by
    // induction from single-sequence leaves (an M column takes from both children,
    // an X column from A, a Y column from B — each ≥1 non-gap). The deferred
    // block-align could feed an all-gap sub-region; this guard keeps that from
    // becoming a release divide-by-zero panic.
    debug_assert!(
        pair_count > 0,
        "column_score: a profile column has no non-gap residue (block-align must guard this)"
    );
    if pair_count == 0 {
        return 0;
    }
    let mut num: i64 = 0;
    for &(x, cx) in &a.counts {
        for &(y, cy) in &b.counts {
            num += cx as i64 * cy as i64 * matrix.score(x, y) as i64;
        }
    }
    (num / pair_count) as i32
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

#[derive(Clone, Copy, PartialEq, Eq)]
enum State {
    M,
    X,
    Y,
}

/// Argmax of the three states with tie order `M > X > Y` (mirrors
/// [`crate::align`], so the 1×1 case traces back identically to `pairwise`).
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

/// One traceback step of a profile–profile alignment.
enum Op {
    /// Column `ai` of A aligned with column `bj` of B.
    Match(usize, usize),
    /// Column `ai` of A vs a fresh gap column in B (consumes A).
    GapB(usize),
    /// A fresh gap column in A vs column `bj` of B (consumes B).
    GapA(usize),
}

/// Profile–profile **global** alignment (Gotoh affine, over columns). Returns the
/// merged profile: A's rows above B's rows, each widened to the alignment, with
/// original indices preserved. A direct generalization of `align::global` with the
/// residue score replaced by [`column_score`].
fn profile_align(
    a: &Profile,
    b: &Profile,
    matrix: &SubstitutionMatrix,
    scoring: Scoring,
) -> Profile {
    let n = a.width;
    let m = b.width;
    let w = m + 1;
    let (go, ge) = (scoring.gap_open, scoring.gap_extend);
    let idx = |i: usize, j: usize| i * w + j;

    let mut mm = vec![NEG; (n + 1) * w];
    let mut xx = vec![NEG; (n + 1) * w]; // A column vs gap (consumes an A column)
    let mut yy = vec![NEG; (n + 1) * w]; // gap vs B column (consumes a B column)

    mm[idx(0, 0)] = 0;
    for i in 1..=n {
        xx[idx(i, 0)] = go + (i as i32 - 1) * ge;
    }
    for j in 1..=m {
        yy[idx(0, j)] = go + (j as i32 - 1) * ge;
    }

    for i in 1..=n {
        for j in 1..=m {
            let s = column_score(&a.cols[i - 1], &b.cols[j - 1], matrix);
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

    // Traceback from the corner, collecting ops in reverse (mirrors align::global).
    let mut state = argmax3(mm[idx(n, m)], xx[idx(n, m)], yy[idx(n, m)]);
    let (mut i, mut j) = (n, m);
    let mut ops: Vec<Op> = Vec::new();
    while i > 0 || j > 0 {
        match state {
            State::M => {
                ops.push(Op::Match(i - 1, j - 1));
                state = argmax3(
                    mm[idx(i - 1, j - 1)],
                    xx[idx(i - 1, j - 1)],
                    yy[idx(i - 1, j - 1)],
                );
                i -= 1;
                j -= 1;
            }
            State::X => {
                ops.push(Op::GapB(i - 1));
                let from_m = mm[idx(i - 1, j)] + go;
                let from_x = xx[idx(i - 1, j)] + ge;
                state = if from_m >= from_x { State::M } else { State::X };
                i -= 1;
            }
            State::Y => {
                ops.push(Op::GapA(j - 1));
                let from_m = mm[idx(i, j - 1)] + go;
                let from_y = yy[idx(i, j - 1)] + ge;
                state = if from_m >= from_y { State::M } else { State::Y };
                j -= 1;
            }
        }
    }
    ops.reverse();

    // Materialize the merged rows: A's rows then B's rows, each of the new width.
    let width = ops.len();
    let mut a_rows: Vec<Vec<u8>> = (0..a.rows.len())
        .map(|_| Vec::with_capacity(width))
        .collect();
    let mut b_rows: Vec<Vec<u8>> = (0..b.rows.len())
        .map(|_| Vec::with_capacity(width))
        .collect();
    for op in &ops {
        match *op {
            Op::Match(ai, bj) => {
                for (r, row) in a.rows.iter().enumerate() {
                    a_rows[r].push(row.gapped[ai]);
                }
                for (r, row) in b.rows.iter().enumerate() {
                    b_rows[r].push(row.gapped[bj]);
                }
            }
            Op::GapB(ai) => {
                for (r, row) in a.rows.iter().enumerate() {
                    a_rows[r].push(row.gapped[ai]);
                }
                for rb in b_rows.iter_mut() {
                    rb.push(b'-');
                }
            }
            Op::GapA(bj) => {
                for ra in a_rows.iter_mut() {
                    ra.push(b'-');
                }
                for (r, row) in b.rows.iter().enumerate() {
                    b_rows[r].push(row.gapped[bj]);
                }
            }
        }
    }

    let mut rows = Vec::with_capacity(a.rows.len() + b.rows.len());
    for (r, row) in a.rows.iter().enumerate() {
        rows.push(Row {
            index: row.index,
            gapped: std::mem::take(&mut a_rows[r]),
        });
    }
    for (r, row) in b.rows.iter().enumerate() {
        rows.push(Row {
            index: row.index,
            gapped: std::mem::take(&mut b_rows[r]),
        });
    }
    let cols = Profile::tally(&rows, width);
    Profile { rows, width, cols }
}

/// A cluster in the UPGMA build: its current profile and the number of leaves it
/// contains (the UPGMA averaging weight).
struct Cluster {
    profile: Profile,
    size: i32,
}

/// Progressively align `seqs` (ungapped, case-preserved residues) into an MSA.
///
/// Returns equal-width gapped rows in input order. `n == 0` ⇒ empty; `n == 1` ⇒
/// the single sequence unchanged. Deterministic: the same input yields
/// byte-identical output.
pub fn progressive_align(
    seqs: &[&[u8]],
    matrix: &SubstitutionMatrix,
    scoring: Scoring,
) -> MsaResult {
    let n = seqs.len();
    if n == 0 {
        return MsaResult {
            rows: Vec::new(),
            length: 0,
        };
    }
    if n == 1 {
        return MsaResult {
            rows: vec![seqs[0].to_vec()],
            length: seqs[0].len(),
        };
    }

    // Cluster ids are stable indices into `clusters`; leaves are 0..n, internal
    // nodes appended after. `dist` is preallocated to the final cluster count
    // (n leaves + n−1 internal = 2n−1) and indexed by cluster id throughout.
    let total = 2 * n - 1;
    let mut clusters: Vec<Option<Cluster>> = Vec::with_capacity(total);
    let mut dist = vec![vec![0.0f64; total]; total];

    for (i, seq) in seqs.iter().enumerate() {
        clusters.push(Some(Cluster {
            profile: Profile::leaf(i, seq),
            size: 1,
        }));
    }
    // Leaf distances: i<j triangle from global %identity, mirrored.
    for i in 0..n {
        for j in (i + 1)..n {
            let r = pairwise(seqs[i], seqs[j], matrix, AlignMode::Global, scoring);
            let d = 1.0 - r.percent_identity as f64 / 100.0;
            dist[i][j] = d;
            dist[j][i] = d;
        }
    }

    // `active` is kept sorted ascending: leaves are in order, and each new cluster
    // id is larger than all existing ones (so `push` keeps it sorted). With the
    // `p < q` scan and strict-`<` replacement, the closest pair ties break to the
    // smallest index pair — fully deterministic.
    let mut active: Vec<usize> = (0..n).collect();
    while active.len() > 1 {
        let mut best = f64::INFINITY;
        let (mut bp, mut bq) = (active[0], active[1]);
        for a_i in 0..active.len() {
            for b_i in (a_i + 1)..active.len() {
                let (p, q) = (active[a_i], active[b_i]);
                if dist[p][q] < best {
                    best = dist[p][q];
                    bp = p;
                    bq = q;
                }
            }
        }

        let ca = clusters[bp].take().expect("active cluster present");
        let cb = clusters[bq].take().expect("active cluster present");
        let new_size = ca.size + cb.size;
        let merged = profile_align(&ca.profile, &cb.profile, matrix, scoring);
        let new_id = clusters.len();

        // UPGMA: distance from the merged cluster to each *remaining* active
        // cluster is the size-weighted mean of its children's distances.
        active.retain(|&id| id != bp && id != bq);
        for &r in &active {
            let d = (ca.size as f64 * dist[bp][r] + cb.size as f64 * dist[bq][r]) / new_size as f64;
            dist[new_id][r] = d;
            dist[r][new_id] = d;
        }

        clusters.push(Some(Cluster {
            profile: merged,
            size: new_size,
        }));
        active.push(new_id);
    }

    let root = clusters[active[0]].take().expect("root cluster present");
    let length = root.profile.width;
    // Emit rows in original input order.
    let mut rows: Vec<Vec<u8>> = vec![Vec::new(); n];
    for row in root.profile.rows {
        rows[row.index] = row.gapped;
    }
    MsaResult { rows, length }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dna() -> SubstitutionMatrix {
        SubstitutionMatrix::match_mismatch(2, -1)
    }
    fn gaps() -> Scoring {
        Scoring {
            gap_open: -5,
            gap_extend: -1,
        }
    }
    fn degap(s: &[u8]) -> Vec<u8> {
        s.iter().copied().filter(|&b| !is_gap(b)).collect()
    }

    /// Every output row, de-gapped, recovers its input sequence; all rows share
    /// one width. The core MSA invariant.
    fn assert_msa(seqs: &[&[u8]], res: &MsaResult) {
        assert_eq!(res.rows.len(), seqs.len(), "row count");
        for (i, row) in res.rows.iter().enumerate() {
            assert_eq!(row.len(), res.length, "row {i} width");
            assert_eq!(degap(row), seqs[i], "row {i} de-gaps to its input");
        }
    }

    #[test]
    fn three_sequences_round_trip() {
        let seqs: Vec<&[u8]> = vec![b"ACGTACGT", b"ACGACGT", b"ACGTAGT"];
        let res = progressive_align(&seqs, &dna(), gaps());
        assert_msa(&seqs, &res);
        assert!(res.length >= 8, "width at least the longest input");
    }

    /// Two singleton profiles must align byte-exactly to `pairwise` global — the
    /// keystone cross-check that pins the DP generalization to the known engine.
    #[test]
    fn pair_matches_pairwise_exactly() {
        let cases: [(&[u8], &[u8]); 3] = [(b"ACGT", b"ACGT"), (b"CGT", b"ACGT"), (b"AAAA", b"AA")];
        for (a, b) in cases {
            let pw = pairwise(a, b, &dna(), AlignMode::Global, gaps());
            let msa = progressive_align(&[a, b], &dna(), gaps());
            assert_eq!(
                msa.rows[0], pw.aligned_a,
                "row 0 vs pairwise a ({a:?},{b:?})"
            );
            assert_eq!(
                msa.rows[1], pw.aligned_b,
                "row 1 vs pairwise b ({a:?},{b:?})"
            );
        }
    }

    #[test]
    fn single_sequence_is_unchanged() {
        let res = progressive_align(&[b"ACGT"], &dna(), gaps());
        assert_eq!(res.rows, vec![b"ACGT".to_vec()]);
        assert_eq!(res.length, 4);
    }

    #[test]
    fn empty_input() {
        let res = progressive_align(&[], &dna(), gaps());
        assert!(res.rows.is_empty());
        assert_eq!(res.length, 0);
    }

    #[test]
    fn identical_sequences_have_no_internal_gaps() {
        let seqs: Vec<&[u8]> = vec![b"ACGTACGT", b"ACGTACGT", b"ACGTACGT"];
        let res = progressive_align(&seqs, &dna(), gaps());
        assert_eq!(res.length, 8, "identical inputs need no gaps");
        for row in &res.rows {
            assert_eq!(row, b"ACGTACGT", "identical rows stay identical, ungapped");
        }
    }

    /// Two identical sequences plus one divergent: the guide tree groups the
    /// identical pair first, so they stay byte-identical in the output.
    #[test]
    fn guide_tree_groups_the_similar_pair() {
        let seqs: Vec<&[u8]> = vec![b"ACGTACGT", b"TTTTTTTT", b"ACGTACGT"];
        let res = progressive_align(&seqs, &dna(), gaps());
        assert_msa(&seqs, &res);
        assert_eq!(
            res.rows[0], res.rows[2],
            "the identical pair aligns identically"
        );
    }

    #[test]
    fn empty_sequence_among_several() {
        let seqs: Vec<&[u8]> = vec![b"ACGT", b"", b"ACGT"];
        let res = progressive_align(&seqs, &dna(), gaps());
        assert_msa(&seqs, &res);
        // The empty row is all gaps at the final width.
        assert!(res.rows[1].iter().all(|&b| is_gap(b)));
    }

    #[test]
    fn deterministic_byte_identical() {
        let seqs: Vec<&[u8]> = vec![b"ACGTACGTAC", b"ACGTTACGTAC", b"AGGTACGAC", b"ACGTACGTAC"];
        let a = progressive_align(&seqs, &dna(), gaps());
        let b = progressive_align(&seqs, &dna(), gaps());
        assert_eq!(a.rows, b.rows, "same input ⇒ byte-identical output");
        assert_eq!(a.length, b.length);
    }

    #[test]
    fn protein_blosum62_round_trips() {
        let matrix = SubstitutionMatrix::blosum62();
        let scoring = Scoring::protein_default();
        let seqs: Vec<&[u8]> = vec![b"HEAGAWGHEE", b"PAWHEAE", b"HEAGAWGHE"];
        let res = progressive_align(&seqs, &matrix, scoring);
        assert_msa(&seqs, &res);
    }
}
