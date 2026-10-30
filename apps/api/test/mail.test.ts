import { Logger, ServiceUnavailableException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMailSender, DEFAULT_MAIL_FROM } from "../src/email/create-mail-sender";
import { ConsoleMailSender } from "../src/email/mail-sender";
import { ResendMailSender } from "../src/email/resend-mail-sender";

const KEY = "re_test_super_secret_key";

describe("ResendMailSender", () => {
  let errors: string[];
  beforeEach(() => {
    errors = [];
    vi.spyOn(Logger.prototype, "error").mockImplementation((message: unknown) => {
      errors.push(String(message));
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const respond = (status: number, body = "{}") => vi.fn(async () => new Response(body, { status }));

  it("posts the email to Resend with the API key and a JSON body", async () => {
    const fetchMock = respond(200, '{"id":"abc"}');
    await new ResendMailSender(KEY, "Auctionly <a@b.co>", fetchMock as unknown as typeof fetch).send(
      "ana@example.com",
      "Your sign-in code",
      "Your sign-in code is 123456.",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      from: "Auctionly <a@b.co>",
      to: ["ana@example.com"],
      subject: "Your sign-in code",
      text: "Your sign-in code is 123456.",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("turns a rejection into a 503 and logs the reason without the API key", async () => {
    const sender = new ResendMailSender(KEY, "x", respond(403, '{"message":"You can only send testing emails to your own email address"}') as unknown as typeof fetch);
    const failure = await sender.send("other@example.com", "s", "t").catch((e) => e);
    expect(failure).toBeInstanceOf(ServiceUnavailableException);
    expect(failure.getStatus()).toBe(503);
    expect(failure.message).toBe("We couldn't send the email. Try again.");
    expect(errors.join("\n")).toContain("HTTP 403");
    expect(errors.join("\n")).toContain("only send testing emails");
    expect(errors.join("\n")).not.toContain(KEY);
  });

  it("turns a network failure or timeout into a 503", async () => {
    const down = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND api.resend.com");
    });
    const failure = await new ResendMailSender(KEY, "x", down as unknown as typeof fetch).send("a@b.co", "s", "t").catch((e) => e);
    expect(failure).toBeInstanceOf(ServiceUnavailableException);
    expect(errors.join("\n")).toContain("ENOTFOUND");
    expect(errors.join("\n")).not.toContain(KEY);
  });

  it("survives an error body it cannot read", async () => {
    const unreadable = vi.fn(async () => ({ ok: false, status: 500, text: async () => Promise.reject(new Error("boom")) }) as unknown as Response);
    const failure = await new ResendMailSender(KEY, "x", unreadable as unknown as typeof fetch).send("a@b.co", "s", "t").catch((e) => e);
    expect(failure).toBeInstanceOf(ServiceUnavailableException);
  });
});

describe("createMailSender", () => {
  it("uses Resend when a key is set, with the sandbox sender by default", () => {
    const sender = createMailSender({ RESEND_API_KEY: KEY });
    expect(sender).toBeInstanceOf(ResendMailSender);
    expect((sender as unknown as { from: string }).from).toBe(DEFAULT_MAIL_FROM);
  });

  it("uses MAIL_FROM when given", () => {
    const sender = createMailSender({ RESEND_API_KEY: KEY, MAIL_FROM: "Shop <hi@shop.example>" });
    expect((sender as unknown as { from: string }).from).toBe("Shop <hi@shop.example>");
  });

  it("falls back to printing to the log outside production", () => {
    expect(createMailSender({})).toBeInstanceOf(ConsoleMailSender);
    expect(createMailSender({ NODE_ENV: "development" })).toBeInstanceOf(ConsoleMailSender);
    expect(createMailSender({ NODE_ENV: "test" })).toBeInstanceOf(ConsoleMailSender);
  });

  it("treats a blank key as not set", () => {
    expect(createMailSender({ RESEND_API_KEY: "   " })).toBeInstanceOf(ConsoleMailSender);
    expect(() => createMailSender({ RESEND_API_KEY: "", NODE_ENV: "production" })).toThrow(/RESEND_API_KEY/);
  });

  it("refuses to start in production without a key, so codes never go to the log", () => {
    expect(() => createMailSender({ NODE_ENV: "production" })).toThrow(/RESEND_API_KEY is required in production/);
  });

  it("allows production when the key is set", () => {
    expect(createMailSender({ NODE_ENV: "production", RESEND_API_KEY: KEY })).toBeInstanceOf(ResendMailSender);
  });
});
