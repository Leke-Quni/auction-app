import { loginCodeSchema } from "@auction/shared";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { apiFetch } from "@/lib/api";
import { decodeJwt, encodeJwt } from "@/lib/jwt";
import { SESSION_MAX_AGE_SECONDS } from "@/lib/session-lifetime";
import { jwtCallback, withSessionUpdate, type SessionUpdate } from "@/lib/session-update";

export const { handlers, signIn, signOut, auth, unstable_update } = NextAuth({
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  jwt: { encode: encodeJwt, decode: decodeJwt },
  pages: { signIn: "/sign-in" },
  providers: [
    // The password is checked in step 1 (signInAction). This step trusts only a valid emailed code.
    Credentials({
      credentials: { email: {}, code: {} },
      async authorize(credentials) {
        const parsed = loginCodeSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const res = await apiFetch("/auth/login/verify", { method: "POST", body: JSON.stringify(parsed.data) });
        if (!res.ok) return null;
        return res.json();
      },
    }),
  ],
  callbacks: {
    jwt: jwtCallback,
    session({ session, token }) {
      session.user.id = token.id!;
      session.user.role = token.role!;
      session.user.sessionVersion = token.sv ?? 0;
      return session;
    },
  },
});

// The only way to change what a signed-in session carries: the values come from the API's answer, never from the browser.
export const updateSession = (update: SessionUpdate) => withSessionUpdate(update, () => unstable_update({}));
