import { ConflictException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Prisma } from "../db/db.module";

type Tx = Pick<Prisma, "user" | "strike" | "adminAction" | "$queryRaw">;

// An admin gives a person a strike. It counts like the one for an unpaid order (two block bidding) but has no order, so it takes
// an id of its own in the unique `orderId` column. An admin cannot be struck, like they cannot be banned. Written with its audit
// row in the caller's transaction.
export async function giveAdminStrike(tx: Tx, adminId: string, userId: string, reason: string, listingId?: string) {
  // The row lock makes a strike and a promotion of the same person (setRole) take turns, so an admin never ends up holding one.
  const [user] = await tx.$queryRaw<{ role: string }[]>`SELECT "role" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  if (!user) throw new NotFoundException();
  if (user.role === "ADMIN") throw new ConflictException({ code: "CANNOT_STRIKE_ADMIN", message: "An admin cannot be given a strike. Remove their admin role first." });
  const strike = await tx.strike.create({ data: { userId, listingId: listingId ?? null, orderId: `admin_${randomUUID()}`, reason, givenById: adminId } });
  await tx.adminAction.create({ data: { adminId, action: "STRIKE_USER", targetId: userId, reason } });
  return strike;
}
