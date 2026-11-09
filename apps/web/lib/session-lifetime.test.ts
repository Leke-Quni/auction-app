import { jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import { encodeJwt } from "./jwt";
import { SESSION_MAX_AGE_SECONDS } from "./session-lifetime";

describe("session lifetime", () => {
  it("is two hours of idle time for the storefront", () => {
    expect(SESSION_MAX_AGE_SECONDS).toBe(2 * 60 * 60);
  });

  it("is what a session token expires after unless a caller asks for less", async () => {
    const key = new TextEncoder().encode("secret");
    const token = await encodeJwt({ token: { sub: "u1" }, secret: "secret", salt: "" });
    const { payload } = await jwtVerify(token, key);
    expect(payload.exp! - payload.iat!).toBe(SESSION_MAX_AGE_SECONDS);
  });
});
