import { jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import { decodeJwt, encodeJwt } from "./jwt";

const secret = "x".repeat(32);

describe("jwt", () => {
  it("round-trips a token signed as HS256", async () => {
    const token = await encodeJwt({ token: { sub: "u1", email: "a@b.co", role: "USER" }, secret, salt: "" });
    const { payload, protectedHeader } = await jwtVerify(token, new TextEncoder().encode(secret));
    expect(protectedHeader.alg).toBe("HS256");
    expect(payload).toMatchObject({ sub: "u1", email: "a@b.co", role: "USER" });
    expect(await decodeJwt({ token, secret, salt: "" })).toMatchObject({ sub: "u1" });
  });

  it("rejects a token signed with another secret", async () => {
    const token = await encodeJwt({ token: { sub: "u1" }, secret: "y".repeat(32), salt: "" });
    expect(await decodeJwt({ token, secret, salt: "" })).toBeNull();
  });
});
