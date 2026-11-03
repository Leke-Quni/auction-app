import { Module } from "@nestjs/common";
import { BidsModule } from "../bids/bids.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { QuestionsModule } from "../questions/questions.module";
import { NotificationsService } from "./notifications.service";
import { QuestionNotificationsService } from "./question-notifications.service";
import { RealtimeGateway } from "./realtime.gateway";

@Module({ imports: [BidsModule, NotificationsModule, QuestionsModule], providers: [RealtimeGateway, NotificationsService, QuestionNotificationsService] })
export class RealtimeModule {}
