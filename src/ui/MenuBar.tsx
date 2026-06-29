// The grid menu bar (Phase 5) — replaces the flat selection-action toolbar with a
// real menu bar: `Edit` / `View` / `Consensus`. The actions and the editing-behavior
// mode toggles (copy format, paste/cut/delete/typing modes) move under `Edit`; the
// presentation choices (color scheme, grid + track coloring, show/hide the consensus
// lane) under `View`; the consensus options dialog under `Consensus`.
//
// MECHANISM. Click a top-level menu to open its dropdown (a fixed panel under the
// button, anchored to its measured rect so it escapes the strip's clip); click the
// button again, click outside the bar, or press Esc to close. Mode groups are
// CLICK-TO-OPEN SUBMENUS — a parent row (`Copy format · Raw ▸`) opens a flyout to its
// right with the radio options; picking one applies it and closes the whole menu.
// Click-driven throughout (no hover fly-outs), so there is no hover-gap/edge-flip
// fragility. The collapsed submenu row shows the CURRENT value, so the active mode
// reads without opening the flyout. An outside-mousedown listener (not an overlay
// backdrop) closes the menu, which keeps the bar buttons directly clickable so the
// user can switch menus in one click.
//
// PRESENTATIONAL: all state (the selection mirror, the chosen modes, the message)
// lives in `Grid`; this renders props and calls handlers. It re-renders only on
// coarse events (a selection-rect change, a toggle, a copy/paste/cut), never per
// frame — the canvas keeps drawing on its own rAF loop.
//
// GLANCE-STATE. A menu hides the active mode behind a click, which would be a real
// safety loss for the DESTRUCTIVE modes (paste insert/overwrite, cut/delete
// shorten/mask). So the strip keeps a compact read-only summary of those, next to
// the selection readout, so the user can see what the next Cut/Paste/Delete will do
// without opening a menu.

import { useEffect, useRef, useState } from "react";
import type { CopyFormat } from "../model/copy";
import type { GridColoring, TrackColoring } from "../model/coloring";
import type { ColorScheme } from "../render/colors";
import "./MenuBar.css";

/** Raw block paste mode: insert (shift columns right) or overwrite cells in place. */
export type PasteMode = "insert" | "overwrite";

/** Cut mode: shorten (delete columns + shift the cut rows left) or mask (clear to
 *  gaps). Default shorten. */
export type CutMode = "shorten" | "mask";

/** Delete-KEY mode (Delete / Backspace): `shorten` (default) structurally removes
 *  — selected sequences (rows) or columns, or shifts a cell block left; `mask`
 *  clears the selected cells to gaps (geometry unchanged — the old behavior).
 *  The explicit Delete sequences / columns items are always structural regardless. */
export type DeleteMode = "shorten" | "mask";

/** Keyboard-ENTRY mode (typing a residue at the cursor): `replace` (default)
 *  overwrites the active cell in place (width preserved); `insert` splices a new
 *  column into the active sequence, pushing its tail right (the alignment grows).
 *  Toggled by the menu or the Insert key. */
export type TypeMode = "replace" | "insert";

// Modifier label for accelerators — ⌘ on macOS, Ctrl elsewhere (win32 here).
const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? "⌘" : "Ctrl";

