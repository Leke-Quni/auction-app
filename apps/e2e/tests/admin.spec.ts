import { expect, test } from "@playwright/test";
import { createBareUser, createLiveListing, db, deleteListing, deletePerson, newPerson, signUp, useKnownCode } from "./helpers";

const ADMIN_URL = process.env.E2E_ADMIN_URL ?? "http://localhost:3001";
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
  const made = await db().query<{ id: string }>('UPDATE "User" SET "role" = \'ADMIN\' WHERE "email" = $1 RETURNING "id"', [admin.email]);
  adminId = made.rows[0]!.id;

  await page.goto(`${ADMIN_URL}/sign-in`);
  await page.locator('input[name="email"]').fill(admin.email);
  await page.locator('input[name="password"]').fill(admin.password);
  await page.locator("form button").first().click();
  await page.getByPlaceholder("123456").waitFor();
  await page.getByPlaceholder("123456").fill(await useKnownCode(admin.email));
  await page.locator("form button").first().click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  page.on("dialog", (dialog) => void dialog.accept());

  await page.goto(`${ADMIN_URL}/users?q=${victim.username}`);
  await page.getByRole("link", { name: victim.username }).first().click();
  await page.locator('textarea[name="reason"]').fill("Selling fake goods");
  await page.getByRole("button", { name: "Ban account" }).click();
  await expect(page.getByText(/^Banned /)).toBeVisible();
  const banned = await db().query<{ bannedAt: Date | null; banReason: string | null }>('SELECT "bannedAt", "banReason" FROM "User" WHERE "id" = $1', [victim.id]);
  expect(banned.rows[0]!.bannedAt).not.toBeNull();
  expect(banned.rows[0]!.banReason).toBe("Selling fake goods");

  await page.goto(`${ADMIN_URL}/listings?q=${encodeURIComponent(title)}`);
  await page.getByRole("link", { name: title }).click();
  await page.locator('textarea[name="reason"]').fill("Prohibited item");
  await page.getByRole("button", { name: "Remove listing" }).click();
  await expect(page.getByText(/^Removed /)).toBeVisible();
  const removed = await db().query<{ removedAt: Date | null; outcome: string | null }>('SELECT "removedAt", "outcome" FROM "Listing" WHERE "id" = $1', [listing.listingId]);
  expect(removed.rows[0]!.removedAt).not.toBeNull();
  expect(removed.rows[0]!.outcome).toBe("NO_BIDS");

  await page.goto(`${ADMIN_URL}/audit?adminId=${adminId}`);
  await expect(page.getByRole("cell", { name: "Banned a user" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Removed a listing" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Prohibited item" })).toBeVisible();
});
