import Link from "next/link";
import { getOverview } from "@/lib/overview";
import { requireAdmin } from "@/lib/require-admin";

export default async function Overview() {
  await requireAdmin();
  const o = await getOverview();
  const cards: { label: string; value: number; href: string; hot?: boolean }[] = [
    { label: "Open reports", value: o.openReports, href: "/reports", hot: o.openReports > 0 },
    { label: "Open support requests", value: o.openSupport, href: "/support", hot: o.openSupport > 0 },
    { label: "Live auctions", value: o.liveListings, href: "/listings?f_state=live" },
    { label: "Upcoming auctions", value: o.upcomingListings, href: "/listings?f_state=upcoming" },
    { label: "Orders needing attention", value: o.ordersNeedingAttention, href: "/orders?attention=any", hot: o.ordersNeedingAttention > 0 },
    { label: "Orders awaiting payment", value: o.awaitingPaymentOrders, href: "/orders?f_status=AWAITING_PAYMENT" },
    { label: "Paid, not yet shipped", value: o.paidOrdersToShip, href: "/orders?f_status=PAID" },
    { label: "Banned accounts", value: o.bannedUsers, href: "/users?banned=true" },
    { label: "Accounts", value: o.users, href: "/users" },
  ];
  return (
    <div className="max-w-3xl space-y-3">
      <h1 className="text-lg font-bold">Overview</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className="rounded border border-line bg-panel p-4 hover:border-accent">
            <p className="text-muted">{c.label}</p>
            <p className={`text-2xl font-bold ${c.hot ? "text-danger" : ""}`}>{c.value}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
