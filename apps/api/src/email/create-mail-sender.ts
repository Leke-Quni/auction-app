import { ConsoleMailSender, type MailSender } from "./mail-sender";
import { ResendMailSender } from "./resend-mail-sender";

// Resend's sandbox sender, which only delivers to the Resend account's own email address.
export const DEFAULT_MAIL_FROM = "Auctionly <onboarding@resend.dev>";

export function createMailSender(env: Record<string, string | undefined> = process.env): MailSender {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (apiKey) return new ResendMailSender(apiKey, env.MAIL_FROM?.trim() || DEFAULT_MAIL_FROM);

  // Printing codes to the log is a development convenience. In production it would leak them, so refuse to start.
  if (env.NODE_ENV === "production") {
    throw new Error("RESEND_API_KEY is required in production. Set it with: fly secrets set RESEND_API_KEY=...");
  }
  return new ConsoleMailSender();
}
