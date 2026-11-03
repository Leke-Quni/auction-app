import { describe, expect, it } from "vitest";
import { clientIp, signViewerIp } from "../src/common/client-ip";

process.env.AUTH_SECRET = "s".repeat(40);

describe("clientIp", () => {
  it("believes a signed address from the web server", () => {
    const headers = { "x-viewer-ip": "203.0.113.9", "x-viewer-ip-signature": signViewerIp("203.0.113.9") };
    expect(clientIp({ ip: "10.0.0.5", headers })).toBe("203.0.113.9");
  });

  it("ignores an address with a missing, wrong or borrowed signature", () => {
    expect(clientIp({ ip: "10.0.0.5", headers: { "x-viewer-ip": "203.0.113.9" } })).toBe("10.0.0.5");
    expect(clientIp({ ip: "10.0.0.5", headers: { "x-viewer-ip": "203.0.113.9", "x-viewer-ip-signature": "nope" } })).toBe("10.0.0.5");
    expect(clientIp({ ip: "10.0.0.5", headers: { "x-viewer-ip": "6.6.6.6", "x-viewer-ip-signature": signViewerIp("203.0.113.9") } })).toBe("10.0.0.5");
  });

  it("falls back to the connection's own address, or nothing", () => {
    expect(clientIp({ ip: "10.0.0.5", headers: {} })).toBe("10.0.0.5");
    expect(clientIp({ headers: {} })).toBeNull();
  });
});
