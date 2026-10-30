import { Logger, ServiceUnavailableException } from "@nestjs/common";
import type { MailSender } from "./mail-sender";

const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

export class ResendMailSender implements MailSender {
  private readonly logger = new Logger("Mail");

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(to: string, subject: string, text: string) {
    const unavailable = () => new ServiceUnavailableException("We couldn't send the email. Try again.");

    let response: Response;
    try {
      response = await this.fetchImpl(RESEND_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: this.from, to: [to], subject, text }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.error(`Could not reach Resend: ${(error as Error).message}`);
      throw unavailable();
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      this.logger.error(`Resend rejected the email (HTTP ${response.status}): ${body.slice(0, 300)}`);
      throw unavailable();
    }
  }
}
