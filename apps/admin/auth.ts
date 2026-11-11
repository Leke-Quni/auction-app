import { loginCodeSchema } from "@auction/shared";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { apiFetch } from "@/lib/api";
import { decodeJwt, encodeJwt } from "@/lib/jwt";
import { SESSION_MAX_AGE_SECONDS } from "@/lib/session-lifetime";

// Its own cookie names: on localhost the storefront and this app share cookies, and must not sign each other out.
const cookie = (name: string) => ({ name: `admin.${name}`, options: { httpOnly: true, sameSite: "lax" as const, path: "/", secure: process.env.NODE_ENV === "production" } });

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  jwt: { encode: encodeJwt, decode: decodeJwt },
  pages: { signIn: "/sign-in" },
  cookies: { sessionToken: cookie("session-token"), callbackUrl: cookie("callback-url"), csrfToken: cookie("csrf-token") },
  providers: [
    // The password is checked in step 1 (signInAction). This step trusts only a valid emailed code, and only for an admin: there is
    // no public sign-up here. Every request is checked again by the API (AdminGuard), so this is a convenience, never the lock.
    Credentials({
      credentials: { email: {}, code: {} },
      async authorize(credentials) {
        const parsed = loginCodeSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const res = await apiFetch("/auth/login/verify", { method: "POST", body: JSON.stringify(parsed.data) });
        if (!res.ok) return null;
        const user = await res.json();
        return user.role === "ADMIN" ? user : null;
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id!;
        token.role = user.role;
        token.sv = user.sessionVersion;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id!;
      session.user.role = token.role!;
      session.user.sessionVersion = token.sv ?? 0;
      return session;
    },
  },
});
