import { loginCodeSchema } from "@auction/shared";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { apiFetch } from "@/lib/api";
import { decodeJwt, encodeJwt } from "@/lib/jwt";

export const { handlers, signIn, signOut, auth, unstable_update } = NextAuth({
  session: { strategy: "jwt" },
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
    jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id!;
        token.role = user.role;
      }
      if (trigger === "update" && session?.user) {
        if (session.user.name) token.name = session.user.name;
        if (session.user.email) token.email = session.user.email;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id!;
      session.user.role = token.role!;
      return session;
    },
  },
});
