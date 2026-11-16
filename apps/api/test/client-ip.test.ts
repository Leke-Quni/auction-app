import { describe, expect, it } from "vitest";
import { authClientIp, clientIp, signedClientIp, signViewerIp } from "../src/common/client-ip";

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

  it("signedClientIp gives only a vouched-for address, never the connection's own", () => {
    const headers = { "x-viewer-ip": "203.0.113.9", "x-viewer-ip-signature": signViewerIp("203.0.113.9") };
    expect(signedClientIp({ ip: "10.0.0.5", headers })).toBe("203.0.113.9");
    expect(signedClientIp({ ip: "10.0.0.5", headers: {} })).toBeNull();
  });

  it("an empty signed address is the web server without one: no address for the auth limits, the connection's own elsewhere", () => {
    const headers = { "x-viewer-ip": "", "x-viewer-ip-signature": signViewerIp("") };
    expect(signedClientIp({ ip: "10.0.0.5", headers })).toBeNull();
    expect(clientIp({ ip: "10.0.0.5", headers })).toBe("10.0.0.5");
    expect(authClientIp({ ip: "10.0.0.5", headers })).toBeNull();
  });

  it("authClientIp uses a signed address, else the connection's own for a direct caller", () => {
    expect(authClientIp({ ip: "10.0.0.5", headers: { "x-viewer-ip": "203.0.113.9", "x-viewer-ip-signature": signViewerIp("203.0.113.9") } })).toBe("203.0.113.9");
    expect(authClientIp({ ip: "10.0.0.5", headers: {} })).toBe("10.0.0.5");
    expect(authClientIp({ ip: "10.0.0.5", headers: { "x-viewer-ip": "", "x-viewer-ip-signature": "nope" } })).toBe("10.0.0.5");
  });
});
