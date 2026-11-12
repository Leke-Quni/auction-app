import { ConsoleMailSender, type MailSender } from "./mail-sender";
import { ResendMailSender } from "./resend-mail-sender";
import { SmtpMailSender } from "./smtp-mail-sender";

// Resend's sandbox sender, which only delivers to the Resend account's own email address.
export const DEFAULT_MAIL_FROM = "Auctionly <onboarding@resend.dev>";

export function createMailSender(env: Record<string, string | undefined> = process.env): MailSender {
  const smtpUser = env.SMTP_USER?.trim();
  const smtpPass = env.SMTP_PASS?.trim();
  if (smtpUser && smtpPass) {
    const config = { host: env.SMTP_HOST?.trim() || "smtp.gmail.com", port: Number(env.SMTP_PORT) || 465, user: smtpUser, pass: smtpPass };
    return new SmtpMailSender(config, env.MAIL_FROM?.trim() || `Auctionly <${smtpUser}>`);
  }

  const apiKey = env.RESEND_API_KEY?.trim();
  if (apiKey) return new ResendMailSender(apiKey, env.MAIL_FROM?.trim() || DEFAULT_MAIL_FROM);

  // Printing codes to the log is a development convenience. In production it would leak them, so refuse to start.
  if (env.NODE_ENV === "production") {
    throw new Error("RESEND_API_KEY or SMTP_USER and SMTP_PASS are required in production. Set them with: fly secrets set ...");
  }
  return new ConsoleMailSender();
}
