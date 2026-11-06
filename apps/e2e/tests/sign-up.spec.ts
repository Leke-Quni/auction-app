import { expect, test } from "@playwright/test";
import { closeDb, deletePerson, newPerson, useKnownCode } from "./helpers";

const person = newPerson();

test.afterAll(async () => {
  await deletePerson(person.email);
  await closeDb();
});

test("a visitor signs up, confirms the emailed code, and is signed in; then signs out and back in", async ({ page }) => {
  await page.goto("/sign-up");
  await page.locator('input[name="firstName"]').fill(person.firstName);
  await page.locator('input[name="lastName"]').fill(person.lastName);
  await page.locator('input[name="username"]').fill(person.username);
  await page.locator('input[name="email"]').fill(person.email);
  await page.locator('input[name="password"]').fill(person.password);
  await page.locator('input[name="confirmPassword"]').fill(person.password);
  await page.getByRole("button", { name: "Sign up" }).click();

  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await page.getByPlaceholder("123456").fill(await useKnownCode(person.email));
  await page.getByRole("button", { name: "Verify and sign in" }).click();

  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByRole("menu")).toContainText(`Signed in as ${person.username}`);

  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();

  await page.goto("/sign-in");
  await page.getByPlaceholder("Email").fill(person.email);
  await page.getByPlaceholder("Password").fill(person.password);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await page.getByPlaceholder("123456").fill(await useKnownCode(person.email));
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByRole("menu")).toContainText(`Signed in as ${person.username}`);
});

test("a wrong code is refused and the visitor stays signed out", async ({ page }) => {
  const other = newPerson();
  try {
    await page.goto("/sign-up");
    await page.locator('input[name="firstName"]').fill(other.firstName);
    await page.locator('input[name="lastName"]').fill(other.lastName);
    await page.locator('input[name="username"]').fill(other.username);
    await page.locator('input[name="email"]').fill(other.email);
    await page.locator('input[name="password"]').fill(other.password);
    await page.locator('input[name="confirmPassword"]').fill(other.password);
    await page.getByRole("button", { name: "Sign up" }).click();
    await page.getByPlaceholder("123456").fill("000000");
    await page.getByRole("button", { name: "Verify and sign in" }).click();
    await expect(page.getByText(/wrong|expired|invalid|incorrect/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Account menu" })).toHaveCount(0);
  } finally {
    await deletePerson(other.email);
  }
});
