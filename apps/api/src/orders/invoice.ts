import { formatEur, SHIPPING_COUNTRIES, type OrderShipping, type ShippingAddress, type ShippingCountry, type ShippingOption } from "@auction/shared";
import PDFDocument from "pdfkit";

export type Delivery = OrderShipping & { priceCents: number };

export interface InvoiceData {
  invoiceNumber: string;
  // The order's id, as in the address of its page, so a person and support can point at the same order.
  orderId: string;
  paidAt: Date;
  title: string;
  amountCents: number;
  shipping: Delivery;
  totalCents: number;
  feeCents: number;
  sellerNetCents: number;
  buyerUsername: string;
  sellerUsername: string;
  // The seller's copy shows only where the parcel is going (city and country): our carrier delivers it.
  viewer: "buyer" | "seller";
}

// The delivery details saved on an order, or null while the buyer has not chosen them.
export function deliveryOf(order: { shippingAddress: unknown; shippingOption: unknown }): Delivery | null {
  if (!order.shippingAddress || !order.shippingOption) return null;
  const option = order.shippingOption as ShippingOption;
  return { address: order.shippingAddress as ShippingAddress, optionId: option.id, name: option.name, estimatedDays: option.estimatedDays, tracked: option.tracked, insured: option.insured, priceCents: option.priceCents };
}

interface InvoiceOrder {
  id: string;
  status: string;
  invoiceNumber: string | null;
  paidAt: Date | null;
  amountCents: number;
  feeCents: number;
  sellerNetCents: number;
  totalCents: number | null;
  shippingAddress: unknown;
  shippingOption: unknown;
  listing: { title: string };
  buyer: { username: string };
  seller: { username: string };
}

// What an invoice needs from a paid order, or null if the order is not paid or lacks its delivery details.
export function invoiceDataOf(order: InvoiceOrder, viewer: "buyer" | "seller"): InvoiceData | null {
  const shipping = deliveryOf(order);
  if (order.status !== "PAID" || !order.invoiceNumber || !order.paidAt || !shipping || order.totalCents === null) return null;
  return { invoiceNumber: order.invoiceNumber, orderId: order.id, paidAt: order.paidAt, title: order.listing.title, amountCents: order.amountCents, shipping, totalCents: order.totalCents, feeCents: order.feeCents, sellerNetCents: order.sellerNetCents, buyerUsername: order.buyer.username, sellerUsername: order.seller.username, viewer };
}

const utcDate = (d: Date) => `${d.toISOString().slice(0, 10)} UTC`;

export const addressLines = (a: ShippingAddress) => [
  a.name,
  a.line1,
  ...(a.line2 ? [a.line2] : []),
  `${a.postcode} ${a.city}`,
  SHIPPING_COUNTRIES[a.country as ShippingCountry] ?? a.country,
  a.phone,
];

export interface InvoiceRow {
  label: string;
  amount: string;
  bold?: boolean;
}

export const invoiceTitle = (viewer: "buyer" | "seller") => (viewer === "buyer" ? "Invoice" : "Sale statement");

// The lines of the document. The buyer's shows what they paid: the item, the delivery and the total. The seller's shows only
// what their item sold for, the fee taken and what they receive: never what the buyer paid for delivery, nor the total.
export function invoiceRows(data: InvoiceData): InvoiceRow[] {
  if (data.viewer === "seller") {
    return [
      { label: data.title, amount: formatEur(data.amountCents) },
      { label: "Platform fee", amount: `-${formatEur(data.feeCents)}` },
      { label: "You receive (EUR)", amount: formatEur(data.sellerNetCents), bold: true },
    ];
  }
  const s = data.shipping;
  return [
    { label: data.title, amount: formatEur(data.amountCents) },
    { label: `Delivery: ${s.name} (about ${s.estimatedDays} days${s.tracked ? ", tracked" : ""}${s.insured ? ", insured" : ""})`, amount: formatEur(s.priceCents) },
    { label: "Total paid by card (EUR)", amount: formatEur(data.totalCents), bold: true },
  ];
}

// The lines under the title: the invoice number, the order it is for, and when it was paid.
export const invoiceHeaderLines = (data: InvoiceData) => [`Invoice number: ${data.invoiceNumber}`, `Order: ${data.orderId}`, `Paid: ${utcDate(data.paidAt)}`];

// A receipt-style invoice for a paid order, as a PDF (the seller gets a sale statement). It is not a tax invoice (the project does no tax work).
export function renderInvoice(data: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: `${invoiceTitle(data.viewer)} ${data.invoiceNumber}` } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(22).text(invoiceTitle(data.viewer), { align: "left" });
    doc.moveDown(0.3).fontSize(11).fillColor("#555");
    for (const line of invoiceHeaderLines(data)) doc.text(line);
    doc.fillColor("#000");
    doc.moveDown();
    doc.fontSize(11).text(`Seller: ${data.sellerUsername}`).text(`Buyer: ${data.buyerUsername}`);
    doc.moveDown().fontSize(12).text(data.viewer === "buyer" ? "Deliver to" : "Delivered to", { underline: true });
    const a = data.shipping.address;
    const place = [a.city, SHIPPING_COUNTRIES[a.country as ShippingCountry] ?? a.country].join(", ");
    doc.fontSize(11).text(data.viewer === "buyer" ? addressLines(a as ShippingAddress).join("\n") : place);
    doc.moveDown().fontSize(12).text(data.viewer === "buyer" ? "Items" : "Sale", { underline: true });
    const rows = invoiceRows(data);
    rows.forEach((r, i) => {
      if (r.bold && i > 0) doc.moveDown(0.3).moveTo(50, doc.y).lineTo(545, doc.y).stroke().moveDown(0.5);
      doc.font(r.bold ? "Helvetica-Bold" : "Helvetica").fontSize(11);
      const y = doc.y;
      doc.text(r.label, 50, y, { width: 380 });
      doc.text(r.amount, 430, y, { width: 115, align: "right" });
      doc.moveDown(0.3);
    });
    const note = data.viewer === "buyer" ? "This is a receipt for a payment made on the auction site. It is not a tax invoice." : "This is a statement of a sale made on the auction site. It is not a tax invoice.";
    doc.font("Helvetica").fontSize(9).fillColor("#666").text(note, 50, doc.y + 24, { width: 495 });
    doc.end();
  });
}
