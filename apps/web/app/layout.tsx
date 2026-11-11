import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
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
import { SignedOutNotice } from "./signed-out-notice";
import { UserMenu } from "./user-menu";

const font = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-body", display: "swap" });

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
    <html lang="en" className={font.variable}>
      <body className="flex min-h-screen flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-surface focus:px-3 focus:py-2 focus:font-bold focus:text-brand">
          Skip to content
        </a>
        {/* On a phone the search goes on a row of its own below the logo and the account links, where it has room. */}
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-4 py-2 text-ink sm:grid sm:grid-cols-[1fr_minmax(0,24rem)_1fr]">
          <Link href="/" className="text-xl font-black italic text-brand">
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
                    await signOut({ redirectTo: "/?signedOut=1" });
                  }}
                />
              </>
            ) : (
              <>
                <Link href="/sign-in" className="inline-block py-1">
                  Sign in
                </Link>
                <Link href="/sign-up" className="rounded-full bg-brand px-4 py-1.5 font-bold text-on-brand hover:bg-brand-dark">
                  Sign up
                </Link>
              </>
            )}
          </div>
        </header>
        <SignedOutNotice />
        {session && <Notifications />}
        <main id="main" className="mx-auto w-full max-w-3xl flex-1 p-3">{children}</main>
        <footer className="border-t border-line bg-surface px-4 py-3">
          <div className="mx-auto flex max-w-3xl items-center justify-between px-3">
            <Link href="/sell/new" className="inline-block py-1 font-bold text-brand underline">
              Sell something
            </Link>
            <Link href="/support" className="inline-block py-1 text-brand underline">
              Support
            </Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
