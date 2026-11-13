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

  const amount = page.getByLabel("Your maximum bid (€)");
  await amount.fill("5");
  await page.getByRole("button", { name: "Place bid" }).click();
  await expect(page.getByText("Your bid must be at least €10.00.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Confirm bid/ })).toHaveCount(0);

  await amount.fill("10");
  await page.getByRole("button", { name: "Place bid" }).click();
  await expect(page.getByText("You cannot lower or withdraw it.")).toBeVisible();
  await page.getByRole("button", { name: "Confirm bid of €10.00" }).click();
  await expect(page.getByText("You are the highest bidder at €10.00.")).toBeVisible();
  await expect(page.getByText("Current bid")).toBeVisible();

  const other = await browser.newContext();
  const benPage = await other.newPage();
  try {
    await signUp(benPage, ben);
    await benPage.goto(`/listings/${listing.listingId}`);
    await expect(benPage.getByLabel("Your maximum bid (€)")).toHaveValue("11.00");
    await benPage.getByRole("button", { name: "Place bid" }).click();
    await benPage.getByRole("button", { name: "Confirm bid of €11.00" }).click();
    await expect(benPage.getByText("You are the highest bidder at €11.00.")).toBeVisible();
  } finally {
    await other.close();
  }

  await expect(page.getByText(/outbid/i).first()).toBeVisible();
  const row = await db().query<{ bidCount: number; currentBidCents: number }>('SELECT "bidCount", "currentBidCents" FROM "Listing" WHERE "id" = $1', [listing.listingId]);
  expect(row.rows[0]).toEqual({ bidCount: 2, currentBidCents: 1100 });
});

test("a bid below the leader's hidden maximum is defended, a higher maximum takes the lead, and the leader can raise theirs without moving the price", async ({ page, browser }) => {
  const defended = await createLiveListing(`E2E defended ${Date.now()}`);
  const leader = newPerson();
  const challenger = newPerson();
  const other = await browser.newContext();
  const challengerPage = await other.newPage();
  const bidRows = () =>
    db().query<{ kind: string; amountCents: number; maxCents: number | null; who: string }>(
      'SELECT b."kind", b."amountCents", b."maxCents", u."username" AS who FROM "Bid" b JOIN "User" u ON u."id" = b."bidderId" WHERE b."listingId" = $1 ORDER BY b."seq"',
      [defended.listingId],
    );
  const state = async () => (await db().query<{ currentBidCents: number; bidCount: number }>('SELECT "currentBidCents", "bidCount" FROM "Listing" WHERE "id" = $1', [defended.listingId])).rows[0];
  const bid = async (who: typeof page, maximum: string) => {
    await who.getByLabel("Your maximum bid (€)").fill(maximum);
    await who.getByRole("button", { name: "Place bid" }).click();
    await who.getByRole("button", { name: `Confirm bid of €${Number(maximum).toFixed(2)}` }).click();
  };
  try {
    // The leader sets a hidden maximum of 50 and pays only the starting price.
    await signUp(page, leader);
    await page.goto(`/listings/${defended.listingId}`);
    await bid(page, "50");
    await expect(page.getByText("You are the highest bidder at €10.00.")).toBeVisible();
    await expect(page.getByText("Your maximum: €50.00")).toBeVisible();

    // The challenger bids 20, below it: told at once, and the price moves one step above their maximum.
    await signUp(challengerPage, challenger);
    await challengerPage.goto(`/listings/${defended.listingId}`);
    await bid(challengerPage, "20");
    await expect(challengerPage.getByText("Someone has a higher maximum. The price is now €21.00.")).toBeVisible();
    await expect(challengerPage.getByRole("button", { name: "Raise your maximum" })).toBeVisible();

    // The leader's page follows live, is not told they were outbid, and no longer quotes the old price.
    await expect(page.locator("tr", { hasText: "Current bid" }).locator("td")).toHaveText("€21.00");
    await expect(page.getByText("You are the highest bidder at €10.00.")).toHaveCount(0);
    await expect(page.getByText("You've been outbid")).toHaveCount(0);
    expect((await bidRows()).rows.map((r) => [r.kind, r.amountCents, r.maxCents, r.who === leader.username])).toEqual([
      ["BID", 1000, 5000, true],
      ["BID", 2000, 2000, false],
      ["AUTO", 2100, null, true],
    ]);

    // A maximum of 60 beats the hidden 50: the challenger leads at 52.50 and the old leader is outbid, live.
    await bid(challengerPage, "60");
    await expect(challengerPage.getByText("Your maximum: €60.00")).toBeVisible();
    await expect(page.getByText("You've been outbid")).toBeVisible();
    expect(await state()).toEqual({ currentBidCents: 5250, bidCount: 5 });

    // Raising their own maximum changes no price and adds no row to the history.
    await challengerPage.getByLabel("Raise your maximum (€)").fill("80");
    await challengerPage.getByRole("button", { name: "Raise maximum" }).click();
    await challengerPage.getByRole("button", { name: "Confirm new maximum of €80.00" }).click();
    await expect(challengerPage.getByText("Your maximum is now €80.00.")).toBeVisible();
    expect(await state()).toEqual({ currentBidCents: 5250, bidCount: 5 });
    expect((await bidRows()).rows.filter((r) => r.kind === "RAISE")).toHaveLength(1);
  } finally {
    await other.close();
    await deleteListing(defended.listingId, defended.sellerId);
    await deletePerson(leader.email);
    await deletePerson(challenger.email);
  }
});
