import { SOCKET_EVENTS, type QuestionNotice } from "@auction/shared";
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { Subscription } from "rxjs";
import { webUrl } from "../config";
import { PRISMA, type Prisma } from "../db/db.module";
import { MAIL_SENDER, type MailSender } from "../email/mail-sender";
import { notificationKey } from "../notifications/notification-keys";
import { QuestionEvents } from "../questions/question-events";
import { Notify } from "./notify.service";
import { RealtimeGateway } from "./realtime.gateway";

const EXCERPT_LENGTH = 140;
const excerpt = (text: string) => (text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH - 1).trimEnd()}…` : text);

// Tells the seller when someone asks a question on their listing, and the asker when the seller answers: a live toast,
// a saved notification for the bell, and an email. Runs after the question or answer is saved, so a failure here is
// logged and never touches it.
@Injectable()
export class QuestionNotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(QuestionNotificationsService.name);
  private subscription?: Subscription;

  constructor(
    private readonly events: QuestionEvents,
    private readonly gateway: RealtimeGateway,
    private readonly notifier: Notify,
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
  ) {}

  onModuleInit() {
    this.subscription = this.events.stream.subscribe((event) => {
      const run = event.type === "QuestionAsked" ? this.onAsked(event) : this.onAnswered(event);
      run.catch((error) => this.log.error(`Could not send question notices: ${(error as Error).message}`));
    });
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
  }

  private async onAsked(event: Extract<Parameters<QuestionEvents["publish"]>[0], { type: "QuestionAsked" }>) {
    const [listing, asker] = await Promise.all([
      this.prisma.listing.findUnique({ where: { id: event.listingId }, select: { title: true, sellerId: true, seller: { select: { email: true } } } }),
      this.prisma.user.findUnique({ where: { id: event.askerId }, select: { username: true } }),
    ]);
    if (!listing || !asker) return;
    const notice: QuestionNotice = { listingId: event.listingId, questionId: event.questionId, title: listing.title, from: asker.username, excerpt: excerpt(event.body) };
    await this.notify(listing.sellerId, "QUESTION_ASKED", notificationKey.question(event.questionId), SOCKET_EVENTS.questionNotice, notice);
    await this.email(listing.seller.email, `New question on ${listing.title}`, [`${asker.username} asked a question on "${listing.title}":`, "", event.body, "", `Answer it: ${webUrl()}/listings/${event.listingId}`]);
  }

  private async onAnswered(event: Extract<Parameters<QuestionEvents["publish"]>[0], { type: "QuestionAnswered" }>) {
    const [listing, seller, asker] = await Promise.all([
      this.prisma.listing.findUnique({ where: { id: event.listingId }, select: { title: true } }),
      this.prisma.user.findUnique({ where: { id: event.sellerId }, select: { username: true } }),
      this.prisma.user.findUnique({ where: { id: event.askerId }, select: { email: true } }),
    ]);
    if (!listing || !seller || !asker) return;
    const notice: QuestionNotice = { listingId: event.listingId, questionId: event.questionId, title: listing.title, from: seller.username, excerpt: excerpt(event.body) };
    await this.notify(event.askerId, "QUESTION_ANSWERED", notificationKey.answer(event.questionId), SOCKET_EVENTS.answerNotice, notice);
    await this.email(asker.email, `${seller.username} answered your question on ${listing.title}`, [`${seller.username} answered your question on "${listing.title}":`, "", event.body, "", `${webUrl()}/listings/${event.listingId}`]);
  }

  // Saves the notification, tells the person's open pages the new unread count, and shows the toast. A failure to save
  // is logged and the toast still goes out.
  private async notify(userId: string, type: "QUESTION_ASKED" | "QUESTION_ANSWERED", key: string, socketEvent: string, notice: QuestionNotice) {
    await this.notifier.saveAndAnnounce([userId], { type, key, listingId: notice.listingId, title: notice.title, data: notice });
    this.gateway.emitToUsers([userId], socketEvent, notice);
  }

  private async email(to: string, subject: string, lines: string[]) {
    try {
      await this.mail.send(to, subject, lines.join("\n"));
    } catch (error) {
      this.log.error(`Could not email a question notice: ${(error as Error).message}`);
    }
  }
}
