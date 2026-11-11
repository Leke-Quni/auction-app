"use client";

import Form from "next/form";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { SUGGESTION_MIN_LENGTH } from "@auction/shared";
import { addRecentSearch, clearRecentSearches, readRecentSearches, removeRecentSearch } from "@/lib/recent-searches";
import { activeFilterChips, carriedFilters } from "./search/active-filters";
import { readSearchParams, recordFromSearchParams } from "./search/search-params";
import { useDismiss } from "./use-dismiss";

const SUGGEST_DELAY_MS = 200;
const AUTH_PATHS = ["/sign-in", "/sign-up", "/forgot-password", "/reset-password"];
const isAuthPath = (pathname: string) => AUTH_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));

// The header search. It is left out of the sign-in, sign-up and password pages. On the search page it shows the current text, keeps the chosen filters when searching again,
// and lists them as chips that each remove one filter.
export function SearchBox({ categories }: { categories: { slug: string; name: string }[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Worked out again only when the address or the categories change, not on every key typed in the box.
  const params = useMemo(() => (pathname === "/search" ? readSearchParams(recordFromSearchParams(searchParams)) : {}), [pathname, searchParams]);
  const chips = useMemo(() => activeFilterChips(params, categories), [params, categories]);

  // The header grows when the chips wrap onto a second line; the fixed sidebar on the search page reads its height from here.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const header = box.current?.closest("header");
    if (!header || typeof ResizeObserver === "undefined") return;
    const publish = () => document.documentElement.style.setProperty("--header-height", `${header.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  // Under the box while it is focused: the earlier searches made in this browser when it is empty, and titles that match
  // what is typed so far once there is some text.
  const [text, setText] = useState(params.q ?? "");
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [active, setActive] = useState(-1);
  useEffect(() => {
    setText(params.q ?? "");
    setOpen(false);
  }, [params.q]);
  useDismiss(box, open, () => setOpen(false));
  const typed = text.trim();
  // The highlight starts over whenever the list changes or closes.
  const listKey = `${open}|${typed === ""}|${suggestions.join("\n")}|${recent.join("\n")}`;
  useEffect(() => setActive(-1), [listKey]);
  // Asks for suggestions a moment after typing stops, and drops an answer that is no longer for what is in the box.
  useEffect(() => {
    if (!open || typed.length < SUGGESTION_MIN_LENGTH) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(typed)}`, { signal: controller.signal });
        const body = res.ok ? await res.json() : null;
        setSuggestions(Array.isArray(body?.suggestions) ? body.suggestions : []);
      } catch {
        // A failed or cancelled request just means no suggestions.
      }
    }, SUGGEST_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, typed]);

  if (isAuthPath(pathname)) return null;

  // Searching with nothing typed and no filter chosen has nothing to look for, so it stays where it is.
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    const text = String(new FormData(event.currentTarget).get("q") ?? "").trim();
    if (text === "" && carriedFilters(params).length === 0) {
      event.preventDefault();
      return;
    }
    addRecentSearch(text);
    setOpen(false);
  };
  const chooseSuggestion = (title: string) => {
    addRecentSearch(title);
    setText(title);
    setOpen(false);
  };
  const showRecent = open && typed === "" && recent.length > 0;
  const showSuggestions = open && typed.length >= SUGGESTION_MIN_LENGTH && suggestions.length > 0;
  const choices = showRecent ? recent : showSuggestions ? suggestions : [];
  const choose = (title: string) => {
    chooseSuggestion(title);
    router.push(`/search?q=${encodeURIComponent(title)}`);
  };
  // Up and down move through the list, Enter searches the highlighted one; without a highlight Enter searches the text.
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") return;
    if (event.key === "Enter") {
      if (active < 0 || !choices[active]) return;
      event.preventDefault();
      choose(choices[active]);
      return;
    }
    event.preventDefault();
    if (!open) {
      setRecent(readRecentSearches());
      setOpen(true);
      return;
    }
    if (choices.length === 0) return;
    const step = event.key === "ArrowDown" ? 1 : -1;
    setActive((current) => (current < 0 ? (step === 1 ? 0 : choices.length - 1) : (current + step + choices.length) % choices.length));
  };

  return (
    <div ref={box} className="order-last flex min-w-0 basis-full flex-col gap-1 sm:order-none sm:w-full sm:flex-1 sm:basis-auto">
      <Form action="/search" onSubmit={submit} className="relative flex">
        {carriedFilters(params).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <input
          key={params.q ?? ""}
          name="q"
          type="search"
          aria-label="Search auctions"
          placeholder="Search auctions…"
          maxLength={100}
          defaultValue={params.q}
          autoComplete="off"
          role="combobox"
          aria-expanded={showRecent || showSuggestions}
          aria-controls="search-choices"
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `search-choice-${active}` : undefined}
          onKeyDown={onKeyDown}
          onFocus={(e) => {
            setText(e.currentTarget.value);
            setRecent(readRecentSearches());
            setOpen(true);
          }}
          onChange={(e) => {
            setText(e.currentTarget.value);
            setOpen(true);
          }}
          className="w-full rounded-l-full border border-line bg-chip py-1.5 pl-4 pr-2 text-sm text-ink"
        />
        <button type="submit" className="cursor-pointer rounded-r-full border border-brand bg-brand px-4 py-1.5 text-sm font-bold text-on-brand hover:bg-brand-dark">
          Search
        </button>
        {showRecent && (
          <div className="absolute left-0 top-full z-20 mt-1 w-full border border-line-soft bg-surface text-sm text-subtle shadow-sm">
            <div className="flex items-center justify-between px-3 py-1.5 text-xs text-faint">
              <span>Recent searches</span>
              <button type="button" onClick={() => (setRecent(clearRecentSearches()), setOpen(false))} className="cursor-pointer underline">
                Clear
              </button>
            </div>
            <ul role="listbox" id="search-choices" aria-label="Recent searches">
              {recent.map((item, index) => (
                <li key={item} id={`search-choice-${index}`} role="option" aria-selected={active === index} className={`flex items-center hover:bg-soft ${active === index ? "bg-chip" : ""}`}>
                  <Link
                    href={`/search?q=${encodeURIComponent(item)}`}
                    onClick={() => chooseSuggestion(item)}
                    className="min-w-0 flex-1 truncate px-3 py-1.5"
                  >
                    {item}
                  </Link>
                  <button
                    type="button"
                    aria-label={`Forget ${item}`}
                    onClick={() => {
                      const list = removeRecentSearch(item);
                      setRecent(list);
                      if (list.length === 0) setOpen(false);
                    }}
                    className="cursor-pointer px-3 py-1.5 text-placeholder hover:text-subtle"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {showSuggestions && (
          <div className="absolute left-0 top-full z-20 mt-1 w-full border border-line-soft bg-surface text-sm text-subtle shadow-sm">
            <p className="px-3 py-1.5 text-xs text-faint">Suggestions</p>
            <ul role="listbox" id="search-choices" aria-label="Suggestions">
              {suggestions.map((title, index) => (
                <li key={title} id={`search-choice-${index}`} role="option" aria-selected={active === index} className={`hover:bg-soft ${active === index ? "bg-chip" : ""}`}>
                  <Link href={`/search?q=${encodeURIComponent(title)}`} onClick={() => chooseSuggestion(title)} className="block truncate px-3 py-1.5">
                    {title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Form>
      {chips.length > 0 && (
        <ul aria-label="Active filters" className="flex flex-wrap gap-1">
          {chips.map((chip) => (
            <li key={chip.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-chip px-2 py-0.5 text-xs text-ink">
              {chip.label}
              <Link href={chip.href} aria-label={`Remove filter: ${chip.label}`} className="font-bold leading-none">
                ×
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