interface MenuBarProps {
  /** The selection size for the readout, or `null` when nothing is selected. */
  selInfo: { rows: number; cols: number } | null;
  /** The active copy format (the Raw|FASTA submenu). */
  copyFormat: CopyFormat;
  onSetFormat: (format: CopyFormat) => void;
  /** The active raw-paste mode (the Insert|Overwrite submenu). */
  pasteMode: PasteMode;
  onSetPasteMode: (mode: PasteMode) => void;
  /** Insert shift scope: `true` shifts all rows (keeps columns aligned), `false`
   *  (default) shifts only the pasted rows. Only applies in Insert mode. */
  shiftAll: boolean;
  onSetShiftAll: (v: boolean) => void;
  /** The active cut mode (the Shorten|Mask submenu). */
  cutMode: CutMode;
  onSetCutMode: (mode: CutMode) => void;
  /** The active Delete-key mode (the Shorten|Mask submenu for Delete/Backspace). */
  deleteMode: DeleteMode;
  onSetDeleteMode: (mode: DeleteMode) => void;
  /** The active keyboard-entry mode (the Replace|Insert submenu for typing). */
  typeMode: TypeMode;
  onSetTypeMode: (mode: TypeMode) => void;
  /** Delete the selected sequences (rows) — structural, removes them. No-op
   *  upstream when nothing is selected. */
  onDeleteRows: () => void;
  /** Delete the selected columns from every sequence — the alignment narrows. */
  onDeleteColumns: () => void;
  /** Copy the current selection (a no-op upstream when nothing is selected). */
  onCopy: () => void;
  /** Paste the clipboard (FASTA ⇒ new sequences; else a block in the paste mode). */
  onPaste: () => void;
  /** Cut the current selection to the clipboard (no-op upstream when nothing is
   *  selected) — copy then remove, in the cut mode. */
  onCut: () => void;
  /** Pairwise-align the two selected sequences in place (Align → Align selected).
   *  Enabled only when at least two rows are selected; the handler reports the
   *  exact case (2 ⇒ align, 3+ ⇒ "requires MAFFT"). Global (Needleman–Wunsch)
   *  only — end-to-end and lossless; Local (Smith–Waterman) trims to the matched
   *  region, so it's deferred to a non-destructive view in a later milestone. */
  canAlign: boolean;
  onAlign: () => void;
  /** Open the consensus & coloring options modal. */
  onOpenConsensus: () => void;
  /** The selectable color schemes + the active one's id (the View scheme picker). */
  schemes: ColorScheme[];
  schemeId: string;
  onSetScheme: (id: string) => void;
  /** Main-grid coloring mode (View → Grid coloring) — same state the dialog edits. */
  gridColoring: GridColoring;
  onSetGridColoring: (mode: GridColoring) => void;
  /** Consensus-track coloring mode (View → Track coloring). */
  trackColoring: TrackColoring;
  onSetTrackColoring: (mode: TrackColoring) => void;
  /** Whether the consensus lane is shown (View → Show consensus track). */
  trackVisible: boolean;
  onToggleTrack: () => void;
  /** Ephemeral feedback with a tone (`warn` ⇒ bold red, lingers), or `null`. */
  message: { text: string; tone: "info" | "warn" } | null;
  /** Reports whether a dropdown is open, so `Grid` can bail its window keydown while
   *  a menu panel covers the grid (Delete / arrows must not reach the grid behind it). */
  onOpenChange?: (open: boolean) => void;
}

interface RadioOption {
  value: string;
  label: string;
  title?: string;
}

// One row inside a dropdown.
type Item =
  | { kind: "action"; key: string; label: string; accel?: string; disabled?: boolean; onClick: () => void }
  | { kind: "sep"; key: string }
  | { kind: "toggle"; key: string; label: string; checked: boolean; onToggle: () => void }
  | {
      kind: "submenu";
      key: string;
      label: string;
      value: string;
      options: RadioOption[];
      disabled?: boolean;
      onSelect: (v: string) => void;
    };

interface Menu {
  key: string;
  label: string;
  items: Item[];
}

interface Anchor {
  x: number;
  y: number;
}

