import { expect, test } from "@playwright/test";
import { ADMIN_URL, createBareUser, createLiveListing, db, deleteListing, deletePerson, newPerson, signInToAdmin, signUp } from "./helpers";

const admin = newPerson();
const title = `E2E moderation ${Date.now()}`;
let listing: { listingId: string; sellerId: string };
let victim: Awaited<ReturnType<typeof createBareUser>>;
let adminId = "";

test.beforeAll(async () => {
  listing = await createLiveListing(title);
  victim = await createBareUser("e2e_v");
});

test.afterAll(async () => {
  await db().query('DELETE FROM "Order" WHERE "listingId" = $1', [listing.listingId]);
  if (adminId) await db().query('DELETE FROM "AdminAction" WHERE "adminId" = $1', [adminId]);
  await db().query('DELETE FROM "PendingEndEmail" WHERE "listingId" = $1', [listing.listingId]);
  await deleteListing(listing.listingId, listing.sellerId);
  await deletePerson(admin.email);
  await db().query('DELETE FROM "User" WHERE "id" = $1', [victim.id]);
});

test("an admin signs in to the admin app, bans a user, removes a listing, and both show in the audit log", async ({ page, browser }) => {
  // An admin starts as an ordinary account (the storefront sign-up gives it a password); only the database makes it an admin.
  const storefront = await browser.newContext();
  await signUp(await storefront.newPage(), admin);
  await storefront.close();
  adminId = await signInToAdmin(page, admin);

  page.on("dialog", (dialog) => void dialog.accept());

  await page.goto(`${ADMIN_URL}/users?q=${victim.username}`);
  await page.getByRole("link", { name: victim.username }).first().click();
  await page.locator("form", { hasText: "Give a strike" }).locator("textarea").fill("Abusive messages");
  await page.getByRole("button", { name: "Give a strike" }).click();
  await expect(page.getByText("given by an admin")).toBeVisible();
  await expect(page.getByText("Abusive messages")).toBeVisible();

  await page.locator("form", { hasText: "Ban account" }).locator("textarea").fill("Selling fake goods");
  await page.getByRole("button", { name: "Ban account" }).click();
  await expect(page.getByText(/^Banned /)).toBeVisible();
  const banned = await db().query<{ bannedAt: Date | null; banReason: string | null }>('SELECT "bannedAt", "banReason" FROM "User" WHERE "id" = $1', [victim.id]);
  expect(banned.rows[0]!.bannedAt).not.toBeNull();
  expect(banned.rows[0]!.banReason).toBe("Selling fake goods");

  // The seller's page lists their listings (and the auctions they bid on, none here), and the Listings page can show only them.
  await page.goto(`${ADMIN_URL}/users/${listing.sellerId}`);
  await expect(page.getByRole("heading", { name: "Listings" })).toBeVisible();
  await expect(page.getByRole("link", { name: title })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Auctions they bid on" })).toBeVisible();
  await page.getByRole("link", { name: "Open in the Listings page" }).click();
  await expect(page.getByText("Showing only the listings of")).toBeVisible();
  await expect(page.getByRole("link", { name: title })).toBeVisible();

  await page.goto(`${ADMIN_URL}/listings?q=${encodeURIComponent(title)}`);
  await page.getByRole("link", { name: title }).click();
  await page.locator('textarea[name="reason"]').fill("Prohibited item");
  await page.getByRole("button", { name: "Remove listing" }).click();
  await expect(page.getByText(/^Removed /)).toBeVisible();
  const removed = await db().query<{ removedAt: Date | null; outcome: string | null }>('SELECT "removedAt", "outcome" FROM "Listing" WHERE "id" = $1', [listing.listingId]);
  expect(removed.rows[0]!.removedAt).not.toBeNull();
  expect(removed.rows[0]!.outcome).toBe("NO_BIDS");

  // A paid order of this listing's seller: the admin opens it and downloads both invoices (the listing above is removed, so any
  // listing will do; the order is made straight in the database).
  const buyer = await createBareUser("e2e_b");
  const orderId = `e2e_order_${buyer.id.slice(-8)}`;
  await db().query(
    `INSERT INTO "Order" ("id", "listingId", "buyerId", "sellerId", "amountCents", "feeCents", "sellerNetCents", "payBy", "status", "paidAt", "shippingAddress", "shippingOption", "shippingCents", "totalCents", "invoiceNumber", "updatedAt")
     VALUES ($1, $2, $3, $4, 4500, 225, 4275, now(), 'PAID', now(), $5, $6, 900, 5400, $7, now())`,
    [orderId, listing.listingId, buyer.id, listing.sellerId, JSON.stringify({ name: "Ada Buyer", line1: "Rruga 1", city: "Prishtina", postcode: "10000", country: "XK", phone: "+38344123456" }), JSON.stringify({ id: "standard", name: "Standard", estimatedDays: 5, tracked: false, insured: false, priceCents: 900 }), `INV-2026-${Date.now().toString().slice(-6)}`],
  );
  try {
    await page.goto(`${ADMIN_URL}/orders/${orderId}`);
    await expect(page.getByRole("link", { name: /Buyer's invoice/ })).toBeVisible();
    for (const party of ["buyer", "seller"]) {
      const res = await page.request.get(`${ADMIN_URL}/orders/${orderId}/invoice/${party}`);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toContain("application/pdf");
      expect((await res.body()).subarray(0, 4).toString()).toBe("%PDF");
    }
  } finally {
    await db().query('DELETE FROM "Order" WHERE "id" = $1', [orderId]);
    await db().query('DELETE FROM "User" WHERE "id" = $1', [buyer.id]);
  }

  await page.goto(`${ADMIN_URL}/audit?adminId=${adminId}`);
  await expect(page.getByRole("cell", { name: "Opened an invoice" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "Banned a user" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Removed a listing" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Prohibited item" })).toBeVisible();
});
