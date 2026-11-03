import { Module } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller";
import { SavedNotificationsService } from "./saved-notifications.service";

@Module({ controllers: [NotificationsController], providers: [SavedNotificationsService], exports: [SavedNotificationsService] })
export class NotificationsModule {}
