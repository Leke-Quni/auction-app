import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, authedApiFetch } = vi.hoisted(() => ({ auth: vi.fn(), authedApiFetch: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/api", () => ({ authedApiFetch }));

import { loadNotificationsAction, markNotificationReadAction } from "./notification-actions";

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  auth.mockReset().mockResolvedValue({ user: { id: "u1" } });
  authedApiFetch.mockReset();
});

describe("loadNotificationsAction", () => {
  it("returns the list from the API", async () => {
    authedApiFetch.mockResolvedValue(reply(200, { items: [], unreadCount: 2 }));
    expect(await loadNotificationsAction()).toEqual({ items: [], unreadCount: 2 });
    expect(authedApiFetch).toHaveBeenCalledWith("/notifications");
  });

  it("returns null when signed out, on an API error, or when the API cannot be reached", async () => {
    auth.mockResolvedValueOnce(null);
    expect(await loadNotificationsAction()).toBeNull();
    expect(authedApiFetch).not.toHaveBeenCalled();
    authedApiFetch.mockResolvedValueOnce(reply(503, {}));
    expect(await loadNotificationsAction()).toBeNull();
    authedApiFetch.mockRejectedValueOnce(new Error("down"));
    expect(await loadNotificationsAction()).toBeNull();
  });
});

describe("markNotificationReadAction", () => {
  it("posts the read mark and returns the new unread count", async () => {
    authedApiFetch.mockResolvedValue(reply(201, { unreadCount: 1 }));
    expect(await markNotificationReadAction("n 1")).toBe(1);
    expect(authedApiFetch).toHaveBeenCalledWith("/notifications/n%201/read", { method: "POST" });
  });

  it("returns null when it cannot be marked", async () => {
    authedApiFetch.mockResolvedValueOnce(reply(500, {}));
    expect(await markNotificationReadAction("n1")).toBeNull();
    authedApiFetch.mockRejectedValueOnce(new Error("down"));
    expect(await markNotificationReadAction("n1")).toBeNull();
  });
});
