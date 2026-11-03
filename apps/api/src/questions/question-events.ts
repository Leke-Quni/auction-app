import { Injectable } from "@nestjs/common";
import { Subject } from "rxjs";

// Published only after the question or answer has been saved.
export type QuestionEvent =
  | { type: "QuestionAsked"; questionId: string; listingId: string; askerId: string; body: string }
  | { type: "QuestionAnswered"; questionId: string; listingId: string; askerId: string; sellerId: string; body: string };

@Injectable()
export class QuestionEvents {
  private readonly subject = new Subject<QuestionEvent>();
  readonly stream = this.subject.asObservable();

  publish(event: QuestionEvent) {
    this.subject.next(event);
  }
}
