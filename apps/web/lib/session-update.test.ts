import { Auth, skipCSRFCheck, type AuthConfig } from "@auth/core";
import { describe, expect, it } from "vitest";
import { decodeJwt, encodeJwt } from "./jwt";
import { jwtCallback, withSessionUpdate } from "./session-update";

const secret = "x".repeat(32);
const cookieName = "authjs.session-token";

const config: AuthConfig = {
  secret,
  basePath: "/api/auth",
  trustHost: true,
  skipCSRFCheck,
  providers: [],
  session: { strategy: "jwt" },
  jwt: { encode: encodeJwt, decode: decodeJwt },
  callbacks: { jwt: jwtCallback },
};

// The same request a browser can send itself, or the one `unstable_update` builds on the server.
async function postSession(cookie: string, data: unknown) {
  const res = await Auth(
    new Request("http://localhost/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: `${cookieName}=${cookie}` },
      body: JSON.stringify({ data }),
    }),
    config,
  );
  const set = res.headers.getSetCookie().find((c) => c.startsWith(`${cookieName}=`));
  const value = set?.split(";")[0]!.slice(cookieName.length + 1);
  return value ? decodeJwt({ token: value, secret, salt: cookieName }) : null;
}

const oldCookie = () =>
  encodeJwt({ token: { sub: "u1", id: "u1", role: "USER", name: "old", email: "old@x.co", sv: 1 }, secret, salt: cookieName });

describe("session update", () => {
  it("ignores the values a browser posts to /api/auth/session", async () => {
    const token = await postSession(await oldCookie(), { user: { sessionVersion: 2, name: "evil", email: "evil@x.co" } });
    expect(token).toMatchObject({ sv: 1, name: "old", email: "old@x.co" });
  });

  it("takes the values server code passes", async () => {
    const cookie = await oldCookie();
    const token = await withSessionUpdate({ sessionVersion: 2, name: "new", email: "new@x.co" }, () => postSession(cookie, {}));
    expect(token).toMatchObject({ sv: 2, name: "new", email: "new@x.co" });
  });
});
