// Typed clipboard seam. Like `ipc/commands.ts`, the UI never reaches for the
// Tauri plugin directly — it calls these wrappers, so the clipboard binding lives
// in one place. The plugin's `writeText`/`readText` call `invoke` under the hood
// and need the `clipboard-manager:allow-write-text` / `:allow-read-text`
// capabilities (see `capabilities/default.json`). Text only — no image clipboard
// wrapper is exposed and no image permission is granted.

import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";

/** Write plain text to the system clipboard. */
export async function copyText(text: string): Promise<void> {
  await writeText(text);
}

/**
 * Read plain text from the system clipboard (paste). Returns `""` when the
 * clipboard holds no text (e.g. an image) on platforms that surface that as a
 * nullish value, so callers can treat empty as "nothing to paste". The read can
 * still reject (permission, platform error) — the caller wraps the call.
 */
export async function readClipboardText(): Promise<string> {
  return (await readText()) ?? "";
}
