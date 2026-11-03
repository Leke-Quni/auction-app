import { answerSchema, questionSchema, voteSchema, type AnswerInput, type QuestionInput, type VoteInput } from "@auction/shared";
import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { JwtAuthGuard, OptionalJwtAuthGuard, type AuthUser } from "../auth/jwt-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { QuestionsService } from "./questions.service";

const listQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });

@Controller()
export class QuestionsController {
  constructor(private readonly questions: QuestionsService) {}

  @Get("listings/:id/questions")
  @UseGuards(OptionalJwtAuthGuard)
  list(@Param("id") id: string, @Req() req: { user?: AuthUser }, @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>) {
    return this.questions.list(id, query.limit, req.user?.id);
  }

  @Post("listings/:id/questions")
  @UseGuards(JwtAuthGuard)
  ask(@Param("id") id: string, @Req() req: { user: AuthUser }, @Body(new ZodValidationPipe(questionSchema)) body: QuestionInput) {
    return this.questions.ask(req.user.id, id, body.body);
  }

  @Post("questions/:id/answer")
  @UseGuards(JwtAuthGuard)
  answer(@Param("id") id: string, @Req() req: { user: AuthUser }, @Body(new ZodValidationPipe(answerSchema)) body: AnswerInput) {
    return this.questions.answer(req.user.id, id, body.body);
  }

  @Patch("questions/:id")
  @UseGuards(JwtAuthGuard)
  editQuestion(@Param("id") id: string, @Req() req: { user: AuthUser }, @Body(new ZodValidationPipe(questionSchema)) body: QuestionInput) {
    return this.questions.editQuestion(req.user.id, id, body.body);
  }

  @Patch("questions/:id/answer")
  @UseGuards(JwtAuthGuard)
  editAnswer(@Param("id") id: string, @Req() req: { user: AuthUser }, @Body(new ZodValidationPipe(answerSchema)) body: AnswerInput) {
    return this.questions.editAnswer(req.user.id, id, body.body);
  }

  @Put("questions/:id/vote")
  @UseGuards(JwtAuthGuard)
  vote(@Param("id") id: string, @Req() req: { user: AuthUser }, @Body(new ZodValidationPipe(voteSchema)) body: VoteInput) {
    return this.questions.vote(req.user.id, id, body.target, body.value);
  }

  @Delete("questions/:id")
  @UseGuards(JwtAuthGuard)
  deleteQuestion(@Param("id") id: string, @Req() req: { user: AuthUser }) {
    return this.questions.deleteQuestion(req.user.id, id);
  }

  @Delete("questions/:id/answer")
  @UseGuards(JwtAuthGuard)
  deleteAnswer(@Param("id") id: string, @Req() req: { user: AuthUser }) {
    return this.questions.deleteAnswer(req.user.id, id);
  }
}
