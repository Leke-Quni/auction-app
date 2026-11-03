import { normalizeQuery } from "./typesense-search-index";
import { LISTING_SYNONYMS, type SynonymGroup } from "./synonyms";

export interface SearchTerm {
  // What was typed: one word, or several when the words together are a synonym phrase such as "board game".
  text: string;
  // Other ways to say it, from the synonym list; matched as whole words.
  alternatives: string[];
}

// Typesense allows 1 typo in words of 4 or more letters and 2 in words of 6 or more (see MIN_LENGTH_FOR_TWO_TYPOS there).
export const typosAllowed = (length: number) => (length >= 6 ? 2 : length >= 4 ? 1 : 0);

// Phrase -> the other phrases it also finds. A two-way group lets every member find every other; a group with a root is
// one-way (the root finds the others, not the reverse), as in Typesense.
export function buildSynonymLookup(groups: SynonymGroup[]) {
  const lookup = new Map<string, Set<string>>();
  const add = (phrase: string, found: string[]) => {
    const set = lookup.get(phrase) ?? new Set<string>();
    for (const item of found) if (item !== phrase) set.add(item);
    lookup.set(phrase, set);
  };
  for (const group of groups) {
    const members = group.synonyms.map((s) => s.toLowerCase());
    if (group.root) add(group.root.toLowerCase(), members);
    else for (const member of members) add(member, members);
  }
  return lookup;
}

const lookup = buildSynonymLookup(LISTING_SYNONYMS);
const longestPhrase = Math.max(...[...lookup.keys()].map((phrase) => phrase.split(" ").length));

// Splits typed text into the terms that must each match. Words that together form a synonym phrase are one term.
export function parseTerms(q: string, synonyms = lookup, maxWords = longestPhrase): SearchTerm[] {
  const words = normalizeQuery(q).toLowerCase().split(/\s+/).filter(Boolean);
  const terms: SearchTerm[] = [];
  for (let i = 0; i < words.length; ) {
    let used = 1;
    let found: Set<string> | undefined;
    for (let length = Math.min(maxWords, words.length - i); length >= 1; length--) {
      const phrase = words.slice(i, i + length).join(" ");
      if (synonyms.has(phrase)) {
        found = synonyms.get(phrase);
        used = length;
        break;
      }
    }
    terms.push({ text: words.slice(i, i + used).join(" "), alternatives: found ? [...found] : [] });
    i += used;
  }
  return terms;
}
