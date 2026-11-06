import { expect, test } from "@playwright/test";
import { createLiveListing, db, deleteListing, deletePerson, newPerson, signUp } from "./helpers";

const title = `E2E bidding ${Date.now()}`;
const anna = newPerson();
const ben = newPerson();
let listing: { listingId: string; sellerId: string };

test.beforeAll(async () => {
  listing = await createLiveListing(title);
});

test.afterAll(async () => {
  await deleteListing(listing.listingId, listing.sellerId);
  await deletePerson(anna.email);
  await deletePerson(ben.email);
});

test("a bidder bids after a second click, is outbid live by someone else, and cannot bid below the minimum", async ({ page, browser }) => {
  await signUp(page, anna);
  await page.goto(`/listings/${listing.listingId}`);
  await expect(page.getByText("Starting price")).toBeVisible();

  const amount = page.getByLabel("Your bid (€)");
  await amount.fill("5");
  await page.getByRole("button", { name: "Place bid" }).click();
  await expect(page.getByText("Your bid must be at least €10.00.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Confirm bid/ })).toHaveCount(0);

  await amount.fill("10");
  await page.getByRole("button", { name: "Place bid" }).click();
  await expect(page.getByText("A bid cannot be withdrawn.").first()).toBeVisible();
  await page.getByRole("button", { name: "Confirm bid of €10.00" }).click();
  await expect(page.getByText("Your bid was placed.")).toBeVisible();
  await expect(page.getByText("Current bid")).toBeVisible();

  const other = await browser.newContext();
  const benPage = await other.newPage();
  try {
    await signUp(benPage, ben);
    await benPage.goto(`/listings/${listing.listingId}`);
    await expect(benPage.getByLabel("Your bid (€)")).toHaveValue("11.00");
    await benPage.getByRole("button", { name: "Place bid" }).click();
    await benPage.getByRole("button", { name: "Confirm bid of €11.00" }).click();
    await expect(benPage.getByText("Your bid was placed.")).toBeVisible();
  } finally {
    await other.close();
  }

  await expect(page.getByText(/outbid/i).first()).toBeVisible();
  const row = await db().query<{ bidCount: number; currentBidCents: number }>('SELECT "bidCount", "currentBidCents" FROM "Listing" WHERE "id" = $1', [listing.listingId]);
  expect(row.rows[0]).toEqual({ bidCount: 2, currentBidCents: 1100 });
});
