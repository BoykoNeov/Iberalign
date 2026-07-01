// Component tests for the Colors dialog — the first user of the jsdom + RTL harness
// (the `dom` vitest project). ColorsDialog is presentational: it reports palette
// changes UP through callbacks, so these tests pin the prop→event flow behind the
// custom-colors smoke checklist items that ARE logic (per-residue set/merge/reset,
// Reset-all + link enable/disable, base-scheme change, Esc/backdrop close). They do
// NOT and cannot assert the live canvas repaint / atlas rebuild / letter legibility —
// those need the running Tauri app and a human eye.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import ColorsDialog from "./ColorsDialog";
import {
  getScheme,
  listSchemes,
  DEFAULT_SCHEME_ID,
  NUCLEOTIDE_RESIDUES,
  AMINO_ACID_RESIDUES,
  type PaletteOverrides,
} from "../render/colors";

const SCHEMES = listSchemes();

function renderDialog(over: Partial<React.ComponentProps<typeof ColorsDialog>> = {}) {
  const props = {
    alphabet: "DNA",
    residues: NUCLEOTIDE_RESIDUES,
    base: getScheme(DEFAULT_SCHEME_ID),
    schemes: SCHEMES,
    baseId: DEFAULT_SCHEME_ID,
    onSetBase: vi.fn(),
    overrides: {} as PaletteOverrides,
    onOverrideChange: vi.fn(),
    onResetAll: vi.fn(),
    showLink: true,
    linked: true,
    onToggleLink: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  const utils = render(<ColorsDialog {...props} />);
  return { ...utils, props };
}

// A row keyed by residue letter — the swatch grid uses `aria-label={`Cell color for X`}`.
function cellPicker(ch: string) {
  return screen.getByLabelText(`Cell color for ${ch}`) as HTMLInputElement;
}
function letterPicker(ch: string) {
  return screen.getByLabelText(`Letter color for ${ch}`) as HTMLInputElement;
}
function resetBtn(ch: string) {
  return screen.getByLabelText(`Reset ${ch}`) as HTMLButtonElement;
}

describe("ColorsDialog", () => {
  it("renders a Cell + Letter picker per nucleotide residue", () => {
    renderDialog({ residues: NUCLEOTIDE_RESIDUES });
    for (const ch of NUCLEOTIDE_RESIDUES) {
      expect(cellPicker(ch)).toBeInTheDocument();
      expect(letterPicker(ch)).toBeInTheDocument();
    }
  });

  it("renders all 20 amino acids for a protein file", () => {
    renderDialog({ residues: AMINO_ACID_RESIDUES, alphabet: "Protein", showLink: false });
    for (const ch of AMINO_ACID_RESIDUES) {
      expect(cellPicker(ch)).toBeInTheDocument();
    }
  });

  it("changing a Cell color reports a fill override for that residue", () => {
    const { props } = renderDialog();
    fireEvent.change(cellPicker("A"), { target: { value: "#ff0000" } });
    expect(props.onOverrideChange).toHaveBeenCalledWith("A", { fill: [255, 0, 0] });
  });

  it("changing a Letter color reports an ink override for that residue", () => {
    const { props } = renderDialog();
    fireEvent.change(letterPicker("G"), { target: { value: "#0000ff" } });
    expect(props.onOverrideChange).toHaveBeenCalledWith("G", { ink: [0, 0, 255] });
  });

  it("merges a new part into an existing override (setting ink keeps a custom fill)", () => {
    // A already has a custom fill; changing its letter must preserve the fill.
    // Use a value distinct from the current one (autoInk of a dark fill is white, so
    // "#ffffff" would be a no-op that React's value-tracker suppresses).
    const { props } = renderDialog({ overrides: { A: { fill: [10, 20, 30] } } });
    fireEvent.change(letterPicker("A"), { target: { value: "#010203" } });
    expect(props.onOverrideChange).toHaveBeenCalledWith("A", {
      fill: [10, 20, 30],
      ink: [1, 2, 3],
    });
  });

  it("per-residue reset is disabled until customized, then resets just that residue", () => {
    const { props } = renderDialog({ overrides: { C: { fill: [1, 2, 3] } } });
    // C is customized → enabled; A is not → disabled.
    expect(resetBtn("C")).toBeEnabled();
    expect(resetBtn("A")).toBeDisabled();
    fireEvent.click(resetBtn("C"));
    expect(props.onOverrideChange).toHaveBeenCalledWith("C", null);
  });

  it("Reset all is disabled with no overrides and enabled once any exist", () => {
    const { props, rerender } = renderDialog({ overrides: {} });
    const btn = () => screen.getByRole("button", { name: /reset all/i });
    expect(btn()).toBeDisabled();
    rerender(
      <ColorsDialog
        {...props}
        overrides={{ T: { ink: [9, 9, 9] } }}
      />,
    );
    expect(btn()).toBeEnabled();
    fireEvent.click(btn());
    expect(props.onResetAll).toHaveBeenCalledTimes(1);
  });

  it("shows the Link DNA & RNA toggle for nucleotides and reports toggling", () => {
    const { props } = renderDialog({ showLink: true, linked: true });
    const link = screen.getByRole("checkbox");
    expect(link).toBeChecked();
    fireEvent.click(link);
    expect(props.onToggleLink).toHaveBeenCalledTimes(1);
  });

  it("hides the Link toggle for protein", () => {
    renderDialog({ showLink: false, alphabet: "Protein", residues: AMINO_ACID_RESIDUES });
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("reflects the unlinked state in the toggle label", () => {
    renderDialog({ showLink: true, linked: false });
    expect(screen.getByText("Separate palettes")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("changing the base palette reports onSetBase", () => {
    const { props } = renderDialog();
    const other = SCHEMES.find((s) => s.id !== DEFAULT_SCHEME_ID)!;
    fireEvent.change(screen.getByRole("combobox"), { target: { value: other.id } });
    expect(props.onSetBase).toHaveBeenCalledWith(other.id);
  });

  it("the preview swatch shows the effective fill for an overridden residue", () => {
    renderDialog({ overrides: { A: { fill: [255, 0, 0] } } });
    const preview = screen.getByLabelText("A preview");
    // rgbToHex is lowercase; the browser may serialize to rgb() — accept either.
    const bg = preview.style.background;
    expect(bg === "#ff0000" || bg === "rgb(255, 0, 0)").toBe(true);
  });

  it("Esc closes the dialog", () => {
    const { props } = renderDialog();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking the backdrop closes; clicking inside the card does not", () => {
    const { props } = renderDialog();
    const dialog = screen.getByRole("dialog");
    fireEvent.mouseDown(dialog);
    expect(props.onClose).not.toHaveBeenCalled();
    // The backdrop is the dialog's parent.
    fireEvent.mouseDown(dialog.parentElement as HTMLElement);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("Done closes the dialog", () => {
    const { props } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("scopes reset buttons per residue (no cross-talk)", () => {
    const { props } = renderDialog({ overrides: { A: { fill: [1, 1, 1] }, G: { ink: [2, 2, 2] } } });
    within(screen.getByLabelText("A preview").closest(".col-swatch-row") as HTMLElement);
    fireEvent.click(resetBtn("A"));
    expect(props.onOverrideChange).toHaveBeenCalledWith("A", null);
    expect(props.onOverrideChange).not.toHaveBeenCalledWith("G", null);
  });
});
