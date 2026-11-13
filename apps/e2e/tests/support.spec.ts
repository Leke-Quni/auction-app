import { expect, test } from "@playwright/test";
import { ADMIN_URL, db, deletePerson, newPerson, signInToAdmin, signUp } from "./helpers";

const user = newPerson();
const admin = newPerson();
let adminId = "";
let userId = "";
let strikeId = "";

test.afterAll(async () => {
  if (adminId) await db().query('DELETE FROM "AdminAction" WHERE "adminId" = $1', [adminId]);
  await deletePerson(user.email);
  await deletePerson(admin.email);
});

test("a person with a strike appeals it from the support page, and an admin clears it from the Support queue", async ({ page, browser }) => {
  await signUp(page, user);
  const row = await db().query<{ id: string }>('SELECT "id" FROM "User" WHERE "email" = $1', [user.email]);
  userId = row.rows[0]!.id;
  strikeId = `e2e_strike_${userId.slice(-8)}`;
  await db().query('INSERT INTO "Strike" ("id", "userId", "orderId", "reason", "givenById") VALUES ($1, $2, $3, \'Abusive messages\', \'someone\')', [strikeId, userId, `${strikeId}_order`]);

  await page.goto("/support?appeal");
  await expect(page.getByLabel("Appeal a strike")).toBeChecked();
  await expect(page.locator('select[name="strikeId"]')).toContainText("given by an admin (Abusive messages)");
  await page.locator('textarea[name="message"]').fill("It was a joke between friends, please clear it.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Your appeal was sent. We will answer by email.")).toBeVisible();

  // A second appeal for the same strike is not possible while the first waits: the appeal option is off, the page says why, and Send is off.
  await page.reload();
  await expect(page.getByRole("radio", { name: "Appeal a strike" })).toBeDisabled();
  await expect(page.getByText("(your appeal was sent, we will answer by email)")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  try {
    await signUp(adminPage, admin);
    adminId = await signInToAdmin(adminPage, admin);
    adminPage.on("dialog", (dialog) => void dialog.accept());
    await adminPage.goto(`${ADMIN_URL}/support`);
    const item = adminPage.locator("li", { hasText: user.username });
    await expect(item).toContainText("It was a joke between friends");
    await expect(item).toContainText("Abusive messages");
    await item.getByRole("button", { name: "Clear the strike and close" }).click();
    await expect(adminPage.locator("li", { hasText: user.username })).toHaveCount(0);
  } finally {
    await adminContext.close();
  }

  const strikes = await db().query('SELECT 1 FROM "Strike" WHERE "id" = $1', [strikeId]);
  expect(strikes.rowCount).toBe(0);
  const request = await db().query<{ status: string }>('SELECT "status" FROM "SupportRequest" WHERE "userId" = $1', [userId]);
  expect(request.rows).toEqual([{ status: "HANDLED" }]);
});
