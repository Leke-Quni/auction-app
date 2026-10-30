import { Injectable, Logger } from "@nestjs/common";

export const MAIL_SENDER = Symbol("MAIL_SENDER");

export interface MailSender {
  send(to: string, subject: string, text: string): Promise<void>;
}

@Injectable()
export class ConsoleMailSender implements MailSender {
  private readonly logger = new Logger("Mail");

  async send(to: string, subject: string, text: string) {
    this.logger.log(`To: ${to}\nSubject: ${subject}\n${text}`);
  }
}
