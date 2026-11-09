import type { Logger } from "@nestjs/common";
import type { Prisma } from "../db/db.module";
import type { MailSender } from "../email/mail-sender";

// Tells a person their suspension was lifted. Best effort and never throws: the unban stands whether or not the email goes.
// Callers do not await it, so a slow mail provider cannot hold up the admin's request.
export async function emailUnbanNotice(prisma: Prisma, mail: MailSender, log: Logger, userId: string) {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) return;
    await mail.send(user.email, "Your account has been restored", "A moderator has lifted the suspension on your account. You can sign in, bid and sell again.");
  } catch (error) {
    log.error(`Could not email the unban notice to ${userId}: ${(error as Error).message}`);
  }
}
