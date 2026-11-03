const KEY = "recent-searches";
export const RECENT_SEARCHES_MAX = 8;

// The searches this browser made last, newest first. Kept only in this browser; every read and write is guarded because
// storage can be missing, full or blocked (private windows, blocked site data).
export function readRecentSearches(): string[] {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string" && item.trim() !== "").slice(0, RECENT_SEARCHES_MAX) : [];
  } catch {
    return [];
  }
}

function write(list: string[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Not remembering is fine.
  }
}

// Puts a search first; the same text typed in different letter case replaces the older one instead of repeating it.
export function addRecentSearch(text: string): string[] {
  const clean = text.trim();
  if (clean === "") return readRecentSearches();
  const list = [clean, ...readRecentSearches().filter((item) => item.toLowerCase() !== clean.toLowerCase())].slice(0, RECENT_SEARCHES_MAX);
  write(list);
  return list;
}

export function removeRecentSearch(text: string): string[] {
  const list = readRecentSearches().filter((item) => item !== text);
  write(list);
  return list;
}

export function clearRecentSearches(): string[] {
  write([]);
  return [];
}
