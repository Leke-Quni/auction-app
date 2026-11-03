import { Module } from "@nestjs/common";
import { QuestionEvents } from "./question-events";
import { QuestionsController } from "./questions.controller";
import { QuestionsService } from "./questions.service";

@Module({ controllers: [QuestionsController], providers: [QuestionsService, QuestionEvents], exports: [QuestionEvents] })
export class QuestionsModule {}
