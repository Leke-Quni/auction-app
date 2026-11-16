import { describe, expect, it, vi } from "vitest";

// The question log page pulls in its remove action, which reaches for the API client.
vi.mock("@/lib/api", () => ({ adminApiFetch: vi.fn() }));
vi.mock("@/lib/require-admin", () => ({ requireAdmin: async () => ({ id: "a1", email: "a@x.co", isSuperAdmin: false }) }));

import Listings from "./listings/page";
import Orders from "./orders/page";
import QuestionLog from "./question-log/page";
import Users from "./users/page";

const params = <T,>(value: T) => ({ searchParams: Promise.resolve(value) });
// The pages hand their filters to a table that loads its own rows, so the filters are read off the element they return.
const filtersOf = (node: unknown): string | undefined => {
  if (!node || typeof node !== "object") return undefined;
  const props = (node as { props?: { params?: unknown; children?: unknown } }).props;
  if (props?.params) return JSON.stringify(props.params);
  for (const child of [props?.children].flat(Infinity)) {
    const found = filtersOf(child);
    if (found) return found;
  }
  return undefined;
};

describe("admin list pages with a parameter given twice", () => {
  it("users uses the first value", async () => {
    expect(filtersOf(await Users(params({ q: [" ana ", "bob"], banned: ["true", "false"] })))).toBe('{"q":"ana","banned":"true"}');
  });

  it("listings uses the first value", async () => {
    expect(filtersOf(await Listings(params({ q: ["lamp", "x"], sellerId: ["s1", "s2"] })))).toBe('{"q":"lamp","sellerId":"s1"}');
  });

  it("orders uses the first value", async () => {
    expect(filtersOf(await Orders(params({ q: ["inv", "y"], attention: ["any", "overdue"] })))).toBe('{"q":"inv","attention":"any"}');
  });

  it("question log uses the first value", async () => {
    expect(filtersOf(await QuestionLog(params({ q: ["lamp", "x"] })))).toBe('{"q":"lamp"}');
  });
});
