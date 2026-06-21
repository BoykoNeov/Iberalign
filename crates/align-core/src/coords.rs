//! Coordinate mapping between ungapped sequence positions and alignment
//! columns. This is the abstraction the spec says to "nail first"; the
//! round-trip invariant is property-tested in `tests/coords_proptest.rs`.

use crate::model::AlignedRow;

/// Characters treated as gaps. Both `-` and `.` are common in the wild.
#[inline]
pub fn is_gap(b: u8) -> bool {
    b == b'-' || b == b'.'
}

impl AlignedRow {
    /// Lazily-built map: column index -> ungapped position, or `-1` at a gap.
    fn col_to_pos_index(&self) -> &[i32] {
        self.col_to_pos.get_or_init(|| {
            let mut out = Vec::with_capacity(self.gapped.len());
            let mut pos: i32 = 0;
            for &b in &self.gapped {
                if is_gap(b) {
                    out.push(-1);
                } else {
                    out.push(pos);
                    pos += 1;
                }
            }
            out
        })
    }

    /// Lazily-built map: ungapped position -> column index.
    fn pos_to_col_index(&self) -> &[u32] {
        self.pos_to_col.get_or_init(|| {
            let mut out = Vec::new();
            for (col, &b) in self.gapped.iter().enumerate() {
                if !is_gap(b) {
                    out.push(col as u32);
                }
            }
            out
        })
    }

    /// Map an alignment column to the ungapped residue position, or `None`
    /// if the column holds a gap for this row.
    pub fn col_to_seq_pos(&self, col: usize) -> Option<usize> {
        match self.col_to_pos_index().get(col) {
            Some(&p) if p >= 0 => Some(p as usize),
            _ => None,
        }
    }

    /// Map an ungapped residue position to its alignment column.
    ///
    /// Returns `None` if `pos` is past the last residue.
    pub fn seq_pos_to_col(&self, pos: usize) -> Option<usize> {
        self.pos_to_col_index().get(pos).map(|&c| c as usize)
    }

    /// Count of non-gap residues in this row.
    pub fn residue_count(&self) -> usize {
        self.pos_to_col_index().len()
    }
}
