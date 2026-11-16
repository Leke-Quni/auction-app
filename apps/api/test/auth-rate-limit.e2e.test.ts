import "reflect-metadata";
import { FORGOT_PASSWORD_RATE_LIMIT, SIGN_IN_IP_RATE_LIMIT, SIGN_IN_RATE_LIMIT, SIGN_UP_RATE_LIMIT } from "@auction/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { signViewerIp } from "../src/common/client-ip";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { MAIL_SENDER, type MailSender } from "../src/email/mail-sender";
import { RATE_LIMITER, type RateLimiter } from "../src/rate-limit/rate-limiter";
import { waitForLimiter } from "./limiter-ready";

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
    await waitForLimiter(app);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await app.close();
  });

  // The test config lifts the per-address limits; these tests count them, from a clean count for the test's own (loopback)
  // address, which the other test files and earlier runs also use.
  const lifted = process.env.AUTH_LIMIT_IP;
  beforeEach(async () => {
    delete process.env.AUTH_LIMIT_IP;
    const limiter = app.get<RateLimiter>(RATE_LIMITER);
    for (const name of ["signin", "signup", "forgot"]) for (const own of ["::ffff:127.0.0.1", "127.0.0.1", "::1"]) await limiter.reset(`rl:${name}-ip:${own}`);
  });
  afterEach(() => void (process.env.AUTH_LIMIT_IP = lifted));

  it("stops guessing passwords for one email, before checking the password", async () => {
    const email = newEmail("guess");
    for (let i = 0; i < SIGN_IN_RATE_LIMIT.limit; i++) await api().post("/auth/login/start").send({ email, password: "wrong-password" }).expect(401);
    const res = await api().post("/auth/login/start").send({ email, password: "wrong-password" }).expect(429);
    expect(res.body.code).toBe("RATE_LIMITED");
  }, 30_000);

  it("stops one signed address trying many emails; a made-up address header does not count against it", async () => {
    const ip = `198.51.${octet}.7`;
    for (let i = 0; i < SIGN_IN_IP_RATE_LIMIT.limit; i++) {
      await api().post("/auth/login/start").set(ipHeaders(ip)).send({ email: newEmail(`ip${i}`), password: "wrong-password" }).expect(401);
    }
    await api().post("/auth/login/start").set(ipHeaders(ip)).send({ email: newEmail("ip-over"), password: "wrong-password" }).expect(429);
    // Another visitor is not affected, and a made-up header is not believed: the caller counts under its own connection address.
    await api().post("/auth/login/start").set(ipHeaders(`198.51.${octet}.8`)).send({ email: newEmail("other"), password: "wrong-password" }).expect(401);
    await api().post("/auth/login/start").set({ "x-viewer-ip": ip }).send({ email: newEmail("forged"), password: "wrong-password" }).expect(401);
  }, 60_000);

  it("counts a direct caller without a signed address by its connection address", async () => {
    process.env.AUTH_LIMIT_IP = "3";
    for (let i = 0; i < 3; i++) await api().post("/auth/login/start").send({ email: newEmail(`direct${i}`), password: "wrong-password" }).expect(401);
    await api().post("/auth/login/start").send({ email: newEmail("direct-over"), password: "wrong-password" }).expect(429);
    await api().post("/auth/login/start").set({ "x-viewer-ip": "203.0.113.1" }).send({ email: newEmail("direct-forged"), password: "wrong-password" }).expect(429);
    for (let i = 0; i < 3; i++) await api().post("/auth/forgot-password").send({ email: newEmail(`direct-f${i}`) }).expect(204);
    await api().post("/auth/forgot-password").send({ email: newEmail("direct-f-over") }).expect(429);
    // The web server without a visitor address (local development) signs an empty one: no per-address count, as its own address is shared.
    await api().post("/auth/login/start").set(ipHeaders("")).send({ email: newEmail("web-no-ip"), password: "wrong-password" }).expect(401);
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
