import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { MAIL_SENDER } from "../src/email/mail-sender";

const sent: { to: string; text: string }[] = [];
const stamp = Date.now();
let counter = 0;
const password = "hunter22!";
const codeOf = (text: string) => /code is (\d{6})/.exec(text)![1]!;

describe("send a new sign-in code", () => {
  let app: INestApplication;
  let prisma: Prisma;
  const emails: string[] = [];
  const saved = process.env.LOGIN_CODE_COOLDOWN_SECONDS;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_SENDER)
      .useValue({ send: async (to: string, _subject: string, text: string) => void sent.push({ to, text }) })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PRISMA);
  });

  afterAll(async () => {
    process.env.LOGIN_CODE_COOLDOWN_SECONDS = saved;
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await app.close();
  });

  beforeEach(() => {
    process.env.LOGIN_CODE_COOLDOWN_SECONDS = "0";
    sent.length = 0;
  });

  // A new account has just had its first code emailed.
  const signedUp = async () => {
    const n = ++counter;
    const email = `resend-${n}-${stamp}@example.com`;
    emails.push(email);
    await api().post("/auth/signup").send({ firstName: "Re", lastName: "Send", username: `rs${n}x${stamp}`.slice(0, 20), email, password, confirmPassword: password }).expect(201);
    return { email, first: codeOf(sent.find((m) => m.to === email)!.text) };
  };
  const resend = (email: string) => api().post("/auth/login/resend").send({ email });
  const mailTo = (email: string) => sent.filter((m) => m.to === email);

  it("emails a new code that replaces the old one", async () => {
    const { email, first } = await signedUp();
    await resend(email).expect(204);
    const mails = mailTo(email);
    expect(mails).toHaveLength(2);
    const second = codeOf(mails[1]!.text);
    expect(second).not.toBe(first);
    await api().post("/auth/login/verify").send({ email, code: first }).expect(401);
    await api().post("/auth/login/verify").send({ email, code: second }).expect(200);
  });

  it("waits between codes, answering the same either way", async () => {
    process.env.LOGIN_CODE_COOLDOWN_SECONDS = "30";
    const { email } = await signedUp();
    await resend(email).expect(204);
    expect(mailTo(email)).toHaveLength(1);
  });

  it("sends nothing, and answers the same, for an unknown address", async () => {
    await resend(`nobody-${stamp}@example.com`).expect(204);
    expect(sent).toHaveLength(0);
  });

  it("sends nothing when no sign-in is under way (the first code was used or is long gone)", async () => {
    const { email, first } = await signedUp();
    await api().post("/auth/login/verify").send({ email, code: first }).expect(200);
    sent.length = 0;
    await resend(email).expect(204);
    expect(sent).toHaveLength(0);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.loginCode.create({ data: { userId: user.id, codeHash: "x", expiresAt: new Date(), createdAt: new Date(Date.now() - 31 * 60_000) } });
    await resend(email).expect(204);
    expect(sent).toHaveLength(0);
  });

  it("stops after five new codes in one sign-in, and starts again after the password step", async () => {
    const { email } = await signedUp();
    for (let i = 0; i < 6; i++) await resend(email).expect(204);
    expect(mailTo(email)).toHaveLength(6); // the first code and five new ones
    await api().post("/auth/login/start").send({ email, password }).expect(204);
    expect(mailTo(email)).toHaveLength(7);
    await resend(email).expect(204);
    expect(mailTo(email)).toHaveLength(8);
  });

  it("sends nothing to a banned account", async () => {
    const { email } = await signedUp();
    await prisma.user.update({ where: { email }, data: { bannedAt: new Date() } });
    await resend(email).expect(204);
    expect(mailTo(email)).toHaveLength(1);
  });

  it("rejects a malformed address", async () => {
    await api().post("/auth/login/resend").send({ email: "nope" }).expect(400);
  });
});
