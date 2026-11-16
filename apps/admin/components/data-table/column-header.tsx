"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type SortKind = "text" | "number" | "date";
export type SortLabels = { asc: string; desc: string };
export interface FilterOption {
  value: string;
  label: string;
}
const KIND_LABELS: Record<SortKind, SortLabels> = {
  text: { asc: "A to Z", desc: "Z to A" },
  number: { asc: "Lowest first", desc: "Highest first" },
  date: { asc: "Oldest first", desc: "Newest first" },
};

const MENU_WIDTH = 224;

// A drop-down made of buttons: the current choice, and the list below it once opened.
function Choice({
  caption,
  current,
  options,
  onPick,
}: {
  caption: string;
  current: string;
  options: { value: string; label: string }[];
  onPick: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <p className="px-1 pb-1 text-xs text-muted">{caption}</p>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-center justify-between gap-2 rounded border border-line bg-panel px-2 py-1 text-left hover:bg-page"
      >
        <span>{options.find((o) => o.value === current)?.label}</span>
        <span aria-hidden className="text-xs text-muted">
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label={caption}
          className="mt-1 overflow-hidden rounded border border-line bg-panel"
        >
          {options.map((o) => (
            <li key={o.value} role="option" aria-selected={o.value === current}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onPick(o.value);
                }}
                className={`flex w-full cursor-pointer items-center justify-between px-2 py-1 text-left hover:bg-page ${o.value === current ? "font-semibold text-accent" : ""}`}
              >
                {o.label}
                {o.value === current && <span aria-hidden>✓</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// A column title that opens a small menu: search inside the column (or show only some of its values) and sort by it. The state is
// `sort`, `dir` and `f_<key>` in the address, so Back and refresh keep it; changing any of them returns to page 1. The menu is
// fixed to the window, so the table's scroll area never cuts it off.
export function ColumnHeader({
  title,
  name,
  sortable,
  searchable,
  sort,
  dir,
  text,
  kind = "text",
  labels,
  descFirst,
  options,
  searchHint,
  validateSearch,
  onSort,
  onText,
}: {
  title: string;
  name: string;
  sortable: boolean;
  searchable: boolean;
  sort: string | null;
  dir: "asc" | "desc";
  text: string;
  kind?: SortKind;
  // Wording for the two directions when the kind's words do not fit (a price: "Most expensive to cheapest").
  labels?: SortLabels;
  // List the descending choice before the ascending one.
  descFirst?: boolean;
  // Instead of a search box, a drop-down of the values to show only (the value is `f_<key>`).
  options?: FilterOption[];
  // What the search box expects, shown as its placeholder and under it when the text is refused.
  searchHint?: string;
  // Returns null when the typed text is acceptable, or the reason it is not; a refused text is never applied.
  validateSearch?: (text: string) => string | null;
  onSort: (dir: "asc" | "desc" | null) => void;
  onText: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(text);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState({ top: 0, left: 0 });
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const sorted = sort === name;
  const words = labels ?? KIND_LABELS[kind];
  useEffect(() => {
    setDraft(text);
    setError(null);
  }, [text]);
  // The menu stays with its title when the page or the table scrolls; it closes only on a click outside, Escape or a pick.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!button.current) return;
      const r = button.current.getBoundingClientRect();
      // In page coordinates, so the page's own scrolling carries the menu with its title; only the table's sideways scroll needs a move.
      setAt({
        top: r.bottom + window.scrollY + 4,
        left:
          Math.max(8, Math.min(r.left, window.innerWidth - MENU_WIDTH - 8)) +
          window.scrollX,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const away = (e: MouseEvent) =>
      !root.current?.contains(e.target as Node) &&
      !menu.current?.contains(e.target as Node) &&
      close();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const sortOptions = [
    { value: "", label: "Default order" },
    ...(descFirst
      ? [
          { value: "desc", label: words.desc },
          { value: "asc", label: words.asc },
        ]
      : [
          { value: "asc", label: words.asc },
          { value: "desc", label: words.desc },
        ]),
  ];

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        className="flex cursor-pointer items-center gap-1 font-bold hover:text-accent"
      >
        {title}
        {sorted && (
          <span
            aria-label={
              dir === "asc" ? "sorted ascending" : "sorted descending"
            }
          >
            {dir === "asc" ? "▲" : "▼"}
          </span>
        )}
        {text && (
          <span
            className="rounded bg-accent px-1 text-xs text-on-brand"
            title={
              options
                ? `Showing only ${options.find((o) => o.value === text)?.label ?? text}`
                : `Searching for "${text}"`
            }
          >
            ●
          </span>
        )}
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            style={{
              position: "absolute",
              top: at.top,
              left: at.left,
              width: MENU_WIDTH,
            }}
            className="z-20 space-y-2 rounded border border-line bg-panel p-2 font-normal text-text shadow-lg"
          >
            {options ? (
              <Choice
                caption={`Show only ${title.toLowerCase()}`}
                current={text}
                options={[{ value: "", label: "All" }, ...options]}
                onPick={(v) => {
                  onText(v);
                  setOpen(false);
                }}
              />
            ) : (
              searchable && (
                <form
                  className="flex gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const value = draft.trim();
                    const problem =
                      value && validateSearch ? validateSearch(value) : null;
                    if (problem) return setError(problem);
                    onText(value);
                    setOpen(false);
                  }}
                >
                  <input
                    autoFocus
                    value={draft}
                    maxLength={100}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      setError(null);
                    }}
                    placeholder={searchHint ?? `Search ${title.toLowerCase()}`}
                    aria-label={`Search ${title}`}
                    aria-invalid={error !== null}
                    aria-describedby={
                      error ? `${name}-search-error` : undefined
                    }
                    className={`min-w-0 flex-1 rounded border bg-panel px-2 py-1 ${error ? "border-danger" : "border-line"}`}
                  />
                  {text && (
                    <button
                      type="button"
                      className="cursor-pointer rounded border border-line px-2 py-1"
                      onClick={() => {
                        onText("");
                        setOpen(false);
                      }}
                    >
                      Clear
                    </button>
                  )}
                </form>
              )
            )}
            {error && (
              <p
                id={`${name}-search-error`}
                role="alert"
                className="text-xs text-danger"
              >
                {error}
              </p>
            )}
            {sortable && (
              <Choice
                caption={`Sort by ${title.toLowerCase()}`}
                current={sorted ? dir : ""}
                options={sortOptions}
                onPick={(v) => {
                  onSort(v === "" ? null : (v as "asc" | "desc"));
                  setOpen(false);
                }}
              />
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
