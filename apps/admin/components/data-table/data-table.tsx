"use client";

import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { ColumnHeader, type FilterOption, type SortKind, type SortLabels } from "./column-header";
import { ColumnResizer } from "./column-resizer";
import { percent, useColumnWidths } from "./column-widths";
import { pageCount, PAGE_SIZE } from "./page-window";
import { Pagination } from "./pagination";
import { usePagedList } from "./use-paged-list";

export interface Column<T> {
  header: string;
  // The name the API knows the column by: `sort=<key>` and `f_<key>=text`. Without one the column is plain.
  key?: string;
  sortable?: boolean;
  searchable?: boolean;
  // What sorting means for this column: words for text, numbers or dates; `sortLabels` overrides both directions.
  sortKind?: SortKind;
  sortLabels?: SortLabels;
  // List "newest" or "highest" before "oldest" or "lowest".
  descFirst?: boolean;
  // A drop-down of values to show only, in place of the search box (`f_<key>`).
  filterOptions?: FilterOption[];
  // For a searchable column that is not plain text: the placeholder, and a check of what was typed (null = fine, else the reason).
  searchHint?: string;
  validateSearch?: (text: string) => string | null;
  render: (row: T) => ReactNode;
  // Extra classes for this column's cells (`whitespace-nowrap`, a width).
  className?: string;
}

interface Props<T> {
  // Which list to load: `/api/admin/<module>`.
  module: string;
  // The filters from the page's form; the table adds `page`.
  params: Record<string, string>;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  // The field of the response that holds the rows (`users` for `{ total, users }`).
  rowsField: string;
  emptyText: string;
  // Extra classes for each row (`align-top`).
  rowClassName?: string;
}

export function DataTable<T>({ module, params, columns, rowKey, rowsField, emptyText, rowClassName }: Props<T>) {
  const { state, busy, page, goTo, reload } = usePagedList<Record<string, unknown>>(module, params);
  const search = useSearchParams();
  const headers = columns.map((c) => c.header);
  const sizes = useColumnWidths(module, headers);
  const last = columns.length - 1;
  const sort = search.get("sort");
  const dir = search.get("dir") === "desc" ? "desc" : "asc";
  // Any change of sort or search starts again from page 1.
  const change = (patch: Record<string, string | null>) => {
    const url = new URL(window.location.href);
    url.searchParams.delete("page");
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) url.searchParams.delete(k);
      else url.searchParams.set(k, v);
    }
    window.history.pushState(null, "", url);
  };
  const rows = state.status === "ready" ? (state.body[rowsField] as T[]) : [];

  const total = state.status === "ready" ? state.body.total : 0;
  const pages = pageCount(total);

  return (
    // data-fill-page: the console layout stretches this to the bottom of the page, so the page numbers sit there and not against the rows.
    <div data-fill-page className="flex flex-1 flex-col gap-2">
      {sizes.custom && (
        <p className="text-right text-xs">
          <button type="button" onClick={sizes.reset} className="cursor-pointer text-accent underline">
            Reset column widths
          </button>
        </p>
      )}
      <div className="overflow-x-auto">
        <table
          className="w-full border-collapse overflow-hidden rounded border border-line bg-panel text-left"
          style={sizes.custom ? { tableLayout: "fixed", width: "100%" } : undefined}
          aria-busy={busy}
        >
          {sizes.custom && (
            <colgroup>
              {columns.map((c) => (
                <col key={c.header} style={{ width: percent(sizes.widths[c.header]) }} />
              ))}
            </colgroup>
          )}
          <thead className="bg-page text-muted">
            <tr>
              {columns.map((c, i) => (
                <th key={c.header} className={`relative p-2 ${i < last ? "border-r border-line" : ""}`}>
                  <div className={sizes.custom ? "overflow-hidden whitespace-nowrap text-ellipsis" : undefined}>
                  {c.key && (c.sortable || c.searchable || c.filterOptions) ? (
                    <ColumnHeader
                      title={c.header}
                      name={c.key}
                      sortable={!!c.sortable}
                      searchable={!!c.searchable}
                      sort={sort}
                      dir={dir}
                      text={search.get(`f_${c.key}`) ?? ""}
                      kind={c.sortKind}
                      labels={c.sortLabels}
                      descFirst={c.descFirst}
                      options={c.filterOptions}
                      searchHint={c.searchHint}
                      validateSearch={c.validateSearch}
                      onSort={(d) => change(d ? { sort: c.key!, dir: d } : { sort: null, dir: null })}
                      onText={(t) => change({ [`f_${c.key}`]: t || null })}
                    />
                  ) : (
                    c.header
                  )}
                  </div>
                  {i < last && <ColumnResizer label={c.header} onBegin={sizes.begin} onMove={(d) => sizes.move(i, d)} onCommit={sizes.commit} onReset={sizes.reset} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={busy && state.status === "ready" ? "opacity-50 transition-opacity" : undefined}>
            {state.status === "loading" &&
              Array.from({ length: PAGE_SIZE }, (_, i) => (
                <tr key={i} className="border-t border-line" aria-hidden>
                  {columns.map((c) => (
                    <td key={c.header} className="p-2">
                      <div className="h-4 w-3/4 animate-pulse rounded bg-page" />
                    </td>
                  ))}
                </tr>
              ))}
            {state.status === "error" && (
              <tr className="border-t border-line">
                <td colSpan={columns.length} className="p-4 text-danger">
                  Could not load this list.{" "}
                  <button type="button" onClick={reload} className="cursor-pointer text-accent underline">
                    Try again
                  </button>
                </td>
              </tr>
            )}
            {state.status === "ready" && rows.length === 0 && (
              <tr className="border-t border-line">
                <td colSpan={columns.length} className="p-4 text-muted">
                  {emptyText}
                </td>
              </tr>
            )}
            {state.status === "ready" &&
              rows.map((row) => (
                <tr key={rowKey(row)} className={`border-t border-line ${rowClassName ?? ""}`}>
                  {columns.map((c, i) => (
                    <td key={c.header} className={`p-2 ${i < last ? "border-r border-line" : ""} ${sizes.custom ? "overflow-hidden text-ellipsis whitespace-nowrap! [&_*]:whitespace-nowrap!" : ""} ${c.className ?? ""}`}>
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {state.status === "ready" && total > 0 && <Pagination page={Math.min(page, pages)} total={total} onPage={goTo} />}
    </div>
  );
}
