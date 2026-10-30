import { signInSchema } from "@auction/shared";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { apiFetch } from "@/lib/api";
import { decodeJwt, encodeJwt } from "@/lib/jwt";

class EmailNotVerified extends CredentialsSignin {
  code = "email_not_verified";
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
  jwt: { encode: encodeJwt, decode: decodeJwt },
  pages: { signIn: "/sign-in" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const parsed = signInSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const res = await apiFetch("/auth/login", { method: "POST", body: JSON.stringify(parsed.data) });
        if (res.status === 403) throw new EmailNotVerified();
        if (!res.ok) return null;
        return res.json();
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id!;
        token.role = user.role;
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
