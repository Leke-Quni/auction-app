import type { Metadata } from "next";
import Link from "next/link";
import { auth, signOut } from "@/auth";
import "./globals.css";

export const metadata: Metadata = { title: "Auctionly" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  return (
    <html lang="en">
      <body>
        <header className="flex items-center gap-4 bg-brand px-4 py-2 text-white">
          <Link href="/" className="text-xl font-black italic">
            AUCTIONLY
          </Link>
          <span className="flex-1" />
          {session ? (
            <>
              <Link href="/account">{session.user.name}</Link>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/" });
                }}
              >
                <button className="cursor-pointer underline">Sign out</button>
              </form>
            </>
          ) : (
            <>
              <Link href="/sign-in">Sign in</Link>
              <Link href="/sign-up">Sign up</Link>
            </>
          )}
        </header>
        <main className="mx-auto max-w-3xl p-3">{children}</main>
      </body>
    </html>
  );
}
