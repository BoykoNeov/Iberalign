// Offscreen glyph atlas. At the letter LOD tier the grid draws one residue
// character per visible cell — ~10k+ glyphs per frame. Naive `fillText` per cell
// is the #2 fps killer (after per-frame React state), so instead we pre-render
// every printable residue ONCE into a detached canvas and `drawImage`-blit the
// right tile per cell. Blitting a cached bitmap is far cheaper than shaping text.
//
// Tiles are rendered at a REFERENCE size (max cell × devicePixelRatio) so zoom
// never rebuilds the atlas — `drawImage` just downscales the tile to the current
// cell. The atlas is only rebuilt when the color scheme changes (glyphs are
// re-inked to contrast each residue's fill) or the device pixel ratio changes
// (monitor move) — both coarse events, never per frame.
//
// A detached `<canvas>` (not `OffscreenCanvas`) keeps this portable across the
// system webview without feature-detection.

import type { ColorScheme } from "./colors";
import { MAX_CELL } from "../state/viewport";

// Printable ASCII range covered by the atlas (`!`..`~`). Covers every residue
// letter, ambiguity code, gap glyph and digit; bytes outside this range have no
// glyph and `blit` is a no-op for them.
const FIRST_BYTE = 0x21;
const LAST_BYTE = 0x7e;
const GLYPH_COUNT = LAST_BYTE - FIRST_BYTE + 1;

export class GlyphAtlas {
  /** Device-pixel size of one square tile (and of each cell at max zoom). */
  readonly tilePx: number;
  /** Scheme/dpr this atlas was inked for — see `matches`. */
  private readonly schemeId: string;
  private readonly dpr: number;
  private canvas: HTMLCanvasElement;

  constructor(scheme: ColorScheme, dpr: number, refCellCssPx: number = MAX_CELL) {
    this.schemeId = scheme.id;
    this.dpr = dpr;
    this.tilePx = Math.max(1, Math.ceil(refCellCssPx * dpr));

    const canvas = document.createElement("canvas");
    canvas.width = this.tilePx * GLYPH_COUNT;
    canvas.height = this.tilePx;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("GlyphAtlas: 2D context unavailable");

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Monospace so every tile is centered identically; ~0.78 of the tile leaves
    // a little breathing room and keeps descenders inside the tile.
    ctx.font = `${Math.round(this.tilePx * 0.78)}px ui-monospace, "DejaVu Sans Mono", "Consolas", monospace`;

    const cy = this.tilePx / 2;
    for (let i = 0; i < GLYPH_COUNT; i++) {
      const byte = FIRST_BYTE + i;
      ctx.fillStyle = scheme.inkStyleFor(byte);
      ctx.fillText(String.fromCharCode(byte), i * this.tilePx + this.tilePx / 2, cy);
    }
    this.canvas = canvas;
  }

  /** Whether a byte has a glyph in this atlas (callers skip gaps themselves). */
  has(byte: number): boolean {
    return byte >= FIRST_BYTE && byte <= LAST_BYTE;
  }

  /** True if this atlas was built for `scheme` at `dpr` — else it must be rebuilt. */
  matches(scheme: ColorScheme, dpr: number): boolean {
    return this.schemeId === scheme.id && this.dpr === dpr;
  }

  /**
   * Blit the glyph for `byte` into the destination rect (DEVICE px on the target
   * context). No-op for bytes without a glyph. `drawImage` scales the reference
   * tile down to `dw × dh`.
   */
  blit(
    ctx: CanvasRenderingContext2D,
    byte: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void {
    if (byte < FIRST_BYTE || byte > LAST_BYTE) return;
    const sx = (byte - FIRST_BYTE) * this.tilePx;
    ctx.drawImage(this.canvas, sx, 0, this.tilePx, this.tilePx, dx, dy, dw, dh);
  }

  /** Release the backing bitmap. */
  dispose(): void {
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}
