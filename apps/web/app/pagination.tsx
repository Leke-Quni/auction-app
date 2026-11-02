import Link from "next/link";

const WINDOW = 10;

export const pageCount = (total: number, pageSize: number) => Math.max(1, Math.ceil(total / pageSize));

// The page numbers to show, like Google: ten in a row that slide along with the current page (five before it).
export function pageNumbers(current: number, pages: number) {
  let start = Math.max(1, current - 5);
  const end = Math.min(pages, start + WINDOW - 1);
  start = Math.max(1, end - WINDOW + 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

const box = "border px-2.5 py-1 text-center";

export function Pagination({ page, pages, hrefFor }: { page: number; pages: number; hrefFor: (page: number) => string }) {
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-center gap-1">
      {page > 1 && (
        <Link href={hrefFor(page - 1)} className={`${box} border-line bg-white text-brand hover:bg-[#f0f0f0]`}>
          Previous
        </Link>
      )}
      {pageNumbers(page, pages).map((n) =>
        n === page ? (
          <span key={n} aria-current="page" className={`${box} border-brand bg-brand font-bold text-white`}>
            {n}
          </span>
        ) : (
          <Link key={n} href={hrefFor(n)} aria-label={`Page ${n}`} className={`${box} border-line bg-white text-brand hover:bg-[#f0f0f0]`}>
            {n}
          </Link>
        ),
      )}
      {page < pages && (
        <Link href={hrefFor(page + 1)} className={`${box} border-line bg-white text-brand hover:bg-[#f0f0f0]`}>
          Next
        </Link>
      )}
    </nav>
  );
}
