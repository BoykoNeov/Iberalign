import { useState } from "react";
import { parseSummary, type Summary } from "../ipc/commands";
import "./App.css";

// A tiny embedded sample so the M0 IPC round-trip is exercisable without a
// file dialog (that lands in M1). Edit it and re-parse to see the summary
// update straight from the Rust core.
const SAMPLE_FASTA = `>seq1 example
ACGTACGTACGT
>seq2
ACGTTCGTACGT
>seq3
ACGAACGTA-GT
`;

export default function App() {
  const [text, setText] = useState(SAMPLE_FASTA);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onParse() {
    setError(null);
    try {
      const bytes = new TextEncoder().encode(text);
      setSummary(await parseSummary(bytes));
    } catch (e) {
      setSummary(null);
      setError(String(e));
    }
  }

  return (
    <main className="container">
      <h1>Iberalign</h1>
      <p className="subtitle">
        Multiple sequence alignment viewer/editor — M0 scaffold. The summary
        below is computed by the native Rust core over Tauri IPC.
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
      </div>

      {error && <p className="error">Error: {error}</p>}

      {summary && (
        <table className="summary">
          <tbody>
            <tr>
              <th>Sequences</th>
              <td>{summary.count}</td>
            </tr>
            <tr>
              <th>Alphabet</th>
              <td>{summary.alphabet}</td>
            </tr>
            <tr>
              <th>Lengths</th>
              <td>
                {summary.minLen}..{summary.maxLen}
              </td>
            </tr>
            <tr>
              <th>Aligned</th>
              <td>{summary.equalLength ? "yes" : "no"}</td>
            </tr>
          </tbody>
        </table>
      )}
    </main>
  );
}
