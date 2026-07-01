// Component tests for the translation result modal (the `dom` vitest project).
// TranslateDialog is presentational — `Grid` runs the `translate_block` IPC and hands
// finished rows in; these pin the read-only display + close paths (header badge,
// context line, per-row name + sequence, Esc / backdrop / Done close). The live IPC
// wiring + the alphabet gate live in Grid and are GUI-smoke territory.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TranslateDialog from "./TranslateDialog";

function renderDialog(over: Partial<React.ComponentProps<typeof TranslateDialog>> = {}) {
  const props = {
    mode: "degap" as const,
    cols: [0, 11] as [number, number],
    rows: [
      { name: "seq1", seq: "MKV" },
      { name: "seq2", seq: "MK-" },
    ],
    onClose: vi.fn(),
    ...over,
  };
  const utils = render(<TranslateDialog {...props} />);
  return { ...utils, props };
}

describe("TranslateDialog", () => {
  it("renders a row per translated sequence with its name and residues", () => {
    renderDialog();
    expect(screen.getByText("seq1")).toBeInTheDocument();
    expect(screen.getByText("MKV")).toBeInTheDocument();
    expect(screen.getByText("seq2")).toBeInTheDocument();
    expect(screen.getByText("MK-")).toBeInTheDocument();
  });

  it("shows the gap-mode badge (Degap vs Codon)", () => {
    const { rerender, props } = renderDialog({ mode: "degap" });
    expect(screen.getByText("Degap → translate")).toBeInTheDocument();
    rerender(<TranslateDialog {...props} mode="codon" />);
    expect(screen.getByText("Codon-through")).toBeInTheDocument();
  });

  it("shows the 1-based column window and sequence count in the context line", () => {
    renderDialog({ cols: [2, 10], rows: [{ name: "a", seq: "MM" }] });
    // cols 2..10 (0-based) → 3–11 (1-based); one sequence (singular).
    expect(screen.getByText(/cols 3–11/)).toBeInTheDocument();
    expect(screen.getByText(/1 sequence(?!s)/)).toBeInTheDocument();
  });

  it("marks an unnamed sequence", () => {
    renderDialog({ rows: [{ name: "", seq: "M" }] });
    expect(screen.getByText("(unnamed)")).toBeInTheDocument();
  });

  it("Esc closes the dialog", () => {
    const { props } = renderDialog();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("Done closes the dialog", () => {
    const { props } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking the backdrop closes; clicking inside the card does not", () => {
    const { props } = renderDialog();
    const dialog = screen.getByRole("dialog");
    fireEvent.mouseDown(dialog);
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(dialog.parentElement as HTMLElement);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
