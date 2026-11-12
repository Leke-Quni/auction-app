import { createHmac } from "node:crypto";
import { authSecret } from "../config";
import type { Prisma } from "../db/db.module";

// A one-way fingerprint of an email address. It cannot be turned back into the address, and it is only ever compared with another.
export const emailFingerprint = (email: string) => createHmac("sha256", authSecret()).update(`email-fingerprint:${email.trim().toLowerCase()}`).digest("hex");

// When an address is verified, the strikes of any deleted account that had this address move to the account that now owns it, so
// deleting an account and signing up again does not clear them. Safe to run again: once moved there is nothing left to move.
export async function inheritStrikes(prisma: Pick<Prisma, "$executeRaw">, userId: string, email: string) {
  const fingerprint = emailFingerprint(email);
  await prisma.$executeRaw`
    UPDATE "Strike" SET "userId" = ${userId}
    WHERE "userId" IN (SELECT "id" FROM "User" WHERE "emailFingerprint" = ${fingerprint} AND "deletedAt" IS NOT NULL AND "id" <> ${userId})`;
}
