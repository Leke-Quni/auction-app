"use client";

import { useRef } from "react";
import { KEY_STEP } from "./column-widths";

// The divider on a column's right edge (there is none after the last column). Drag it to trade width between the column and the next
// one, or use the left and right arrow keys when it has focus; double-click to give every column its natural width back. It sits in
// the header cell, and reads the widths of the whole header row when a drag starts.
export function ColumnResizer({
  label,
  onBegin,
  onMove,
  onCommit,
  onReset,
}: {
  label: string;
  // Called when a move starts, with every column's width on screen, so the table can freeze them as shares of its width.
  onBegin: (pixels: number[]) => void;
  // How far the divider is from where it started, in pixels (+ is to the right).
  onMove: (deltaPx: number) => void;
  onCommit: () => void;
  onReset: () => void;
}) {
  const drag = useRef<number | null>(null);
  const begin = (el: HTMLElement) => {
    const row = (el.parentElement as HTMLTableCellElement).parentElement as HTMLTableRowElement;
    onBegin([...row.cells].map((cell) => cell.getBoundingClientRect().width));
  };

  // While a divider is held, nothing on the page can be selected (the browser would paint the text blue as the pointer moves).
  const lockSelection = (locked: boolean) => {
    document.body.style.userSelect = locked ? "none" : "";
    document.body.style.cursor = locked ? "col-resize" : "";
  };

  const finish = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current === null) return;
    drag.current = null;
    lockSelection(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    onCommit();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize the ${label} column`}
      title="Drag to resize. Double-click to reset all columns."
      tabIndex={0}
      className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none select-none outline-none"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        begin(e.currentTarget);
        e.currentTarget.setPointerCapture(e.pointerId);
        window.getSelection()?.removeAllRanges();
        lockSelection(true);
        drag.current = e.clientX;
      }}
      onPointerMove={(e) => {
        if (drag.current !== null) onMove(e.clientX - drag.current);
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        begin(e.currentTarget);
        onMove(e.key === "ArrowRight" ? KEY_STEP : -KEY_STEP);
        onCommit();
      }}
    />
  );
}
