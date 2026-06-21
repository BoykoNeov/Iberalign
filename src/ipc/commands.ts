// Typed wrappers over Tauri `invoke` — the single seam between the React UI
// and the native Rust core. UI code calls these functions, never `invoke`
// directly, so command names and payload shapes live in one place.

import { invoke } from "@tauri-apps/api/core";

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
