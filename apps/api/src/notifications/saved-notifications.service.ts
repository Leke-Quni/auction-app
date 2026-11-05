import { NOTIFICATION_LIST_SIZE, NOTIFICATION_TTL_DAYS, type NotificationItem, type NotificationList } from "@auction/shared";
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PRISMA, type Prisma } from "../db/db.module";

const DAY_MS = 24 * 3600_000;
const PURGE_EVERY_MS = 60 * 60_000;

export interface NewNotification {
  type: NotificationItem["type"];
  // What it is about. A newer notification with the same key replaces the older one for that person.
  key: string;
  listingId: string;
  title: string;
  data: unknown;
}

// The notifications a person can read later in the bell. The live toast is only the first showing of one saved here.
@Injectable()
export class SavedNotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SavedNotificationsService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(@Inject(PRISMA) private readonly prisma: Prisma) {}

  onModuleInit() {
    void this.purgeExpired();
    this.timer = setInterval(() => void this.purgeExpired(), PURGE_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  // Saves one notification for each person, as unread and as new as now, replacing any with the same key. Returns how
  // many unread notifications each of them now has.
  async save(userIds: string[], notification: NewNotification): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + NOTIFICATION_TTL_DAYS * DAY_MS);
    const ids = userIds.map(() => randomUUID());
    await this.prisma.$executeRaw`
      INSERT INTO "Notification" ("id", "userId", "listingId", "type", "key", "title", "data", "createdAt", "expiresAt")
      SELECT u."id", u."userId", ${notification.listingId}, ${notification.type}::"NotificationType", ${notification.key},
             ${notification.title}, ${JSON.stringify(notification.data)}::jsonb, ${now}, ${expiresAt}
      FROM unnest(${ids}::text[], ${userIds}::text[]) AS u("id", "userId")
      ON CONFLICT ("userId", "key") DO UPDATE
      SET "type" = EXCLUDED."type", "title" = EXCLUDED."title", "data" = EXCLUDED."data", "readAt" = NULL,
          "createdAt" = EXCLUDED."createdAt", "expiresAt" = EXCLUDED."expiresAt"`;
    const counts = await this.prisma.$queryRaw<{ userId: string; unread: number }[]>`
      SELECT "userId", COUNT(*)::int AS "unread" FROM "Notification"
      WHERE "userId" = ANY(${userIds}::text[]) AND "readAt" IS NULL AND "expiresAt" > ${now}
      GROUP BY "userId"`;
    return new Map(userIds.map((id) => [id, counts.find((c) => c.userId === id)?.unread ?? 0]));
  }

  async list(userId: string): Promise<NotificationList> {
    const now = new Date();
    const [rows, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId, expiresAt: { gt: now } },
        orderBy: { createdAt: "desc" },
        take: NOTIFICATION_LIST_SIZE,
      }),
      this.unreadCount(userId, now),
    ]);
    // `data` was saved from the matching notice type, so the row is trusted to have that shape.
    const items = rows.map(
      (row) =>
        ({
          id: row.id,
          type: row.type,
          listingId: row.listingId,
          title: row.title,
          data: row.data,
          readAt: row.readAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        }) as unknown as NotificationItem,
    );
    return { items, unreadCount };
  }

  // Marking someone else's notification, or one already read, changes nothing.
  async markRead(userId: string, id: string): Promise<{ unreadCount: number }> {
    await this.prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
    return { unreadCount: await this.unreadCount(userId) };
  }

  // Removes one of the person's notifications (the X on it). Someone else's, or one already gone, changes nothing.
  async dismiss(userId: string, id: string): Promise<{ unreadCount: number }> {
    await this.prisma.notification.deleteMany({ where: { id, userId } });
    return { unreadCount: await this.unreadCount(userId) };
  }

  // Empties the person's inbox. A newer notice about the same thing later brings it back as a new one.
  async clear(userId: string): Promise<{ unreadCount: number }> {
    await this.prisma.notification.deleteMany({ where: { userId } });
    return { unreadCount: 0 };
  }

  unreadCount(userId: string, now = new Date()) {
    return this.prisma.notification.count({ where: { userId, readAt: null, expiresAt: { gt: now } } });
  }

  async purgeExpired() {
    try {
      await this.prisma.notification.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    } catch (error) {
      this.log.error(`Could not remove expired notifications: ${(error as Error).message}`);
    }
  }
}
