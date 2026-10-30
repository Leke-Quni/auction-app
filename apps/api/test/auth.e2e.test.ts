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

const stamp = Date.now();
const email = `test-${stamp}@example.com`;
const retryEmail = `retry-${stamp}@example.com`;
const raceEmail = `race-${stamp}@example.com`;
const ghostEmail = `ghost-${stamp}@example.com`;
const allEmails = [email, retryEmail, raceEmail, ghostEmail];
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
    await prisma.verificationToken.deleteMany({ where: { identifier: { in: allEmails } } });
    await prisma.user.deleteMany({ where: { email: { in: allEmails } } });
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

  it("rejects sign-up with an email that is already verified", async () => {
    await request(app.getHttpServer()).post("/auth/signup").send({ email, password, name: "Test" }).expect(409);
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

  it("lets an unverified user sign up again, which replaces the account and voids the old link", async () => {
    const api = request(app.getHttpServer());
    await api.post("/auth/signup").send({ email: retryEmail, password: "first-pass1", name: "One" }).expect(201);
    const oldToken = sent.at(-1)!.text.split("token=")[1];
    await api.post("/auth/signup").send({ email: retryEmail, password: "second-pass2", name: "Two" }).expect(201);
    const newToken = sent.at(-1)!.text.split("token=")[1];

    await api.post("/auth/verify-email").send({ token: oldToken }).expect(400);
    await api.post("/auth/verify-email").send({ token: newToken }).expect(204);
    await api.post("/auth/login").send({ email: retryEmail, password: "first-pass1" }).expect(401);
    await api.post("/auth/login").send({ email: retryEmail, password: "second-pass2" }).expect(200);
    await api.post("/auth/signup").send({ email: retryEmail, password: "third-pass3", name: "Three" }).expect(409);
  });

  it("never returns a server error for simultaneous sign-ups with the same email", async () => {
    const api = request(app.getHttpServer());
    const results = await Promise.all(
      [1, 2].map((n) => api.post("/auth/signup").send({ email: raceEmail, password: `race-pass${n}`, name: "Race" })),
    );
    for (const r of results) expect([201, 409]).toContain(r.status);
  });

  it("rejects tokens that are validly signed but incomplete or for a deleted user", async () => {
    const api = request(app.getHttpServer());
    const sign = (claims: Record<string, unknown>, sub: string | undefined, exp: boolean) => {
      const jwt = new SignJWT(claims).setProtectedHeader({ alg: "HS256" });
      if (sub) jwt.setSubject(sub);
      if (exp) jwt.setExpirationTime("5m");
      return jwt.sign(authSecret());
    };
    await api.get("/me").set("Authorization", `Bearer ${await sign({ email, role: "USER" }, "someone", false)}`).expect(401);
    await api.get("/me").set("Authorization", `Bearer ${await sign({ role: "USER" }, "someone", true)}`).expect(401);
    await api.get("/me").set("Authorization", `Bearer ${await sign({ email, role: "HACKER" }, "someone", true)}`).expect(401);
    await api.get("/me").set("Authorization", `Bearer ${await sign({ email, role: "USER" }, undefined, true)}`).expect(401);

    const deletedToken = await sign({ email: ghostEmail, role: "USER" }, "no-such-user-id", true);
    await api.get("/me").set("Authorization", `Bearer ${deletedToken}`).expect(401);
  });
});
