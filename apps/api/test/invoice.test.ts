import { describe, expect, it } from "vitest";
import { invoiceRows, invoiceTitle, renderInvoice, type InvoiceData } from "../src/orders/invoice";

const data = (viewer: "buyer" | "seller"): InvoiceData => ({
  invoiceNumber: "INV-2026-000007",
  paidAt: new Date("2026-11-04T10:00:00Z"),
  title: "Brass lamp",
  amountCents: 2000,
  shipping: { address: { name: "Ben Buyer", line1: "Rruga 7", city: "Tirana", postcode: "1001", country: "AL", phone: "+355691112222" }, optionId: "express", name: "Express", estimatedDays: 2, tracked: true, insured: true, priceCents: 900 },
  totalCents: 2900,
  feeCents: 100,
  sellerNetCents: 1900,
  buyerUsername: "ben",
  sellerUsername: "sam",
  viewer,
});

describe("invoice rows", () => {
  it("shows the buyer the item, the delivery and the total they paid", () => {
    expect(invoiceTitle("buyer")).toBe("Invoice");
    expect(invoiceRows(data("buyer")).map((r) => [r.label, r.amount])).toEqual([
      ["Brass lamp", "€20.00"],
      ["Delivery: Express (about 2 days, tracked, insured)", "€9.00"],
      ["Total paid by card (EUR)", "€29.00"],
    ]);
  });

  it("shows the seller only what the item sold for, the fee taken and what they receive", () => {
    expect(invoiceTitle("seller")).toBe("Sale statement");
    const rows = invoiceRows(data("seller"));
    expect(rows.map((r) => [r.label, r.amount])).toEqual([
      ["Brass lamp", "€20.00"],
      ["Platform fee", "-€1.00"],
      ["You receive (EUR)", "€19.00"],
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/€29\.00|€9\.00|Delivery/);
  });

  it("renders both as PDFs", async () => {
    for (const viewer of ["buyer", "seller"] as const) expect((await renderInvoice(data(viewer))).subarray(0, 4).toString()).toBe("%PDF");
  });
});
