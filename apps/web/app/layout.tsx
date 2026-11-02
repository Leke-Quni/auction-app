import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { auth, signOut } from "@/auth";
import { loadCategories } from "@/lib/categories";
import "./globals.css";
import { SearchBox } from "./search-box";
import { UserMenu } from "./user-menu";

export const metadata: Metadata = { title: "Auctionly" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [session, categories] = await Promise.all([auth(), loadCategories()]);
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <header className="flex items-center gap-4 bg-brand px-4 py-2 text-white sm:grid sm:grid-cols-[1fr_minmax(0,24rem)_1fr]">
          <Link href="/" className="text-xl font-black italic">
            AUCTIONLY
          </Link>
          <Suspense fallback={<div className="flex-1" />}>
            <SearchBox categories={categories} />
          </Suspense>
          <div className="flex items-center justify-end gap-4">
            {session ? (
              <UserMenu
                username={session.user.name ?? ""}
                signOutAction={async () => {
                  "use server";
                  await signOut({ redirectTo: "/" });
                }}
              />
            ) : (
              <>
                <Link href="/sign-in">Sign in</Link>
                <Link href="/sign-up">Sign up</Link>
              </>
            )}
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 p-3">{children}</main>
        <footer className="border-t border-line bg-white px-4 py-3">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-3">
            <Link href="/sell/new" className="font-bold text-brand underline">
              Sell something
            </Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
