import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { SignJWT } from "jose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { authSecret } from "../src/config";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { MAIL_SENDER, type MailSender } from "../src/email/mail-sender";

const sent: { to: string; text: string }[] = [];
const fakeMail: MailSender = {
  async send(to, _subject, text) {
    sent.push({ to, text });
  },
};

const email = `test-${Date.now()}@example.com`;
const password = "hunter22!";

describe("auth", () => {
  let app: INestApplication;
  let prisma: Prisma;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_SENDER)
      .useValue(fakeMail)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PRISMA);
  });

  afterAll(async () => {
    await prisma.verificationToken.deleteMany({ where: { identifier: email } });
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it("rejects invalid sign-up input", async () => {
    await request(app.getHttpServer()).post("/auth/signup").send({ email: "nope" }).expect(400);
  });

  it("signs up and sends a verification email", async () => {
    await request(app.getHttpServer()).post("/auth/signup").send({ email, password, name: "Test" }).expect(201);
    expect(sent.at(-1)?.to).toBe(email);
    expect(sent.at(-1)?.text).toContain("/verify-email?token=");
  });

  it("rejects a duplicate email", async () => {
    await request(app.getHttpServer()).post("/auth/signup").send({ email, password, name: "Test" }).expect(409);
  });

  it("blocks login before the email is verified", async () => {
    await request(app.getHttpServer()).post("/auth/login").send({ email, password }).expect(403);
  });

  it("verifies the email, then logs in", async () => {
    const token = sent.at(-1)!.text.split("token=")[1];
    await request(app.getHttpServer()).post("/auth/verify-email").send({ token }).expect(204);
    await request(app.getHttpServer()).post("/auth/verify-email").send({ token }).expect(400);
    const res = await request(app.getHttpServer()).post("/auth/login").send({ email, password }).expect(200);
    expect(res.body).toMatchObject({ email, role: "USER" });
  });

  it("rejects a wrong password", async () => {
    await request(app.getHttpServer()).post("/auth/login").send({ email, password: "wrong-pass" }).expect(401);
  });

  it("protects /me with the Auth.js-issued JWT", async () => {
    await request(app.getHttpServer()).get("/me").expect(401);
    await request(app.getHttpServer()).get("/me").set("Authorization", "Bearer garbage").expect(401);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const jwt = await new SignJWT({ email, role: user.role })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setExpirationTime("5m")
      .sign(authSecret());
    const res = await request(app.getHttpServer()).get("/me").set("Authorization", `Bearer ${jwt}`).expect(200);
    expect(res.body).toMatchObject({ id: user.id, email });
  });
});
