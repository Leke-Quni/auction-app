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
const lastCode = () => /code is (\d{6})/.exec(sent.at(-1)!.text)![1];

const stamp = Date.now();
const email = `test-${stamp}@example.com`;
const raceEmail = `race-${stamp}@example.com`;
const ghostEmail = `ghost-${stamp}@example.com`;
const retryEmail = `retry-${stamp}@example.com`;
const allEmails = [email, raceEmail, ghostEmail, retryEmail];
const password = "hunter22!";

// Usernames are derived from the email so each test user gets a unique, valid one.
const userFor = (email: string) => `u${email.split("@")[0].replace(/[^a-z0-9]/g, "").slice(-18)}`;
const su = (email: string, password: string, extra: Record<string, unknown> = {}) => ({
  firstName: "Test",
  lastName: "User",
  username: userFor(email),
  email,
  password,
  confirmPassword: password,
  ...extra,
});

describe("auth", () => {
  let app: INestApplication;
  let prisma: Prisma;
  const api = () => request(app.getHttpServer());

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
    await prisma.user.deleteMany({ where: { email: { in: allEmails } } });
    await app.close();
  });

  it("rejects invalid sign-up input", async () => {
    await api().post("/auth/signup").send({ email: "nope" }).expect(400);
    await api().post("/auth/signup").send(su(email, password, { firstName: " " })).expect(400);
    await api().post("/auth/signup").send(su(email, password, { username: "ab" })).expect(400);
    await api().post("/auth/signup").send(su(email, password, { username: "bad name!" })).expect(400);
    await api().post("/auth/signup").send(su(email, password, { username: "admin" })).expect(400);
  });

  it("requires the password to be confirmed when signing up", async () => {
    await api().post("/auth/signup").send(su(email, password, { confirmPassword: "different-1" })).expect(400);
    await api().post("/auth/signup").send(su(email, password, { confirmPassword: undefined })).expect(400);
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  it("signs up and emails a code, leaving the email unverified until the code is used", async () => {
    await api().post("/auth/signup").send(su(email, password)).expect(201);
    expect(sent.at(-1)?.to).toBe(email);
    expect(lastCode()).toMatch(/^\d{6}$/);
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerified).toBeNull();
  });

  it("signs in straight after sign-up with the sign-up code, with no password step", async () => {
    const res = await api().post("/auth/login/verify").send({ email, code: lastCode() }).expect(200);
    expect(res.body).toMatchObject({ email, role: "USER", name: userFor(email) });
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerified).not.toBeNull();
  });

  it("rejects a duplicate email, saying which field clashed", async () => {
    const res = await api().post("/auth/signup").send(su(email, password, { username: "someone_else" })).expect(409);
    expect(res.body.code).toBe("EMAIL_TAKEN");
  });

  it("rejects a username that another account has, in any letter case", async () => {
    const res = await api()
      .post("/auth/signup")
      .send(su(`taken-${stamp}@example.com`, password, { username: userFor(email).toUpperCase() }))
      .expect(409);
    expect(res.body.code).toBe("USERNAME_TAKEN");
    expect(await prisma.user.count({ where: { email: `taken-${stamp}@example.com` } })).toBe(0);
  });

  it("rejects a wrong password without sending a code", async () => {
    const before = sent.length;
    await api().post("/auth/login/start").send({ email, password: "wrong-pass" }).expect(401);
    await api().post("/auth/login/start").send({ email: "nobody@example.com", password }).expect(401);
    expect(sent.length).toBe(before);
  });

  it("rejects a code for an email that has none pending", async () => {
    await api().post("/auth/login/verify").send({ email, code: "123456" }).expect(401);
  });

  it("emails a 6-digit code after a correct password", async () => {
    await api().post("/auth/login/start").send({ email, password }).expect(204);
    expect(sent.at(-1)?.to).toBe(email);
    expect(lastCode()).toMatch(/^\d{6}$/);
  });

  it("rejects a wrong code, then accepts the right one", async () => {
    const code = lastCode();
    const wrong = code === "000000" ? "000001" : "000000";
    await api().post("/auth/login/verify").send({ email, code: wrong }).expect(401);
    const res = await api().post("/auth/login/verify").send({ email, code }).expect(200);
    expect(res.body).toMatchObject({ email, role: "USER" });
  });

  it("makes a code single-use", async () => {
    await api().post("/auth/login/verify").send({ email, code: lastCode() }).expect(401);
  });

  it("requires a fresh code on every sign-in, and a new code voids the old one", async () => {
    await api().post("/auth/login/start").send({ email, password }).expect(204);
    const first = lastCode();
    await api().post("/auth/login/start").send({ email, password }).expect(204);
    const second = lastCode();
    if (first !== second) await api().post("/auth/login/verify").send({ email, code: first }).expect(401);
    await api().post("/auth/login/verify").send({ email, code: second }).expect(200);
  });

  it("locks a code after 5 wrong attempts, even if the right code is then entered", async () => {
    await api().post("/auth/login/start").send({ email, password }).expect(204);
    const code = lastCode();
    const wrong = code === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i++) await api().post("/auth/login/verify").send({ email, code: wrong }).expect(401);
    await api().post("/auth/login/verify").send({ email, code }).expect(401);
  });

  it("rejects an expired code", async () => {
    await api().post("/auth/login/start").send({ email, password }).expect(204);
    const code = lastCode();
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.loginCode.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await api().post("/auth/login/verify").send({ email, code }).expect(401);
  });

  it("rejects malformed codes", async () => {
    await api().post("/auth/login/verify").send({ email, code: "12ab56" }).expect(400);
    await api().post("/auth/login/verify").send({ email, code: "12345" }).expect(400);
  });

  it("lets someone sign up again over an unverified email, replacing the password and voiding the old code", async () => {
    await api().post("/auth/signup").send(su(retryEmail, "squatter-pass1")).expect(201);
    const squatterCode = lastCode();
    await api().post("/auth/signup").send(su(retryEmail, "owner-pass22")).expect(201);
    const ownerCode = lastCode();

    if (squatterCode !== ownerCode) await api().post("/auth/login/verify").send({ email: retryEmail, code: squatterCode }).expect(401);
    await api().post("/auth/login/start").send({ email: retryEmail, password: "squatter-pass1" }).expect(401);
    const res = await api().post("/auth/login/verify").send({ email: retryEmail, code: ownerCode }).expect(200);
    expect(res.body).toMatchObject({ email: retryEmail });
    await api().post("/auth/signup").send(su(retryEmail, "third-pass33")).expect(409);
  });

  it("handles simultaneous sign-ups with the same email without a server error or duplicate account", async () => {
    const results = await Promise.all(
      [1, 2].map((n) => api().post("/auth/signup").send(su(raceEmail, `race-pass${n}`))),
    );
    for (const r of results) expect([201, 409]).toContain(r.status);
    expect(await prisma.user.count({ where: { email: raceEmail } })).toBe(1);
  });

  it("protects /me with the Auth.js-issued JWT", async () => {
    await api().get("/me").expect(401);
    await api().get("/me").set("Authorization", "Bearer garbage").expect(401);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const jwt = await new SignJWT({ email, role: user.role })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setExpirationTime("5m")
      .sign(authSecret());
    const res = await api().get("/me").set("Authorization", `Bearer ${jwt}`).expect(200);
    expect(res.body).toMatchObject({ id: user.id, email });
  });

  it("rejects tokens that are validly signed but incomplete or for a deleted user", async () => {
    const sign = (claims: Record<string, unknown>, sub: string | undefined, exp: boolean) => {
      const jwt = new SignJWT(claims).setProtectedHeader({ alg: "HS256" });
      if (sub) jwt.setSubject(sub);
      if (exp) jwt.setExpirationTime("5m");
      return jwt.sign(authSecret());
    };
    await api().get("/me").set("Authorization", `Bearer ${await sign({ email, role: "USER" }, "someone", false)}`).expect(401);
    await api().get("/me").set("Authorization", `Bearer ${await sign({ role: "USER" }, "someone", true)}`).expect(401);
    await api().get("/me").set("Authorization", `Bearer ${await sign({ email, role: "HACKER" }, "someone", true)}`).expect(401);
    await api().get("/me").set("Authorization", `Bearer ${await sign({ email, role: "USER" }, undefined, true)}`).expect(401);

    const deletedToken = await sign({ email: ghostEmail, role: "USER" }, "no-such-user-id", true);
    await api().get("/me").set("Authorization", `Bearer ${deletedToken}`).expect(401);
  });
});
