"use client";

import type { ReactNode } from "react";
import { ColumnResizer } from "./column-resizer";
import { percent, useColumnWidths } from "./column-widths";

// A table with the columns' drag handles, for a page that draws its own rows (the reports queue). `children` is the <tbody>, drawn by
// the page; the header row is made here from `headers`. `id` names the table for remembering the widths in this browser.
export function ResizableTable({ id, headers, children }: { id: string; headers: string[]; children: ReactNode }) {
  const sizes = useColumnWidths(id, headers);
  const last = headers.length - 1;
  return (
    <div className="space-y-2">
      {sizes.custom && (
        <p className="text-right text-xs">
          <button type="button" onClick={sizes.reset} className="cursor-pointer text-accent underline">
            Reset column widths
          </button>
        </p>
      )}
      <div className="overflow-x-auto">
        <table
          className={`w-full border-collapse overflow-hidden rounded border border-line bg-panel text-left [&_td:not(:last-child)]:border-r [&_td:not(:last-child)]:border-line ${sizes.custom ? "[&_td]:overflow-hidden [&_td]:text-ellipsis [&_td]:whitespace-nowrap! [&_td_*]:whitespace-nowrap!" : ""}`}
          style={sizes.custom ? { tableLayout: "fixed", width: "100%" } : undefined}
        >
          {sizes.custom && (
            <colgroup>
              {headers.map((h) => (
                <col key={h} style={{ width: percent(sizes.widths[h]) }} />
              ))}
            </colgroup>
          )}
          <thead className="bg-page text-muted">
            <tr>
              {headers.map((h, i) => (
                <th key={h} className={`relative p-2 ${i < last ? "border-r border-line" : ""}`}>
                  <div className={sizes.custom ? "overflow-hidden whitespace-nowrap text-ellipsis" : undefined}>{h}</div>
                  {i < last && <ColumnResizer label={h} onBegin={sizes.begin} onMove={(d) => sizes.move(i, d)} onCommit={sizes.commit} onReset={sizes.reset} />}
                </th>
              ))}
            </tr>
          </thead>
          {children}
        </table>
      </div>
    </div>
  );
}
