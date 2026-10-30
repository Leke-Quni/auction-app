import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SignJWT } from "jose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { authSecret } from "../src/config";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { MAIL_SENDER } from "../src/email/mail-sender";
import { ResendMailSender } from "../src/email/resend-mail-sender";

// A real ResendMailSender whose HTTP call is replaced, so the whole path from route to response is exercised.
let mode: "sandbox" | "outage" | "ok" = "ok";
const fakeResend = (async () => {
  if (mode === "sandbox") {
    return new Response(JSON.stringify({ message: "You can only send testing emails to your own email address (owner@example.com)." }), { status: 403 });
  }
  if (mode === "outage") return new Response("Bad gateway", { status: 502 });
  return new Response('{"id":"abc"}', { status: 200 });
}) as unknown as typeof fetch;

const stamp = Date.now();
const password = "hunter22!";
const email = `mailfail-${stamp}@example.com`;
const username = `mf${stamp}`;
const body = (over: object = {}) => ({
  firstName: "Mail",
  lastName: "Fail",
  username,
  email,
  password,
  confirmPassword: password,
  ...over,
});
const SANDBOX_MESSAGE = "We can't email that address yet. This site is in testing and can only send email to its owner.";

describe("when the email cannot be sent", () => {
  let app: INestApplication;
  let prisma: Prisma;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_SENDER)
      .useValue(new ResendMailSender("re_test", "Test <a@b.co>", fakeResend))
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PRISMA);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it("sign-up says clearly that the address cannot be emailed (422), not a generic failure", async () => {
    mode = "sandbox";
    const res = await api().post("/auth/signup").send(body()).expect(422);
    expect(res.body).toMatchObject({ message: SANDBOX_MESSAGE, code: "EMAIL_NOT_ALLOWED" });
  });

  it("sign-in for that account says the same, and a wrong password is still a 401", async () => {
    mode = "sandbox";
    const res = await api().post("/auth/login/start").send({ email, password }).expect(422);
    expect(res.body).toMatchObject({ message: SANDBOX_MESSAGE, code: "EMAIL_NOT_ALLOWED" });
    await api().post("/auth/login/start").send({ email, password: "wrong-password" }).expect(401);
  });

  it("changing the email to an address that cannot be emailed says so", async () => {
    mode = "ok";
    const other = `mailfail-owner-${stamp}@example.com`;
    await api().post("/auth/signup").send(body({ email: other, username: `mo${stamp}` })).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: other } });
    const token = await new SignJWT({ email: other, role: "USER" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setExpirationTime("5m")
      .sign(authSecret());

    mode = "sandbox";
    const res = await api()
      .post("/me/email/start")
      .set("Authorization", `Bearer ${token}`)
      .send({ newEmail: `mailfail-new-${stamp}@example.com`, password })
      .expect(422);
    expect(res.body.code).toBe("EMAIL_NOT_ALLOWED");
    await prisma.user.deleteMany({ where: { email: other } });
  });

  it("forgot-password answers the same 204 either way, so it never reveals which emails have accounts", async () => {
    mode = "sandbox";
    await api().post("/auth/forgot-password").send({ email }).expect(204);
    await api().post("/auth/forgot-password").send({ email: `nobody-${stamp}@example.com` }).expect(204);
  });

  it("any other provider failure is still a generic 503", async () => {
    mode = "outage";
    const res = await api().post("/auth/login/start").send({ email, password }).expect(503);
    expect(res.body.message).toBe("We couldn't send the email. Try again.");
    expect(res.body.code).toBeUndefined();
  });

  it("works again once the provider recovers", async () => {
    mode = "ok";
    await api().post("/auth/login/start").send({ email, password }).expect(204);
  });
});
