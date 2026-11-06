import { config } from "dotenv";
import { createHmac, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import pg from "pg";

config({ path: resolve(__dirname, "../../../.env") });

const KNOWN_CODE = "123456";

let pool: pg.Pool | undefined;
export const db = () => (pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 }));
export const closeDb = () => pool?.end();

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
