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
  equalLength: boolean;
}

interface SummaryWire {
  count: number;
  alphabet: string;
  min_len: number;
  max_len: number;
  equal_length: boolean;
}

/** Parse FASTA bytes in the Rust core and return a load summary. */
export async function parseSummary(bytes: Uint8Array): Promise<Summary> {
  // Tauri serializes a number[] for `Vec<u8>`; Array.from keeps it explicit.
  const wire = await invoke<SummaryWire>("parse_summary", {
    bytes: Array.from(bytes),
  });
  return {
    count: wire.count,
    alphabet: wire.alphabet,
    minLen: wire.min_len,
    maxLen: wire.max_len,
    equalLength: wire.equal_length,
  };
}
