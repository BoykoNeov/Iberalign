// `ColumnData` — the shared per-column derived-data cache for the consensus track
// and the main grid. Owned by `Grid`, passed to BOTH renderers, so the per-column
// `ColumnProfiles` is built ONCE per view and the consensus bytes / conserved mask
// are derived once per (view, config) and reused across the two renderers — the
// "one profile, computed once, deriving everything" backbone the roadmap names.
//
// CACHING. Single-slot, keyed by VIEW IDENTITY (a new load = a new view object).
// In-place edits reuse the SAME view object while mutating its buffer (see
// `AlignmentView.resizeContents`/`replaceAll`), so identity-keying cannot detect
// them — the edit path must call `invalidate()` (next to the renderers' own
// invalidations) to drop every cached array. This is deliberately NOT a WeakMap:
// a WeakMap keyed by the (unchanged) view object would silently serve a STALE
// profile after an in-place edit. Single-slot also drops the old view's arrays on
// the next load, the same memory discipline as the renderers' occupancy/trail caches.
//
// CONFIG CASCADE. The config-dependent arrays are additionally keyed by the config
// OBJECT IDENTITY. `Grid` holds each config in React state and replaces the object
// only on a real change, so reference-equality is a correct, allocation-free key:
// a config change ⇒ a new object ⇒ recompute ⇒ no stale grid match-coloring (the
// config→bytes→grid cascade — both renderers read consensus bytes from HERE, so a
// dialog change reaches the grid, not just the track).

import type { AlignmentView } from "./view";
import { columnProfiles, type ColumnProfiles } from "./profile";
import { consensusBytes, defaultConfigFor, type ConsensusConfig } from "./consensus";
import { conservedColumns, type ColoringConfig } from "./coloring";

export class ColumnData {
  // Profile, keyed by view identity.
  private profView: AlignmentView | null = null;
  private prof: ColumnProfiles | null = null;

  // Consensus bytes, keyed by (view, consensus config). The config key is the RAW
  // value passed in — `null` (= alphabet default) is itself a stable key.
  private consView: AlignmentView | null = null;
  private consConfig: ConsensusConfig | null = null;
  private cons: Uint8Array | null = null;

  // Conserved mask, keyed by (view, coloring config).
  private maskView: AlignmentView | null = null;
  private maskColoring: ColoringConfig | null = null;
  private mask: Uint8Array | null = null;

  /** The per-column profile for the WHOLE alignment, built once per view. */
  profiles(view: AlignmentView): ColumnProfiles {
    if (this.profView === view && this.prof) return this.prof;
    this.prof = columnProfiles(view, 0, view.numRows - 1);
    this.profView = view;
    return this.prof;
  }

  /**
   * Consensus bytes under `config` (`null` ⇒ the alphabet default, byte-identical
   * to `columnConsensus`), memoized by (view, config) identity. Reuses the shared
   * profile, so the track and grid never build it twice.
   */
  consensus(view: AlignmentView, config: ConsensusConfig | null): Uint8Array {
    if (this.consView === view && this.consConfig === config && this.cons) return this.cons;
    const alphabet = view.meta.alphabet;
    this.cons = consensusBytes(this.profiles(view), config ?? defaultConfigFor(alphabet), alphabet);
    this.consView = view;
    this.consConfig = config;
    return this.cons;
  }

  /**
   * Per-column "is this column conserved?" mask under `coloring`'s threshold +
   * denominator, memoized by (view, coloring) identity. Reuses the shared profile.
   */
  conserved(view: AlignmentView, coloring: ColoringConfig): Uint8Array {
    if (this.maskView === view && this.maskColoring === coloring && this.mask) return this.mask;
    this.mask = conservedColumns(
      this.profiles(view),
      coloring.conservationThreshold,
      coloring.conservationDenominator,
    );
    this.maskView = view;
    this.maskColoring = coloring;
    return this.mask;
  }

  /**
   * Drop every cached array after an in-place edit (same view object, mutated
   * buffer). Call before marking the store dirty, mirroring the renderers'
   * `invalidateContentCaches` / `track.invalidate` / `minimap.invalidate`.
   */
  invalidate(): void {
    this.profView = null;
    this.prof = null;
    this.consView = null;
    this.consConfig = null;
    this.cons = null;
    this.maskView = null;
    this.maskColoring = null;
    this.mask = null;
  }
}
