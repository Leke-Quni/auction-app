export const PAGE_SIZE = 20;

// The page numbers to show: the first, the last and the ones around the current page, with `null` where pages are skipped.
export function pageWindow(page: number, pages: number): (number | null)[] {
  const wanted = new Set([1, pages, page - 1, page, page + 1]);
  const shown = [...wanted].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  shown.forEach((n, i) => {
    if (i > 0 && n - shown[i - 1] > 1) out.push(n - shown[i - 1] === 2 ? n - 1 : null);
    out.push(n);
  });
  return out;
}

export const pageCount = (total: number) => Math.max(1, Math.ceil(total / PAGE_SIZE));
