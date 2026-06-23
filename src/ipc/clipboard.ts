// Typed clipboard seam. Like `ipc/commands.ts`, the UI never reaches for the
// Tauri plugin directly — it calls these wrappers, so the clipboard binding lives
// in one place. The clipboard-manager plugin's `writeText` calls `invoke` under
// the hood and needs the `clipboard-manager:allow-write-text` capability (see
// `capabilities/default.json`). WRITE ONLY — no read wrapper is exposed (and no
// read permission is granted) until a feature needs paste-from-system-clipboard.

import { writeText } from "@tauri-apps/plugin-clipboard-manager";

/** Write plain text to the system clipboard. */
export async function copyText(text: string): Promise<void> {
  await writeText(text);
}
