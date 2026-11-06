import type { Page } from "@playwright/test";
import { config } from "dotenv";
import { createHmac, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import pg from "pg";

config({ path: resolve(__dirname, "../../../.env") });

const KNOWN_CODE = "123456";

let pool: pg.Pool | undefined;
export const db = () => (pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 }));
// The pool is shared by every spec file in a worker and ends with the worker, so no spec closes it.

// The same HMAC the API uses (apps/api/src/auth/codes.ts) for a sign-in code.
const loginHash = (userId: string, code: string) => createHmac("sha256", process.env.AUTH_SECRET!).update(`login:${userId}:${code}`).digest("hex");

// Emailed codes are only stored hashed, so a test cannot read one. After the page asks for a code, this swaps it for a known
// one, as if that were what the email said.
export async function useKnownCode(email: string): Promise<string> {
  const user = await db().query<{ id: string }>('SELECT "id" FROM "User" WHERE "email" = $1', [email]);
  const id = user.rows[0]?.id;
  if (!id) throw new Error(`No account for ${email}`);
  await db().query('DELETE FROM "LoginCode" WHERE "userId" = $1', [id]);
  await db().query('INSERT INTO "LoginCode" ("id", "userId", "codeHash", "expiresAt") VALUES ($1, $2, $3, now() + interval \'10 minutes\')', [randomUUID(), id, loginHash(id, KNOWN_CODE)]);
  return KNOWN_CODE;
}

export const newPerson = () => {
  const n = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  return { firstName: "E2E", lastName: "Tester", username: `e2e_${n}`, email: `e2e-${n}@e2e.test`, password: "correct-horse-battery" };
};

// Removes what a test created. Accounts with bids or listings are not removed here.
export async function deletePerson(email: string) {
  await db().query('DELETE FROM "User" WHERE "email" = $1', [email]);
}

type Person = ReturnType<typeof newPerson>;

// Signs a new account up through the pages and ends signed in on the home page.
export async function signUp(page: Page, person: Person) {
  await page.goto("/sign-up");
  await page.locator('input[name="firstName"]').fill(person.firstName);
  await page.locator('input[name="lastName"]').fill(person.lastName);
  await page.locator('input[name="username"]').fill(person.username);
  await page.locator('input[name="email"]').fill(person.email);
  await page.locator('input[name="password"]').fill(person.password);
  await page.locator('input[name="confirmPassword"]').fill(person.password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.getByRole("heading", { name: "Check your email" }).waitFor();
  await page.getByPlaceholder("123456").fill(await useKnownCode(person.email));
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await page.getByRole("button", { name: "Account menu" }).waitFor();
}

// A seller who cannot sign in and one live auction of theirs, made straight in the database (photos upload to Vercel Blob,
// which a local run cannot reach). Returns the listing id.
export async function createLiveListing(title: string, startingPriceCents = 1000) {
  const sellerId = `e2e_seller_${randomUUID()}`;
  const listingId = `e2e_listing_${randomUUID()}`;
  const n = sellerId.slice(-8);
  await db().query(
    'INSERT INTO "User" ("id", "email", "firstName", "lastName", "username", "passwordHash", "emailVerified", "updatedAt") VALUES ($1, $2, \'E2E\', \'Seller\', $3, \'!\', now(), now())',
    [sellerId, `${n}@e2e.test`, `e2e_s_${n}`],
  );
  const category = await db().query<{ id: string }>('SELECT "id" FROM "Category" LIMIT 1');
  await db().query(
    `INSERT INTO "Listing" ("id", "sellerId", "title", "description", "categoryId", "condition", "startingPriceCents", "durationDays", "status", "startsAt", "endsAt", "publishedAt", "updatedAt")
     VALUES ($1, $2, $3, 'Made by the end-to-end tests.', $4, 'GOOD', $5, 3, 'PUBLISHED', now() - interval '1 day', now() + interval '2 days', now() - interval '1 day', now())`,
    [listingId, sellerId, title, category.rows[0]!.id, startingPriceCents],
  );
  return { listingId, sellerId };
}

export async function deleteListing(listingId: string, sellerId: string) {
  await db().query('DELETE FROM "PendingOutbidEmail" WHERE "listingId" = $1', [listingId]);
  await db().query('DELETE FROM "BidAudit" WHERE "listingId" = $1', [listingId]);
  await db().query('DELETE FROM "Notification" WHERE "listingId" = $1', [listingId]);
  await db().query('DELETE FROM "Bid" WHERE "listingId" = $1', [listingId]);
  await db().query('DELETE FROM "Listing" WHERE "id" = $1', [listingId]);
  await db().query('DELETE FROM "User" WHERE "id" = $1', [sellerId]);
}

// An account that cannot sign in (no usable password), made straight in the database.
export async function createBareUser(prefix: string) {
  const id = `e2e_user_${randomUUID()}`;
  const n = id.slice(-8);
  const username = `${prefix}_${n}`;
  await db().query(
    'INSERT INTO "User" ("id", "email", "firstName", "lastName", "username", "passwordHash", "emailVerified", "updatedAt") VALUES ($1, $2, \'E2E\', \'Victim\', $3, \'!\', now(), now())',
    [id, `${n}@e2e.test`, username],
  );
  return { id, username, email: `${n}@e2e.test` };
}

const ADMIN_URL = process.env.E2E_ADMIN_URL ?? "http://localhost:3001";
export { ADMIN_URL };

// Makes a new account (already signed up through the storefront) an admin in the database and signs it in to the admin app.
export async function signInToAdmin(page: Page, admin: Person): Promise<string> {
  const made = await db().query<{ id: string }>('UPDATE "User" SET "role" = \'ADMIN\' WHERE "email" = $1 RETURNING "id"', [admin.email]);
  await page.goto(`${ADMIN_URL}/sign-in`);
  await page.locator('input[name="email"]').fill(admin.email);
  await page.locator('input[name="password"]').fill(admin.password);
  await page.locator("form button").first().click();
  await page.getByPlaceholder("123456").waitFor();
  await page.getByPlaceholder("123456").fill(await useKnownCode(admin.email));
  await page.locator("form button").first().click();
  await page.getByRole("heading", { name: "Overview" }).waitFor();
  return made.rows[0]!.id;
}
