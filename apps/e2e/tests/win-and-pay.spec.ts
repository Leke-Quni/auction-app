import { expect, test } from "@playwright/test";
import { createLiveListing, db, deleteListing, deletePerson, newPerson, signUp } from "./helpers";

// Needs the API to use the fake payment provider (no STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET); with real Stripe keys the
// pay step would leave for Stripe's own page, so the spec skips itself there. See docs/REMAINING-WORK.md.
const title = `E2E win and pay ${Date.now()}`;
const winner = newPerson();
let listing: { listingId: string; sellerId: string };

test.beforeAll(async () => {
  listing = await createLiveListing(title, 2500);
});

test.afterAll(async () => {
  await db().query('DELETE FROM "PendingEndEmail" WHERE "listingId" = $1', [listing.listingId]);
  await db().query('DELETE FROM "Order" WHERE "listingId" = $1', [listing.listingId]);
  await deleteListing(listing.listingId, listing.sellerId);
  await deletePerson(winner.email);
});

test("the high bidder wins when the auction ends, chooses delivery, pays with the test card, and the order is paid", async ({ page }) => {
  await signUp(page, winner);
  const account = { name: "Pickup Pat", line1: "Rruga Dardania 5", city: "Prizren", postcode: "20000", country: "XK", phone: "+38344765432" };
  await db().query('UPDATE "User" SET "pickupAddress" = $1 WHERE "email" = $2', [JSON.stringify(account), winner.email]);
  await page.goto(`/listings/${listing.listingId}`);
  await page.getByLabel("Your maximum bid (€)").fill("25");
  await page.getByRole("button", { name: "Place bid" }).click();
  await page.getByRole("button", { name: "Confirm bid of €25.00" }).click();
  await expect(page.getByText("You are the highest bidder at €25.00.")).toBeVisible();

  // End the auction now; the API's sweep (every 10 seconds) closes it and creates the order.
  await db().query('UPDATE "Listing" SET "endsAt" = now() - interval \'1 second\' WHERE "id" = $1', [listing.listingId]);
  let orderId = "";
  await expect
    .poll(
      async () => {
        const r = await db().query<{ id: string }>('SELECT "id" FROM "Order" WHERE "listingId" = $1', [listing.listingId]);
        orderId = r.rows[0]?.id ?? "";
        return orderId;
      },
      { timeout: 45_000, intervals: [1000] },
    )
    .not.toBe("");

  await page.goto(`/orders/${orderId}`);
  await expect(page.getByText(title).first()).toBeVisible();

  await page.goto(`/orders/${orderId}/shipping`);
  // The form starts from the address saved in the account, and every field can be changed.
  await expect(page.locator('input[name="name"]')).toHaveValue("Pickup Pat");
  await expect(page.locator('input[name="city"]')).toHaveValue("Prizren");
  await page.locator('input[name="name"]').fill("Ada Buyer");
  await page.locator('input[name="line1"]').fill("Rruga Nene Tereza 10");
  await page.locator('input[name="city"]').fill("Prishtina");
  await page.locator('input[name="postcode"]').fill("10000");
  await page.locator('select[name="country"]').selectOption("XK");
  await page.getByLabel("Phone number").fill("44123456");
  await page.getByRole("button", { name: /^Continue to payment/ }).click();

  await page.waitForURL(/\/orders\/[^/]+\/checkout(\?|$)|stripe\.com/);
  test.skip(!/\/checkout(\?|$)/.test(page.url()), "The API is using Stripe, not the fake payment provider.");
  await page.getByRole("button", { name: "Pay with test card" }).click();
  await page.waitForURL(new RegExp(`/orders/${orderId}$`));

  await expect(page.getByText("Payment received. Thank you!")).toBeVisible();
  const row = await db().query<{ status: string; invoiceNumber: string | null }>('SELECT "status", "invoiceNumber" FROM "Order" WHERE "id" = $1', [orderId]);
  expect(row.rows[0]!.status).toBe("PAID");
  expect(row.rows[0]!.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);
});