export default function MenuBar(props: MenuBarProps) {
  const {
    selInfo,
    copyFormat,
    onSetFormat,
    pasteMode,
    onSetPasteMode,
    shiftAll,
    onSetShiftAll,
    cutMode,
    onSetCutMode,
    deleteMode,
    onSetDeleteMode,
    typeMode,
    onSetTypeMode,
    onDeleteRows,
    onDeleteColumns,
    onCopy,
    onPaste,
    onCut,
    canAlign,
    onAlign,
    onOpenConsensus,
    schemes,
    schemeId,
    onSetScheme,
    gridColoring,
    onSetGridColoring,
    trackColoring,
    onSetTrackColoring,
    trackVisible,
    onToggleTrack,
    message,
    onOpenChange,
  } = props;

  const hasSel = selInfo !== null;
  // The open top-level menu (by key) + its anchor (the button's bottom-left), and the
  // open submenu within it (by item key) + its anchor (the parent item's top-right).
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<Anchor>({ x: 0, y: 0 });
  const [openSub, setOpenSub] = useState<string | null>(null);
  const [subAnchor, setSubAnchor] = useState<Anchor>({ x: 0, y: 0 });
  const barRef = useRef<HTMLDivElement | null>(null);

  const closeAll = () => {
    setOpenMenu(null);
    setOpenSub(null);
  };

  // Close on Esc (capture phase, pre-empting the grid's window key handler) or on a
  // mousedown outside the bar. The listeners exist only while a menu is open. A click
  // ON a bar button is inside `barRef`, so it isn't an outside-close — the button's
  // own onClick switches/toggles the menu in one click (no overlay backdrop needed).
  useEffect(() => {
    if (!openMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeAll();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) closeAll();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown, true);
    };
  }, [openMenu]);

  // Tell `Grid` when a dropdown opens/closes so it can gate its window keydown while
  // a panel covers the grid. (A submenu being open implies a top-level menu is open,
  // so `openMenu` alone is the gate.)
  useEffect(() => {
    onOpenChange?.(openMenu !== null);
  }, [openMenu, onOpenChange]);

  const valueLabel = (options: RadioOption[], value: string) =>
    options.find((o) => o.value === value)?.label ?? value;

  // The three menus, built from props each render (cheap — only on coarse events).
  const menus: Menu[] = [
    {
      key: "edit",
      label: "Edit",
      items: [
        { kind: "action", key: "copy", label: "Copy", accel: `${MOD}+C`, disabled: !hasSel, onClick: onCopy },
        { kind: "action", key: "cut", label: "Cut", accel: `${MOD}+X`, disabled: !hasSel, onClick: onCut },
        { kind: "action", key: "paste", label: "Paste", accel: `${MOD}+V`, onClick: onPaste },
        { kind: "sep", key: "s1" },
        { kind: "action", key: "delrows", label: "Delete sequences", disabled: !hasSel, onClick: onDeleteRows },
        { kind: "action", key: "delcols", label: "Delete columns", disabled: !hasSel, onClick: onDeleteColumns },
        { kind: "sep", key: "s2" },
        {
          kind: "submenu",
          key: "copyfmt",
          label: "Copy format",
          value: copyFormat,
          onSelect: (v) => onSetFormat(v as CopyFormat),
          options: [
            { value: "raw", label: "Raw", title: "One sequence per line, no headers" },
            { value: "fasta", label: "FASTA", title: "A >name header before each sequence" },
          ],
        },
        {
          kind: "submenu",
          key: "pastemode",
          label: "Paste mode",
          value: pasteMode,
          onSelect: (v) => onSetPasteMode(v as PasteMode),
          options: [
            { value: "insert", label: "Insert", title: "Insert a pasted block — the alignment grows in width" },
            { value: "overwrite", label: "Overwrite", title: "Overwrite cells in place; grow only past the right edge" },
          ],
        },
        {
          kind: "submenu",
          key: "shift",
          label: "Insert shift",
          value: shiftAll ? "all" : "pasted",
          disabled: pasteMode !== "insert",
          onSelect: (v) => onSetShiftAll(v === "all"),
          options: [
            { value: "pasted", label: "Pasted rows", title: "Shift only the pasted rows right — columns go ragged (Insert only)" },
            { value: "all", label: "All rows", title: "Insert gaps in every row so columns stay aligned (Insert only)" },
          ],
        },
        {
          kind: "submenu",
          key: "cutmode",
          label: "Cut mode",
          value: cutMode,
          onSelect: (v) => onSetCutMode(v as CutMode),
          options: [
            { value: "shorten", label: "Shorten", title: "Delete the cut columns and shift the cut rows left (width kept)" },
            { value: "mask", label: "Mask", title: "Clear the selected cells to gaps (copied first, like Delete)" },
          ],
        },
        {
          kind: "submenu",
          key: "delmode",
          label: "Delete key",
          value: deleteMode,
          onSelect: (v) => onSetDeleteMode(v as DeleteMode),
          options: [
            { value: "shorten", label: "Shorten", title: "Delete removes & shortens — whole rows/cols, or a cell block shifts left" },
            { value: "mask", label: "Mask", title: "Delete clears the cells to gaps — geometry unchanged" },
          ],
        },
        {
          kind: "submenu",
          key: "typemode",
          label: "Typing",
          value: typeMode,
          onSelect: (v) => onSetTypeMode(v as TypeMode),
          options: [
            { value: "replace", label: "Replace", title: "Typing overwrites the cell at the cursor (the Insert key toggles this)" },
            { value: "insert", label: "Insert", title: "Typing splices a new column into the sequence; the alignment grows" },
          ],
        },
      ],
    },
    {
      key: "align",
      label: "Align",
      items: [
        {
          kind: "action",
          key: "alignsel",
          label: "Align selected sequences",
          disabled: !canAlign,
          onClick: onAlign,
        },
      ],
    },
    {
      key: "view",
      label: "View",
      items: [
        {
          kind: "submenu",
          key: "scheme",
          label: "Color scheme",
          value: schemeId,
          onSelect: onSetScheme,
          options: schemes.map((s) => ({ value: s.id, label: s.label })),
        },
        {
          kind: "submenu",
          key: "gridcolor",
          label: "Grid coloring",
          value: gridColoring,
          onSelect: (v) => onSetGridColoring(v as GridColoring),
          options: [
            { value: "by-residue", label: "By residue", title: "The per-residue palette (default)" },
            { value: "by-conservation", label: "Conservation", title: "Keep color in conserved columns; fade the rest" },
            { value: "match-consensus", label: "Match", title: "Highlight cells equal to their column's consensus; fade the rest" },
            { value: "mismatch-consensus", label: "Mismatch", title: "Highlight cells that DIFFER from the consensus; fade the matches" },
          ],
        },
        {
          kind: "submenu",
          key: "trackcolor",
          label: "Track coloring",
          value: trackColoring,
          onSelect: (v) => onSetTrackColoring(v as TrackColoring),
          options: [
            { value: "full", label: "Full", title: "Color every consensus cell by its byte" },
            { value: "none", label: "Glyph only", title: "Draw the consensus letter on a neutral fill (no color)" },
            { value: "consensus-only", label: "Conserved", title: "Color only the conserved columns" },
            { value: "nonconsensus-only", label: "Variable", title: "Color only the variable columns" },
          ],
        },
        { kind: "sep", key: "s1" },
        {
          kind: "toggle",
          key: "showtrack",
          label: "Show consensus track",
          checked: trackVisible,
          onToggle: onToggleTrack,
        },
      ],
    },
    {
      key: "consensus",
      label: "Consensus",
      items: [{ kind: "action", key: "options", label: "Options…", onClick: onOpenConsensus }],
    },
  ];

  // Open/toggle a top-level menu, anchoring its dropdown under the button. Resets any
  // open submenu.
  const toggleMenu = (key: string, e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenuAnchor({ x: r.left, y: r.bottom });
    setOpenSub(null);
    setOpenMenu((cur) => (cur === key ? null : key));
  };

  // Open/toggle a submenu, anchoring its flyout to the right of the parent item.
  const toggleSub = (key: string, e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setSubAnchor({ x: r.right - 3, y: r.top - 4 });
    setOpenSub((cur) => (cur === key ? null : key));
  };

  const runAction = (fn: () => void) => {
    closeAll();
    fn();
  };

  const pickRadio = (onSelect: (v: string) => void, v: string) => {
    closeAll();
    onSelect(v);
  };

  const openMenuDef = menus.find((m) => m.key === openMenu);

  return (
    <div className="grid-menubar" ref={barRef}>
      <div className="menubar-menus" role="menubar" aria-label="Grid menus">
        {menus.map((menu) => (
          <button
            key={menu.key}
            type="button"
            className={openMenu === menu.key ? "menubar-btn open" : "menubar-btn"}
            aria-haspopup="menu"
            aria-expanded={openMenu === menu.key}
            onClick={(e) => toggleMenu(menu.key, e)}
          >
            {menu.label}
          </button>
        ))}
      </div>

      {/* Right side: selection readout, destructive-mode glance-state, message. */}
      <span className="menubar-sel">
        {hasSel ? (
          <>
            <span className="menubar-dim">sel</span> {selInfo.cols} × {selInfo.rows}
          </>
        ) : (
          <span className="menubar-muted">no selection</span>
        )}
      </span>

      <span
        className="menubar-modes"
        title="The active destructive modes — what the next Paste / Cut / Delete will do"
      >
        <span className="menubar-dim">paste</span> {pasteMode === "insert" ? "Insert" : "Overwrite"}
        <span className="menubar-dot">·</span>
        <span className="menubar-dim">cut</span> {cutMode === "shorten" ? "Shorten" : "Mask"}
        <span className="menubar-dot">·</span>
        <span className="menubar-dim">del</span> {deleteMode === "shorten" ? "Shorten" : "Mask"}
      </span>

      {message && (
        <span
          className={message.tone === "warn" ? "menubar-msg warn" : "menubar-msg"}
          aria-live="polite"
        >
          {message.text}
        </span>
      )}

      {/* The open dropdown — fixed at the button's measured rect so it escapes the
          strip's clip. A DOM descendant of the bar, so the outside-mousedown check
          (`barRef.contains`) treats clicks on it as inside. */}
      {openMenuDef && (
        <ul
          className="menubar-dropdown"
          role="menu"
          aria-label={openMenuDef.label}
          style={{ left: menuAnchor.x, top: menuAnchor.y }}
        >
          {openMenuDef.items.map((item) => {
            if (item.kind === "sep") return <li key={item.key} className="menubar-sep" role="separator" />;
            if (item.kind === "action") {
              return (
                <li key={item.key} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    className="menubar-item"
                    disabled={item.disabled}
                    onClick={() => runAction(item.onClick)}
                  >
                    <span className="menubar-item-label">{item.label}</span>
                    {item.accel && <span className="menubar-accel">{item.accel}</span>}
                  </button>
                </li>
              );
            }
            if (item.kind === "toggle") {
              return (
                <li key={item.key} role="none">
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={item.checked}
                    className="menubar-item"
                    onClick={() => runAction(item.onToggle)}
                  >
                    <span className="menubar-check">{item.checked ? "✓" : ""}</span>
                    <span className="menubar-item-label">{item.label}</span>
                  </button>
                </li>
              );
            }
            // submenu parent
            const open = openSub === item.key;
            return (
              <li key={item.key} role="none">
                <button
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={open}
                  className={open ? "menubar-item open" : "menubar-item"}
                  disabled={item.disabled}
                  onClick={(e) => toggleSub(item.key, e)}
                >
                  <span className="menubar-item-label">{item.label}</span>
                  <span className="menubar-subvalue">{valueLabel(item.options, item.value)}</span>
                  <span className="menubar-arrow">▸</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* The open submenu flyout — fixed to the right of its parent item. */}
      {openMenuDef &&
        openSub &&
        (() => {
          const sub = openMenuDef.items.find((i) => i.kind === "submenu" && i.key === openSub);
          if (!sub || sub.kind !== "submenu") return null;
          return (
            <ul
              className="menubar-flyout"
              role="menu"
              aria-label={sub.label}
              style={{ left: subAnchor.x, top: subAnchor.y }}
            >
              {sub.options.map((o) => (
                <li key={o.value} role="none">
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={o.value === sub.value}
                    className="menubar-item"
                    title={o.title}
                    onClick={() => pickRadio(sub.onSelect, o.value)}
                  >
                    <span className="menubar-check">{o.value === sub.value ? "●" : ""}</span>
                    <span className="menubar-item-label">{o.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          );
        })()}
    </div>
  );
}
