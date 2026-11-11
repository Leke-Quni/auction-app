import "reflect-metadata";
import { FORGOT_PASSWORD_RATE_LIMIT, SIGN_IN_IP_RATE_LIMIT, SIGN_IN_RATE_LIMIT, SIGN_UP_RATE_LIMIT } from "@auction/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { signViewerIp } from "../src/common/client-ip";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { MAIL_SENDER, type MailSender } from "../src/email/mail-sender";

const sent: { to: string }[] = [];
const fakeMail: MailSender = {
  async send(to) {
    sent.push({ to });
  },
};

const stamp = Date.now();
const password = "hunter22!";
const emails: string[] = [];
const newEmail = (tag: string) => {
  const email = `rl-${tag}-${stamp}@example.com`;
  emails.push(email);
  return email;
};
// A different address per run, because the counts live in Redis between runs.
const ipHeaders = (ip: string) => ({ "x-viewer-ip": ip, "x-viewer-ip-signature": signViewerIp(ip) });
const octet = stamp % 250;

describe("limits on sign-in, sign-up and forgot-password", () => {
  let app: INestApplication;
  let prisma: Prisma;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(MAIL_SENDER).useValue(fakeMail).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PRISMA);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await app.close();
  });

  it("stops guessing passwords for one email, before checking the password", async () => {
    const email = newEmail("guess");
    for (let i = 0; i < SIGN_IN_RATE_LIMIT.limit; i++) await api().post("/auth/login/start").send({ email, password: "wrong-password" }).expect(401);
    const res = await api().post("/auth/login/start").send({ email, password: "wrong-password" }).expect(429);
    expect(res.body.code).toBe("RATE_LIMITED");
  }, 30_000);

  it("stops one address trying many emails, but only an address the web server vouched for", async () => {
    const ip = `198.51.${octet}.7`;
    for (let i = 0; i < SIGN_IN_IP_RATE_LIMIT.limit; i++) {
      await api().post("/auth/login/start").set(ipHeaders(ip)).send({ email: newEmail(`ip${i}`), password: "wrong-password" }).expect(401);
    }
    await api().post("/auth/login/start").set(ipHeaders(ip)).send({ email: newEmail("ip-over"), password: "wrong-password" }).expect(429);
    // Another visitor, and a caller with a made-up address header, are not affected.
    await api().post("/auth/login/start").set(ipHeaders(`198.51.${octet}.8`)).send({ email: newEmail("other"), password: "wrong-password" }).expect(401);
    await api().post("/auth/login/start").set({ "x-viewer-ip": ip }).send({ email: newEmail("forged"), password: "wrong-password" }).expect(401);
  }, 60_000);

  it("limits sign-up attempts for one email", async () => {
    const email = newEmail("signup");
    const body = { firstName: "Rate", lastName: "Limit", username: `rl${stamp}`.slice(0, 20), email, password, confirmPassword: password };
    for (let i = 0; i < SIGN_UP_RATE_LIMIT.limit; i++) await api().post("/auth/signup").send({ ...body, password: "short" }).expect(400);
    // Invalid bodies are refused before the limit, so they used none of it.
    await api().post("/auth/signup").send(body).expect(201);
  });

  it("sends a few reset emails per address, then answers the same without sending", async () => {
    const email = newEmail("forgot");
    await prisma.user.create({ data: { email, username: `rf${stamp}`.slice(0, 20), firstName: "R", lastName: "F", passwordHash: "x", emailVerified: new Date() } });
    const before = sent.length;
    for (let i = 0; i < FORGOT_PASSWORD_RATE_LIMIT.limit + 3; i++) await api().post("/auth/forgot-password").send({ email }).expect(204);
    expect(sent.length - before).toBe(FORGOT_PASSWORD_RATE_LIMIT.limit);
  });
});
