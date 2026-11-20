import { signOutAction } from "@/app/actions";
import { getOverview } from "@/lib/overview";
import { requireAdmin } from "@/lib/require-admin";
import { AccountMenu } from "./account-menu";
import { Nav } from "./nav";

// Everything behind sign-in: a slate sidebar and a content area. The API is asked who this is on every request.
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  const { openReports, openSupport } = await getOverview();
  return (
    <div className="grid min-h-screen grid-cols-1 content-start md:grid-cols-[13rem_1fr] md:content-stretch">
      <aside className="flex flex-col bg-side py-3 text-side-ink md:fixed md:inset-y-0 md:left-0 md:w-52 md:overflow-y-auto md:py-4">
        <p className="px-4 pb-2 text-sm font-bold tracking-wide text-side-active md:pb-4">Auctionly Admin</p>
        <Nav openReports={openReports} openSupport={openSupport} />
        <div className="mt-auto border-t border-side-line pt-2">
          <AccountMenu email={admin.email} signOutAction={signOutAction} />
        </div>
      </aside>
      {/* A page whose table has page numbers (data-fill-page) fills the window's height, so the numbers sit at the bottom. */}
      <main className="flex min-w-0 flex-col p-5 md:col-start-2 [&>div:has([data-fill-page])]:flex [&>div:has([data-fill-page])]:flex-1 [&>div:has([data-fill-page])]:flex-col">{children}</main>
    </div>
  );
}
