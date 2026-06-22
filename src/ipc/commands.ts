// Typed wrappers over Tauri `invoke` — the single seam between the React UI
// and the native Rust core. UI code calls these functions, never `invoke`
// directly, so command names and payload shapes live in one place.

import { invoke } from "@tauri-apps/api/core";
import type { AlignmentMeta } from "../model/types";

export type { AlignmentMeta };

/** Mirror of the Rust `SummaryDto` returned by `parse_summary`. */
export interface Summary {
  count: number;
  alphabet: string;
  minLen: number;
  maxLen: number;
  /** Aligned width (max gapped length). */
  width: number;
  /**
   * True if every sequence already shares one gapped width (a rectangular
   * matrix). Necessary but not sufficient for a real alignment — gap-padded
   * sequences pass too. Shown as "Equal width", not "Aligned".
   */
  equalWidth: boolean;
  /** Non-fatal parse warnings (duplicate names, skipped empty records, …). */
  warnings: string[];
}

interface SummaryWire {
  count: number;
  alphabet: string;
  min_len: number;
  max_len: number;
  width: number;
  equal_width: boolean;
  warnings: string[];
}

function fromWire(wire: SummaryWire): Summary {
  return {
    count: wire.count,
    alphabet: wire.alphabet,
    minLen: wire.min_len,
    maxLen: wire.max_len,
    width: wire.width,
    equalWidth: wire.equal_width,
    warnings: wire.warnings,
  };
}

/** Parse FASTA bytes in the Rust core and return a load summary. */
export async function parseSummary(bytes: Uint8Array): Promise<Summary> {
  // Tauri serializes a number[] for `Vec<u8>`; Array.from keeps it explicit.
  const wire = await invoke<SummaryWire>("parse_summary", {
    bytes: Array.from(bytes),
  });
  return fromWire(wire);
}

/**
 * Load a FASTA file by path and return a load summary. Rust reads the file
 * itself — only the path crosses IPC, not the bytes. Obtain `path` from the
 * native dialog (`@tauri-apps/plugin-dialog`).
 */
export async function loadAlignment(path: string): Promise<Summary> {
  const wire = await invoke<SummaryWire>("load_alignment", { path });
  return fromWire(wire);
}

interface AlignmentMetaWire {
  width: number;
  num_rows: number;
  names: string[];
  alphabet: string;
}

/**
 * Fetch render metadata (dimensions, row names, alphabet) for the currently
 * loaded alignment. Small JSON; call once per load alongside
 * {@link getRenderBuffer}.
 */
export async function getAlignmentMeta(): Promise<AlignmentMeta> {
  const wire = await invoke<AlignmentMetaWire>("get_alignment_meta");
  return {
    width: wire.width,
    numRows: wire.num_rows,
    names: wire.names,
    alphabet: wire.alphabet,
  };
}

/**
 * Fetch the flat gapped render buffer — a row-major `width × numRows` byte
 * matrix (row `r` is bytes `[r*width, (r+1)*width)`). The command returns raw
 * bytes, so `invoke` yields an `ArrayBuffer` (NOT a JSON `number[]`); we wrap it
 * in a `Uint8Array`. Call once per load; never per frame.
 */
export async function getRenderBuffer(): Promise<Uint8Array> {
  const buf = await invoke<ArrayBuffer>("get_render_buffer");
  return new Uint8Array(buf);
}
