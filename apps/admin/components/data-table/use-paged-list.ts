"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

export type PagedState<B> = { status: "loading" } | { status: "error" } | { status: "ready"; body: B & { total: number } };

// Loads one page of a list from `/api/admin/<module>`; the page number is `?page=` in the address, so Back and refresh keep it.
// The old rows stay (`busy` is true) while the next page loads, so only the first load is empty; a change of filter, sort or column
// search shows the loading rows again, since the old rows are no longer the answer.
export function usePagedList<B>(module: string, params: Record<string, string>) {
  const search = useSearchParams();
  const page = Math.max(1, Number.parseInt(search.get("page") ?? "1", 10) || 1);
  const [state, setState] = useState<PagedState<B>>({ status: "loading" });
  const [busy, setBusy] = useState(true);
  const [tries, setTries] = useState(0);
  // The sort and the per-column searches come from the address, next to the page's own filters.
  const own: Record<string, string> = { ...params };
  for (const [key, value] of search) if (key === "sort" || key === "dir" || key.startsWith("f_")) own[key] = value;
  const filters = JSON.stringify(own);

  const loadedFor = useRef(filters);
  useEffect(() => {
    const filtersChanged = loadedFor.current !== filters;
    loadedFor.current = filters;
    const controller = new AbortController();
    const query = new URLSearchParams({ ...(JSON.parse(filters) as Record<string, string>), page: String(page) });
    setState((s) => (s.status === "ready" && !filtersChanged ? s : { status: "loading" }));
    setBusy(true);
    fetch(`/api/admin/${module}?${query}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        setState({ status: "ready", body: (await res.json()) as B & { total: number } });
        setBusy(false);
      })
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        setState({ status: "error" });
        setBusy(false);
      });
    return () => controller.abort();
  }, [module, filters, page, tries]);

  const goTo = useCallback((next: number) => {
    const url = new URL(window.location.href);
    if (next <= 1) url.searchParams.delete("page");
    else url.searchParams.set("page", String(next));
    window.history.pushState(null, "", url);
  }, []);

  const reload = useCallback(() => setTries((n) => n + 1), []);
  return { state, busy, page, goTo, reload };
}
