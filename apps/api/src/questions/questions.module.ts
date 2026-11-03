import { Module } from "@nestjs/common";
import { QuestionEvents } from "./question-events";
import { QuestionRetentionService } from "./question-retention.service";
import { QuestionsController } from "./questions.controller";
import { QuestionsService } from "./questions.service";

@Module({ controllers: [QuestionsController], providers: [QuestionsService, QuestionEvents, QuestionRetentionService], exports: [QuestionEvents] })
export class QuestionsModule {}
