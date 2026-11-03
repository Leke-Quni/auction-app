import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import type { NotificationList } from "@auction/shared";
import { auth, signOut } from "@/auth";
import { authedApiFetch } from "@/lib/api";
import { loadCategories } from "@/lib/categories";
import "./globals.css";
import { NotificationBell } from "./notification-bell";
import { Notifications } from "./notifications";
import { SearchBox } from "./search-box";
import { UserMenu } from "./user-menu";

export const metadata: Metadata = { title: "Auctionly" };

// Loaded inside the header's Suspense, so a slow API never holds up the rest of the page.
async function HeaderSearch() {
  return <SearchBox categories={await loadCategories()} />;
}

// The bell starts with the person's latest notifications. Loaded inside a Suspense so a slow API never holds up the page.
async function HeaderBell() {
  let initial: NotificationList | null = null;
  try {
    const res = await authedApiFetch("/notifications");
    if (res.ok) initial = await res.json();
  } catch {
    // The bell then loads its list when it is opened.
  }
  return <NotificationBell initial={initial} />;
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <header className="flex items-center gap-4 bg-brand px-4 py-2 text-white sm:grid sm:grid-cols-[1fr_minmax(0,24rem)_1fr]">
          <Link href="/" className="text-xl font-black italic">
            AUCTIONLY
          </Link>
          <Suspense fallback={<div className="flex-1" />}>
            <HeaderSearch />
          </Suspense>
          <div className="ml-auto flex items-center justify-end gap-4 whitespace-nowrap sm:col-start-3">
            {session ? (
              <>
                <Suspense fallback={<div className="h-8 w-8" />}>
                  <HeaderBell />
                </Suspense>
                <UserMenu
                  username={session.user.name ?? ""}
                  signOutAction={async () => {
                    "use server";
                    await signOut({ redirectTo: "/" });
                  }}
                />
              </>
            ) : (
              <>
                <Link href="/sign-in">Sign in</Link>
                <Link href="/sign-up">Sign up</Link>
              </>
            )}
          </div>
        </header>
        {session && <Notifications />}
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
