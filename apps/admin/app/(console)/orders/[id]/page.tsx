import { formatEur, SHIPPING_COUNTRIES, type ShippingAddress, type ShippingCountry } from "@auction/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import { adminApiFetch } from "@/lib/api";
import { requireAdmin } from "@/lib/require-admin";
import { STATUS_LABEL, STATUS_PILL } from "../status";

interface Party {
  id: string;
  username: string;
  email: string;
  name: string;
}
interface Order {
  id: string;
  status: keyof typeof STATUS_LABEL;
  round: number;
  listing: { id: string; title: string };
  buyer: Party;
  seller: Party & { hasPayoutAccount: boolean };
  amounts: { itemCents: number; feeCents: number; sellerNetCents: number; shippingCents: number | null; totalCents: number | null };
  createdAt: string;
  payBy: string;
  paidAt: string | null;
  reminderSentAt: string | null;
  invoiceNumber: string | null;
  paymentRef: string | null;
  paymentAttempts: number;
  delivery: { address: ShippingAddress; option: { name: string; estimatedDays: number; tracked: boolean; insured: boolean; priceCents: number }; trackingEmails: boolean } | null;
  pickupAddress: ShippingAddress | null;
  shipment: { status: string; trackingCode: string | null; shippedAt: string | null; inTransitAt: string | null; deliveredAt: string | null } | null;
  payout: { status: "NOT_DELIVERED" | "SCHEDULED" | "WAITING_FOR_ACCOUNT" | "PAID"; dueAt: string | null; paidAt: string | null; amountCents: number; reference: string | null } | null;
  rating: { stars: number; comment: string | null; createdAt: string } | null;
}

const when = (iso: string | null) => (iso ? new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "-");
const PAYOUT_LABEL = { NOT_DELIVERED: "Not due yet: the parcel is not delivered", SCHEDULED: "Due, to be paid on the next run", WAITING_FOR_ACCOUNT: "Waiting for the seller to set up payouts", PAID: "Paid" } as const;

function Table({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <table className="w-full border-collapse text-left">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="border-t border-line first:border-t-0">
            <th className="w-44 bg-page p-2 align-top font-normal text-muted">{k}</th>
            <td className="p-2 break-words">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="overflow-hidden rounded border border-line bg-panel">
    <h2 className="border-b border-line px-2 py-1.5 font-bold">{title}</h2>
    {children}
  </section>
);

const Address = ({ a }: { a: ShippingAddress }) => (
  <address className="not-italic">
    {a.name}
    <br />
    {a.line1}
    {a.line2 && (
      <>
        <br />
        {a.line2}
      </>
    )}
    <br />
    {a.postcode} {a.city}
    <br />
    {SHIPPING_COUNTRIES[a.country as ShippingCountry] ?? a.country}
    <br />
    {a.phone}
  </address>
);

const Person = ({ p }: { p: Party }) => (
  <>
    <Link href={`/users/${p.id}`} className="text-accent underline">
      @{p.username}
    </Link>{" "}
    <span className="text-muted">
      {p.name}, {p.email}
    </span>
  </>
);

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const res = await adminApiFetch(`/admin/orders/${encodeURIComponent(id)}`);
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`API /admin/orders failed: ${res.status}`);
  const o = (await res.json()) as Order;
  const m = o.amounts;
  return (
    <div className="max-w-3xl space-y-3">
      <h1 className="text-lg font-bold">
        {o.listing.title} <span className={`ml-1 rounded px-1.5 py-0.5 text-xs font-semibold ${STATUS_PILL[o.status]}`}>{STATUS_LABEL[o.status]}</span>
      </h1>
      <p className="text-muted">
        Order {o.id}
        {o.round > 1 ? `, offer ${o.round}` : ""}. <Link href={`/listings/${o.listing.id}`} className="text-accent underline">Listing</Link>
      </p>

      <Section title="People">
        <Table rows={[["Buyer", <Person key="b" p={o.buyer} />], ["Seller", <Person key="s" p={o.seller} />]]} />
      </Section>

      <Section title="Money">
        <Table
          rows={[
            ["Item price", formatEur(m.itemCents)],
            ["Platform fee (from the seller)", formatEur(m.feeCents)],
            ["Seller receives", formatEur(m.sellerNetCents)],
            ["Delivery (paid by the buyer)", m.shippingCents === null ? "not chosen yet" : formatEur(m.shippingCents)],
            ["Buyer pays in all", m.totalCents === null ? "-" : formatEur(m.totalCents)],
            ["Invoice", o.invoiceNumber ?? "-"],
            ["Payment reference", o.paymentRef ? `${o.paymentRef} (${o.paymentAttempts} attempt${o.paymentAttempts === 1 ? "" : "s"})` : "-"],
          ]}
        />
      </Section>

      <Section title="Timeline">
        <Table rows={[["Created", when(o.createdAt)], ["Pay by", when(o.payBy)], ["Reminder sent", when(o.reminderSentAt)], ["Paid", when(o.paidAt)]]} />
      </Section>

      <div className="grid gap-3 sm:grid-cols-2">
        <Section title="Deliver to (the buyer's address)">
          <div className="space-y-1 p-2">
            {o.delivery ? (
              <>
                <Address a={o.delivery.address} />
                <p className="pt-1 text-muted">
                  {o.delivery.option.name}, about {o.delivery.option.estimatedDays} days{o.delivery.option.tracked ? ", tracked" : ""}
                  {o.delivery.option.insured ? ", insured" : ""}. Tracking emails {o.delivery.trackingEmails ? "on" : "off"}.
                </p>
              </>
            ) : (
              <p className="text-muted">The buyer has not entered a delivery address yet.</p>
            )}
          </div>
        </Section>
        <Section title="Collect from (the seller's address)">
          <div className="p-2">{o.pickupAddress ? <Address a={o.pickupAddress} /> : <p className="text-muted">No pickup address was saved for this order.</p>}</div>
        </Section>
      </div>

      <Section title="Parcel">
        {o.shipment ? (
          <Table rows={[["Status", o.shipment.status.replace("_", " ").toLowerCase()], ["Tracking code", o.shipment.trackingCode ?? "-"], ["Label created", when(o.shipment.shippedAt)], ["In transit", when(o.shipment.inTransitAt)], ["Delivered", when(o.shipment.deliveredAt)]]} />
        ) : (
          <p className="p-2 text-muted">{o.status === "PAID" ? "The seller has not marked it as shipped." : "Nothing has shipped."}</p>
        )}
      </Section>

      <Section title="Seller payout">
        {o.payout ? (
          <Table
            rows={[
              ["Status", PAYOUT_LABEL[o.payout.status]],
              ["Amount", formatEur(o.payout.amountCents)],
              ["Due", when(o.payout.dueAt)],
              ["Paid", when(o.payout.paidAt)],
              ["Transfer reference", o.payout.reference ?? "-"],
              ["Seller payout account", o.seller.hasPayoutAccount ? "set up" : "not set up"],
            ]}
          />
        ) : (
          <p className="p-2 text-muted">A payout only exists for a paid order.</p>
        )}
      </Section>

      <Section title="Buyer's rating">
        {o.rating ? (
          <div className="p-2">
            <p className="font-semibold">{"★".repeat(o.rating.stars)}{"☆".repeat(5 - o.rating.stars)} {o.rating.stars} of 5</p>
            {o.rating.comment && <p className="whitespace-pre-wrap break-words">{o.rating.comment}</p>}
          </div>
        ) : (
          <p className="p-2 text-muted">Not rated.</p>
        )}
      </Section>
    </div>
  );
}
