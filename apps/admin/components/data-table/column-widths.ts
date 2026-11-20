import { useEffect, useRef, useState } from "react";

// The narrowest a column can be dragged to, in pixels.
export const MIN_COLUMN_PX = 80;
// How far an arrow key moves a divider.
export const KEY_STEP = 10;

// Each column's share of the table's width, by its header; the shares add up to 1, so the table always fits the page.
export type Widths = Record<string, number>;

// The divider after column `index` moves by `delta` (a share of the table's width, + is to the right): that column grows and the next
// one shrinks by the same amount, so the table stays the same width and every other column keeps its width. The move stops when either
// of the two would go below `min`; a column already narrower than that (a very narrow window) can only grow.
export function moveDivider(shares: number[], index: number, delta: number, min: number): number[] {
  if (index < 0 || index >= shares.length - 1) return shares;
  const room = (share: number) => Math.max(0, share - min);
  const moved = Math.min(room(shares[index + 1]!), Math.max(-room(shares[index]!), delta));
  return shares.map((share, i) => (i === index ? share + moved : i === index + 1 ? share - moved : share));
}

// What was saved for a table. It counts only when every column has a share and they add up to 1: the table is laid out with fixed
// widths for all of them at once, so a table whose columns have changed since goes back to its natural widths.
export function readWidths(raw: string | null, headers: string[]): Widths {
  try {
    const data: unknown = JSON.parse(raw ?? "null");
    if (!data || typeof data !== "object" || headers.length < 2) return {};
    const widths: Widths = {};
    let sum = 0;
    for (const header of headers) {
      const value = (data as Record<string, unknown>)[header];
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value >= 1) return {};
      widths[header] = value;
      sum += value;
    }
    return Math.abs(sum - 1) < 0.01 ? widths : {};
  } catch {
    return {};
  }
}

export const toShares = (pixels: number[]): number[] => {
  const total = pixels.reduce((sum, px) => sum + px, 0);
  return total > 0 ? pixels.map((px) => px / total) : pixels.map(() => 1 / pixels.length);
};

// The column widths a person has dragged a table to, kept in this browser for each table. Until a divider is dragged there are none and
// the table lays itself out as before. The first drag freezes every column at the share it has on screen (`begin`), so nothing jumps.
export function useColumnWidths(table: string, headers: string[]) {
  const key = `admin-column-widths-v2:${table}`;
  const headerKey = headers.join("\n");
  const [widths, setWidths] = useState<Widths>({});
  const latest = useRef<Widths>({});
  // The shares and the table's width when the current drag started; a drag is measured from there, not step by step.
  const start = useRef<{ shares: number[]; tablePx: number }>({ shares: [], tablePx: 0 });
  const apply = (next: Widths) => {
    latest.current = next;
    setWidths(next);
  };
  const list = headerKey ? headerKey.split("\n") : [];

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(key);
    } catch {
      // No storage: the widths last for this visit only.
    }
    const next = readWidths(saved, headerKey ? headerKey.split("\n") : []);
    latest.current = next;
    setWidths(next);
  }, [key, headerKey]);

  return {
    widths,
    custom: Object.keys(widths).length > 0,
    // `measured` is every column's width on screen now, in pixels. They become the starting shares when none are set yet.
    begin(measured: number[]) {
      const tablePx = measured.reduce((sum, px) => sum + px, 0);
      if (Object.keys(latest.current).length === 0) apply(Object.fromEntries(list.map((h, i) => [h, toShares(measured)[i]!])));
      start.current = { shares: list.map((h) => latest.current[h] ?? 0), tablePx };
    },
    // Drags the divider after column `index` to `deltaPx` from where the drag began.
    move(index: number, deltaPx: number) {
      const { shares, tablePx } = start.current;
      if (tablePx <= 0 || shares.length !== list.length) return;
      const next = moveDivider(shares, index, deltaPx / tablePx, MIN_COLUMN_PX / tablePx);
      apply(Object.fromEntries(list.map((h, i) => [h, next[i]!])));
    },
    commit() {
      try {
        localStorage.setItem(key, JSON.stringify(latest.current));
      } catch {
        // Not saved; still applied.
      }
    },
    reset() {
      apply({});
      try {
        localStorage.removeItem(key);
      } catch {
        // Nothing saved to remove.
      }
    },
  };
}

export const percent = (share: number | undefined) => `${((share ?? 0) * 100).toFixed(3)}%`;
