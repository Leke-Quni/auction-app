import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const incoming = vi.hoisted(() => ({ headers: new Map<string, string>(), fail: false }));
vi.mock("next/headers", () => ({
  headers: async () => {
    if (incoming.fail) throw new Error("outside a request");
    return { get: (name: string) => incoming.headers.get(name) ?? null };
  },
}));

import { viewerIpHeaders } from "./viewer-ip";

beforeEach(() => {
  incoming.headers.clear();
  incoming.fail = false;
  process.env.AUTH_SECRET = "x".repeat(40);
});

describe("viewerIpHeaders", () => {
  it("passes on the visitor's address with a signature made from the shared secret", async () => {
    incoming.headers.set("x-real-ip", "203.0.113.9");
    expect(await viewerIpHeaders()).toEqual({
      "x-viewer-ip": "203.0.113.9",
      "x-viewer-ip-signature": createHmac("sha256", "x".repeat(40)).update("203.0.113.9").digest("hex"),
    });
  });

  it("uses the first address in x-forwarded-for when there is no x-real-ip", async () => {
    incoming.headers.set("x-forwarded-for", "198.51.100.4, 10.0.0.1");
    expect((await viewerIpHeaders())["x-viewer-ip"]).toBe("198.51.100.4");
  });

  it("sends nothing when there is no address or no request to read", async () => {
    expect(await viewerIpHeaders()).toEqual({});
    incoming.fail = true;
    expect(await viewerIpHeaders()).toEqual({});
  });
});
