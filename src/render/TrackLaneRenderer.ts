// The pinned track lane (chrome between the ruler and the grid). It hosts the
// CONSENSUS row: one IUPAC consensus byte per alignment column, COLUMN-ALIGNED to
// the grid and scroll-synced under it. The consensus is computed over ALL rows
// (Batch 2 is a whole-alignment overview; selection-scoped consensus is Batch 3's
// copy concern), so it is independent of the cursor/selection and never recomputes
// during a drag.
//
// PIXEL ALIGNMENT. The lane shares the grid's `1fr` column, so screen x=0 matches
// the grid and `colToX(vp, col)` put through the grid's `Math.round(x * dpr)` snaps
// each consensus cell dead on its column at every zoom — the same contract the
// ruler uses.
//
// LOD. Like the grid: at the letter tier each cell gets a color fill + the
// consensus glyph (blitted from a `GlyphAtlas`, never `fillText` per cell); at the
// block/density tiers just the color fill (one `fillRect` per visible column), so
// the conserved/variable structure still reads when zoomed out.
//
// CACHE. The consensus array is memoized by view IDENTITY (a new load = a new view
// ⇒ recompute). An in-place edit mutates the buffer without changing the view
// object, so `invalidate()` must be called after an edit (mirrors the renderer's
// occupancy cache + the minimap aggregate).

import type { AlignmentView } from "../model/view";
import { type Dims, type Viewport } from "../state/viewport";
import { colToX, visibleCols } from "./viewport";
import { lodFor } from "./lod";
import { columnConsensus, consensusBytes, type ConsensusConfig } from "../model/consensus";
import { columnProfiles } from "../model/profile";
import { ColumnData } from "../model/columnData";
import { type ColoringConfig, DEFAULT_COLORING } from "../model/coloring";
import { trackFillFor } from "./coloring";
import { GlyphAtlas } from "./glyphs";
import { type ColorScheme, defaultScheme } from "./colors";
import { CHROME } from "./chrome";

// One cell of overscan so a partly-scrolled edge cell is fully drawn.
const OVERSCAN = 1;

