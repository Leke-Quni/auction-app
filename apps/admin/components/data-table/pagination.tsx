import { pageCount, pageWindow, PAGE_SIZE } from "./page-window";

const button = "cursor-pointer rounded border border-line bg-panel px-2.5 py-1 hover:bg-page disabled:cursor-default disabled:opacity-50 disabled:hover:bg-panel";

export function Pagination({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  const pages = pageCount(total);
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-muted">
        Showing {from}-{to} of {total}
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" className={button} disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        {pageWindow(page, pages).map((n, i) =>
          n === null ? (
            <span key={`gap${i}`} className="px-1 text-muted" aria-hidden>
              …
            </span>
          ) : (
            <button
              key={n}
              type="button"
              aria-current={n === page ? "page" : undefined}
              className={n === page ? "cursor-default rounded border border-accent bg-accent px-2.5 py-1 font-semibold text-on-brand" : button}
              onClick={() => onPage(n)}
            >
              {n}
            </button>
          ),
        )}
        <button type="button" className={button} disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </nav>
  );
}
