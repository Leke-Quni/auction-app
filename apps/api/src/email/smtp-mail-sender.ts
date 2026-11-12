import { Logger, ServiceUnavailableException } from "@nestjs/common";
import nodemailer, { type Transporter } from "nodemailer";
import type { MailAttachment, MailSender } from "./mail-sender";

// Sample accounts made by the seed script have addresses that can never receive mail. Sending to one is skipped, not failed.
const SAMPLE_ADDRESS = /@seed\.local$/i;

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
}

export class SmtpMailSender implements MailSender {
  private readonly logger = new Logger("Mail");
  private readonly transport: Transporter;

  constructor(
    config: SmtpConfig,
    private readonly from: string,
    transport?: Transporter,
  ) {
    this.transport =
      transport ??
      nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.port === 465,
        auth: { user: config.user, pass: config.pass },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 10_000,
      });
  }

  async send(to: string, subject: string, text: string, attachments: MailAttachment[] = []) {
    if (SAMPLE_ADDRESS.test(to)) return;
    try {
      await this.transport.sendMail({
        from: this.from,
        to,
        subject,
        text,
        attachments: attachments.map((a) => ({ filename: a.filename, content: a.content })),
      });
    } catch (error) {
      this.logger.error(`SMTP send failed: ${(error as Error).message}`);
      throw new ServiceUnavailableException("We couldn't send the email. Try again.");
    }
  }
}
