import { SOCKET_EVENTS, type UnreadEvent } from "@auction/shared";
import { Injectable, Logger } from "@nestjs/common";
import { SavedNotificationsService, type NewNotification } from "../notifications/saved-notifications.service";
import { RealtimeGateway } from "./realtime.gateway";

// Saves a notification for the bell and tells each person's open pages their new unread count. Best effort: a failure is
// logged and never reaches the caller, because the thing being announced has already happened.
@Injectable()
export class Notify {
  private readonly log = new Logger(Notify.name);

  constructor(
    private readonly saved: SavedNotificationsService,
    private readonly gateway: RealtimeGateway,
  ) {}

  async saveAndAnnounce(userIds: string[], notification: NewNotification) {
    try {
      const unread = await this.saved.save(userIds, notification);
      for (const [userId, unreadCount] of unread) this.gateway.emitToUsers([userId], SOCKET_EVENTS.unread, { unreadCount } satisfies UnreadEvent);
    } catch (error) {
      this.log.error(`Could not save a notification: ${(error as Error).message}`);
    }
  }
}
