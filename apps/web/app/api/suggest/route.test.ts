import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch, viewerIpHeaders } = vi.hoisted(() => ({ apiFetch: vi.fn(), viewerIpHeaders: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch }));
vi.mock("@/lib/viewer-ip", () => ({ viewerIpHeaders }));

import { GET } from "./route";

const call = (q?: string) => GET(new NextRequest(`http://localhost/api/suggest${q === undefined ? "" : `?q=${encodeURIComponent(q)}`}`));

const visitor = { "x-viewer-ip": "203.0.113.9", "x-viewer-ip-signature": "sig" };

beforeEach(() => {
  apiFetch.mockReset();
  viewerIpHeaders.mockReset().mockResolvedValue(visitor);
});

describe("GET /api/suggest", () => {
  it("passes the text to the API and returns its suggestions", async () => {
    apiFetch.mockResolvedValue(new Response(JSON.stringify({ suggestions: ["Old watch", 5, "Watch box"] })));
    const res = await call("  wat ");
    expect(apiFetch).toHaveBeenCalledWith("/search/suggest?q=wat", { headers: visitor });
    expect(await res.json()).toEqual({ suggestions: ["Old watch", "Watch box"] });
  });

  it("passes the visitor's address on, so the API's limit counts this visitor and not the web server", async () => {
    apiFetch.mockResolvedValue(new Response(JSON.stringify({ suggestions: [] })));
    await call("wat");
    expect(apiFetch.mock.calls[0][1]).toEqual({ headers: { "x-viewer-ip": "203.0.113.9", "x-viewer-ip-signature": "sig" } });
  });

  it("answers an empty list, not an error, when the API says slow down", async () => {
    apiFetch.mockResolvedValue(new Response(JSON.stringify({ code: "RATE_LIMITED" }), { status: 429 }));
    expect(await (await call("wat")).json()).toEqual({ suggestions: [] });
  });

  it("does not ask for text that is too short or missing", async () => {
    expect(await (await call("a")).json()).toEqual({ suggestions: [] });
    expect(await (await call()).json()).toEqual({ suggestions: [] });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("answers an empty list when the API is down, refuses, or sends something odd", async () => {
    apiFetch.mockResolvedValue(new Response("down", { status: 503 }));
    expect(await (await call("wat")).json()).toEqual({ suggestions: [] });
    apiFetch.mockRejectedValue(new Error("asleep"));
    expect(await (await call("wat")).json()).toEqual({ suggestions: [] });
    apiFetch.mockResolvedValue(new Response(JSON.stringify({ nope: true })));
    expect(await (await call("wat")).json()).toEqual({ suggestions: [] });
  });
});
