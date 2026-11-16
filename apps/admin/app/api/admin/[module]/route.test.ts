import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminApiFetch, auth } = vi.hoisted(() => ({ adminApiFetch: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/api", () => ({ adminApiFetch }));
vi.mock("@/auth", () => ({ auth }));

import { GET } from "./route";

const call = (module: string, query = "") => GET(new Request(`http://admin.test/api/admin/${module}?${query}`), { params: Promise.resolve({ module }) });

beforeEach(() => {
  auth.mockReset().mockResolvedValue({ user: { id: "a1" } });
  adminApiFetch.mockReset().mockResolvedValue(new Response(JSON.stringify({ total: 0, users: [] }), { status: 200 }));
});

describe("GET /api/admin/[module]", () => {
  it("serves only the lists it knows, including names that are inherited keys", async () => {
    expect((await call("secrets")).status).toBe(404);
    expect((await call("constructor")).status).toBe(404);
    expect(adminApiFetch).not.toHaveBeenCalled();
  });

  it("needs a session", async () => {
    auth.mockResolvedValue(null);
    expect((await call("users")).status).toBe(401);
    expect(adminApiFetch).not.toHaveBeenCalled();
  });

  it("forwards only the named parameters", async () => {
    const res = await call("users", "q=ana&banned=true&page=2&limit=100&role=ADMIN");
    expect(res.status).toBe(200);
    expect(adminApiFetch).toHaveBeenCalledWith("/admin/users?q=ana&banned=true&page=2");
    expect(await res.json()).toEqual({ total: 0, users: [] });
  });

  it("forwards the sort and the per-column searches of a list, and no one else's", async () => {
    adminApiFetch.mockImplementation(async () => new Response("{}", { status: 200 }));
    await call("users", "sort=email&dir=desc&f_username=ana&f_item=x&page=2");
    await call("orders", "sort=price&f_buyer=bo&f_price=10-50&f_username=nope");
    expect(adminApiFetch.mock.calls.map((c) => c[0])).toEqual(["/admin/users?page=2&sort=email&dir=desc&f_username=ana", "/admin/orders?sort=price&f_price=10-50&f_buyer=bo"]);
  });

  it("forwards the new column searches of each list", async () => {
    adminApiFetch.mockImplementation(async () => new Response("{}", { status: 200 }));
    await call("users", "f_status=banned&f_bids=2-&f_listings=1&f_strikes=0");
    await call("listings", "f_state=live&f_price=10-50&f_bids=-3&f_username=x");
    await call("orders", "f_parcel=DELIVERED");
    await call("audit", "f_action=BAN_USER&f_reason=fraud");
    expect(adminApiFetch.mock.calls.map((c) => c[0])).toEqual([
      "/admin/users?f_status=banned&f_listings=1&f_bids=2-&f_strikes=0",
      "/admin/listings?f_title=&f_state=live&f_price=10-50&f_bids=-3".replace("f_title=&", ""),
      "/admin/orders?f_parcel=DELIVERED",
      "/admin/audit?f_action=BAN_USER&f_reason=fraud",
    ]);
  });

  it("serves every paged list with its own parameters", async () => {
    adminApiFetch.mockImplementation(async () => new Response("{}", { status: 200 }));
    await call("listings", "q=a&sellerId=s&page=3&x=1");
    await call("orders", "f_status=PAID&attention=any&page=2");
    await call("audit", "adminId=a&targetId=t&q=n");
    await call("question-log", "questionId=q&listingId=l&actorId=u&page=2&limit=500");
    expect(adminApiFetch.mock.calls.map((c) => c[0])).toEqual([
      "/admin/listings?q=a&sellerId=s&page=3",
      "/admin/orders?attention=any&page=2&f_status=PAID",
      "/admin/audit?q=n&adminId=a&targetId=t",
      "/admin/question-log?questionId=q&listingId=l&actorId=u&page=2",
    ]);
  });

  it("maps API failures to a plain status", async () => {
    adminApiFetch.mockResolvedValue(new Response("", { status: 403 }));
    expect((await call("users")).status).toBe(403);
    adminApiFetch.mockResolvedValue(new Response("", { status: 500 }));
    expect((await call("users")).status).toBe(502);
  });
});
