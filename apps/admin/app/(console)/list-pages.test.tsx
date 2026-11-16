import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminApiFetch } = vi.hoisted(() => ({ adminApiFetch: vi.fn() }));
vi.mock("@/lib/api", () => ({ adminApiFetch }));
vi.mock("@/lib/require-admin", () => ({ requireAdmin: async () => ({ id: "a1", email: "a@x.co", isSuperAdmin: false }) }));

import Listings from "./listings/page";
import Orders from "./orders/page";
import QuestionLog from "./question-log/page";
import Users from "./users/page";

const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const params = <T,>(value: T) => ({ searchParams: Promise.resolve(value) });

beforeEach(() => {
  adminApiFetch.mockReset().mockImplementation(async (path: string) => {
    if (path.startsWith("/admin/users")) return reply({ users: [] });
    if (path.startsWith("/admin/listings")) return reply({ listings: [] });
    if (path.startsWith("/admin/orders")) return reply({ orders: [] });
    return reply({ entries: [], questions: {} });
  });
});

describe("admin list pages with a parameter given twice", () => {
  it("users uses the first value", async () => {
    await Users(params({ q: [" ana ", "bob"], banned: ["true", "false"] }));
    expect(adminApiFetch).toHaveBeenCalledWith("/admin/users?q=ana&banned=true");
  });

  it("listings uses the first value", async () => {
    await Listings(params({ q: ["lamp", "x"], phase: ["live", "ended"], sellerId: ["s1", "s2"] }));
    expect(adminApiFetch).toHaveBeenCalledWith("/admin/listings?q=lamp&sellerId=s1&phase=live");
  });

  it("orders uses the first value", async () => {
    await Orders(params({ q: ["inv", "y"], status: ["PAID", "toString"] }));
    expect(adminApiFetch).toHaveBeenCalledWith("/admin/orders?q=inv&status=PAID");
  });

  it("question log uses the first value", async () => {
    await QuestionLog(params({ q: ["lamp", "x"] }));
    expect(adminApiFetch).toHaveBeenCalledWith(expect.stringMatching(/^\/admin\/question-log\?q=lamp/));
  });
});

describe("orders status filter", () => {
  it("ignores a status that is only an inherited key", async () => {
    await Orders(params({ status: "toString" }));
    await Orders(params({ status: "constructor" }));
    expect(adminApiFetch.mock.calls.map((c) => c[0])).toEqual(["/admin/orders?", "/admin/orders?"]);
  });
});
