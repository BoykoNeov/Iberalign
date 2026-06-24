import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  loadAlignment,
  parseSummary,
  getAlignmentMeta,
  getRenderBuffer,
  type Summary,
} from "../ipc/commands";
import { AlignmentView } from "../model/view";
import Grid from "./Grid";
import "./App.css";

// A tiny embedded sample so the IPC round-trip is exercisable without a file
// dialog. Edit it and parse to see the grid render straight from the Rust core.
const SAMPLE_FASTA = `>seq1 example
ACGTACGTACGT
>seq2
ACGTTCGTACGT
>seq3
ACGAACGTA-GT
`;

export default function App() {
  const [text, setText] = useState(SAMPLE_FASTA);
  // The loaded alignment for the grid. Built ONCE per load (here, in state) — not
  // in render — so the grid's `[view]` effect doesn't re-fire (and reset scroll)
  // on every App re-render. `summary` rides alongside for the status strip.
  const [view, setView] = useState<AlignmentView | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // After a load/parse stashes the dataset in Rust, pull the render metadata +
  // raw buffer and build the view. The `AlignmentView` constructor asserts
  // `buffer.length === width*numRows`, so a transport mismatch throws loud here
  // (caught by the callers) rather than mis-rendering.
  async function showAlignment(loaded: Summary) {
    // Release the previous view BEFORE allocating the next render buffer. At the
    // 10k×10k stress ceiling each buffer is ~100MB of *contiguous* memory; holding
    // the old view's buffer live while `getRenderBuffer` allocates the new one (plus
    // the IPC transport copy) made the WebView2/Chromium renderer fail a contiguous
    // allocation → "Out of Memory" (notably opening a 2nd large file right after an
    // edit). Nulling first lets A's buffer be reclaimed before B's is allocated.
    // Consequence: if the fetch below throws we drop to the open screen rather than
    // keeping A on screen — acceptable, since Rust has already swapped to B by now.
    setView(null);
    setSummary(null);
    const [meta, buffer] = await Promise.all([getAlignmentMeta(), getRenderBuffer()]);
    setView(new AlignmentView(buffer, meta));
    setSummary(loaded);
  }

  async function onParse() {
    setError(null);
    try {
      const bytes = new TextEncoder().encode(text);
      await showAlignment(await parseSummary(bytes));
    } catch (e) {
      setError(String(e));
    }
  }

  async function onOpenFile() {
    setError(null);
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [
          { name: "FASTA", extensions: ["fasta", "fa", "fna", "faa", "fas", "txt"] },
        ],
      });
      // `null` when the user cancels the dialog.
      if (typeof selected === "string") {
        await showAlignment(await loadAlignment(selected));
      }
    } catch (e) {
      setError(String(e));
    }
  }

  /** Return to the open/parse screen (keeps the pasted text). */
  function onClose() {
    setView(null);
    setSummary(null);
  }

  // Loaded: full-viewport shell — header bar + condensed status strip over a
  // flex-1 grid area. The grid area is the definite-height ancestor `Grid`'s
  // `height:100%` resolves against (a viewport-height flex column).
  if (view && summary) {
    return (
      <div className="app-shell">
        <header className="app-header">
          <span className="app-title">Iberalign</span>
          <span className="status-strip">
            {summary.count} sequences · {summary.alphabet} · width {summary.width} ·
            ungapped {summary.minLen}
            {summary.minLen !== summary.maxLen ? `..${summary.maxLen}` : ""}
            {summary.warnings.length > 0
              ? ` · ⚠ ${summary.warnings.length} warning${summary.warnings.length > 1 ? "s" : ""}`
              : ""}
          </span>
          <span className="header-actions">
            <button onClick={onOpenFile}>Open file…</button>
            <button onClick={onClose}>Close</button>
          </span>
        </header>
        <div className="app-grid-area">
          <Grid
            view={view}
            onResized={(width) => setSummary((s) => (s ? { ...s, width } : s))}
          />
        </div>
      </div>
    );
  }

  // Unloaded: the open/parse landing.
  return (
    <main className="container">
      <h1>Iberalign</h1>
      <p className="subtitle">
        Multiple sequence alignment viewer/editor. Open a FASTA file (read by the
        native Rust core), or paste below and parse — both load into the grid.
      </p>

      <textarea
        className="fasta-input"
        value={text}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        rows={10}
      />

      <div className="actions">
        <button onClick={onParse}>Parse FASTA</button>
        <button onClick={onOpenFile}>Open file…</button>
      </div>

      {error && <p className="error">Error: {error}</p>}
    </main>
  );
}
