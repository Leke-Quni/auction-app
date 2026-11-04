import { Injectable, Logger } from "@nestjs/common";

export const MAIL_SENDER = Symbol("MAIL_SENDER");

export interface MailAttachment {
  filename: string;
  content: Buffer;
}

export interface MailSender {
  send(to: string, subject: string, text: string, attachments?: MailAttachment[]): Promise<void>;
}

@Injectable()
export class ConsoleMailSender implements MailSender {
  private readonly logger = new Logger("Mail");

  async send(to: string, subject: string, text: string, attachments: MailAttachment[] = []) {
    const files = attachments.map((a) => `${a.filename} (${a.content.length} bytes)`).join(", ");
    this.logger.log(`To: ${to}\nSubject: ${subject}\n${text}${files ? `\nAttached: ${files}` : ""}`);
  }
}