export class TrackLaneRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private scheme: ColorScheme;
  private dpr = 1;
  private atlas: GlyphAtlas | null = null;

  // Consensus bytes (length = view.width), memoized by view identity.
  private consView: AlignmentView | null = null;
  private cons: Uint8Array | null = null;
  // The active consensus config. `null` = follow the alphabet default (the
  // back-compat path via `columnConsensus`); a config = the user's Phase-3 dialog
  // choices, applied live. Set by `setConfig`, which invalidates the byte cache.
  private config: ConsensusConfig | null = null;
  // Phase-4 coloring. The shared per-column cache (owned by `Grid`, also fed to the
  // grid renderer) supplies the consensus bytes + the conserved mask the track's
  // consensus-only / nonconsensus-only modes need; the profile is built once. The
  // default `full` track mode colors every cell — byte-identical to the old path.
  private columnData: ColumnData | null;
  private coloring: ColoringConfig = DEFAULT_COLORING;

  constructor(
    canvas: HTMLCanvasElement,
    scheme: ColorScheme = defaultScheme(),
    columnData: ColumnData | null = null,
  ) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("TrackLaneRenderer: 2D context unavailable");
    this.canvas = canvas;
    this.ctx = ctx;
    this.scheme = scheme;
    this.columnData = columnData;
  }

  /** Set the consensus-track coloring mode + its inputs (the conservation
   *  threshold/denominator the conserved mask reads). Live-apply: `Grid` marks the
   *  store dirty after this. The mask lives in the shared `ColumnData` (keyed by
   *  config identity), so nothing local needs invalidating. */
  setColoring(coloring: ColoringConfig): void {
    this.coloring = coloring;
  }

  resize(cssW: number, cssH: number, dpr: number = globalThis.devicePixelRatio || 1): void {
    this.dpr = dpr;
    this.canvas.width = Math.max(0, Math.round(cssW * dpr));
    this.canvas.height = Math.max(0, Math.round(cssH * dpr));
    // dpr change invalidates the atlas (tiles are device-resolution).
    if (this.atlas && !this.atlas.matches(this.scheme, dpr)) {
      this.atlas.dispose();
      this.atlas = null;
    }
  }

  /** Drop the cached consensus after an in-place edit (same view object, mutated
   *  buffer). Call before marking the store dirty, mirroring the renderer's
   *  `invalidateContentCaches` and the minimap's `invalidate`. */
  invalidate(): void {
    this.cons = null;
    this.consView = null;
  }

  /** Set the consensus config and drop the cached bytes so the next draw rederives
   *  under it. `null` = follow the alphabet default. Live-apply: the caller marks
   *  the store dirty after this and the rAF loop repaints — no IPC (consensus is a
   *  derived view; Rust still owns the truth). */
  setConfig(config: ConsensusConfig | null): void {
    this.config = config;
    this.invalidate();
  }

  draw(view: AlignmentView, vp: Viewport): void {
    const { ctx, dpr } = this;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    if (cw === 0 || ch === 0) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = CHROME.bg;
    ctx.fillRect(0, 0, cw, ch);

    // Bottom separator (flush against the grid below), matching the ruler's edge.
    const lw = Math.max(1, Math.round(dpr));
    const sepY = ch - lw;
    ctx.fillStyle = CHROME.line;
    ctx.fillRect(0, sepY, cw, lw);

    if (view.width === 0 || view.numRows === 0) return; // nothing to summarize

    const cons = this.ensureConsensus(view);
    const dims: Dims = { cols: view.width, rows: view.numRows };
    const cols = visibleCols(vp, dims, OVERSCAN);
    if (cols.last < cols.first) return;

    const letters = lodFor(vp.cellW) === "letter";
    const atlas = letters ? this.ensureAtlas() : null;

    // The conserved mask is only needed by the consensus-only / nonconsensus-only
    // modes; fetch it once (shared cache) when they're active, else skip.
    const mode = this.coloring.track;
    const needMask = mode === "consensus-only" || mode === "nonconsensus-only";
    const mask = needMask ? this.ensureConserved(view) : null;

    const h = sepY; // the consensus row fills the lane above the separator
    for (let col = cols.first; col <= cols.last; col++) {
      const xL = Math.round(colToX(vp, col) * dpr);
      const xR = Math.round(colToX(vp, col + 1) * dpr);
      const w = xR - xL;
      if (w <= 0) continue;
      const byte = cons[col];
      // Fill per track mode: `full` colors every cell by its consensus byte
      // (A/C/G/T → vivid base color; ambiguity codes → grey fallback; `-` → gap);
      // `none` is glyph-only; consensus-only / nonconsensus-only color just the
      // conserved / variable columns and leave the rest at the chrome background.
      const conserved = mask ? mask[col] === 1 : false;
      ctx.fillStyle = trackFillFor(mode, this.scheme, CHROME.bg, byte, conserved);
      ctx.fillRect(xL, 0, w, h);
      // Glyph (letter tier): a square tile centered in the cell so the letter is
      // not stretched by the lane's non-square cells (cellW wide × ~18px tall).
      if (atlas) {
        const s = Math.min(w, h);
        const gx = xL + Math.round((w - s) / 2);
        const gy = Math.round((h - s) / 2);
        atlas.blit(ctx, byte, gx, gy, s, s);
      }
    }
  }

  dispose(): void {
    this.atlas?.dispose();
    this.atlas = null;
    this.cons = null;
    this.consView = null;
  }

  private ensureAtlas(): GlyphAtlas {
    if (this.atlas && this.atlas.matches(this.scheme, this.dpr)) return this.atlas;
    this.atlas?.dispose();
    this.atlas = new GlyphAtlas(this.scheme, this.dpr);
    return this.atlas;
  }

  private ensureConsensus(view: AlignmentView): Uint8Array {
    // Shared path: the consensus bytes come from the `ColumnData` cache (keyed by
    // view + consensus-config identity), so the track and grid share the one profile
    // and never compute the bytes twice. `null` config ⇒ the alphabet default.
    if (this.columnData) return this.columnData.consensus(view, this.config);
    // Fallback (constructed without a shared cache): local memo by view identity.
    if (this.consView === view && this.cons) return this.cons;
    this.cons = this.config
      ? consensusBytes(columnProfiles(view, 0, view.numRows - 1), this.config, view.meta.alphabet)
      : columnConsensus(view, 0, view.numRows - 1);
    this.consView = view;
    return this.cons;
  }

  /** The conserved mask for the consensus-only / nonconsensus-only modes, from the
   *  shared cache (keyed by view + coloring-config identity). `null` without a
   *  shared cache — those modes then behave like `none` (mask treated as all-false). */
  private ensureConserved(view: AlignmentView): Uint8Array | null {
    return this.columnData ? this.columnData.conserved(view, this.coloring) : null;
  }
}
