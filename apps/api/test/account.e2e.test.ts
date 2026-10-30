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
const lastResetToken = () => /token=([a-f0-9]+)/.exec(sent.at(-1)!.text)![1];
const wrongCode = (code: string) => (code === "000000" ? "000001" : "000000");

const stamp = Date.now();
const emails = {
  user: `acct-${stamp}@example.com`,
  next: `acct-new-${stamp}@example.com`,
  other: `acct-other-${stamp}@example.com`,
  reset: `reset-${stamp}@example.com`,
  fresh: `fresh-${stamp}@example.com`,
};
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

describe("account and password reset", () => {
  let app: INestApplication;
  let prisma: Prisma;
  const api = () => request(app.getHttpServer());

  const signUpVerified = async (email: string) => {
    await api().post("/auth/signup").send(su(email, password)).expect(201);
    const res = await api().post("/auth/login/verify").send({ email, code: lastCode() }).expect(200);
    return res.body.id as string;
  };
  const tokenFor = (id: string, email: string) =>
    new SignJWT({ email, role: "USER" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(id)
      .setExpirationTime("5m")
      .sign(authSecret());

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
    await prisma.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
    await app.close();
  });

  describe("forgot and reset password", () => {
    it("answers the same for unknown emails and sends nothing", async () => {
      const before = sent.length;
      await api().post("/auth/forgot-password").send({ email: "nobody@example.com" }).expect(204);
      expect(sent.length).toBe(before);
    });

    it("rejects invalid input and unknown tokens", async () => {
      await api().post("/auth/forgot-password").send({ email: "nope" }).expect(400);
      await api().post("/auth/reset-password").send({ token: "nope", password: "new-pass-123", confirmPassword: "new-pass-123" }).expect(400);
    });

    it("requires the new password to be confirmed when resetting", async () => {
      await signUpVerified(emails.fresh);
      await api().post("/auth/forgot-password").send({ email: emails.fresh }).expect(204);
      const token = lastResetToken();
      await api().post("/auth/reset-password").send({ token, password: "new-pass-123", confirmPassword: "nope-nope-1" }).expect(400);
      await api().post("/auth/reset-password").send({ token, password: "new-pass-123" }).expect(400);
      await api().post("/auth/login/start").send({ email: emails.fresh, password }).expect(204);
      await prisma.user.delete({ where: { email: emails.fresh } });
    });

    it("emails a link, and the link sets a new password once", async () => {
      await signUpVerified(emails.reset);
      await api().post("/auth/forgot-password").send({ email: emails.reset }).expect(204);
      expect(sent.at(-1)?.to).toBe(emails.reset);
      expect(sent.at(-1)?.text).toContain("/reset-password?token=");
      const token = lastResetToken();

      await api().post("/auth/reset-password").send({ token, password: "short", confirmPassword: "short" }).expect(400);
      await api().post("/auth/reset-password").send({ token, password: "new-pass-123", confirmPassword: "new-pass-123" }).expect(204);
      await api().post("/auth/reset-password").send({ token, password: "other-pass-1", confirmPassword: "other-pass-1" }).expect(400);

      await api().post("/auth/login/start").send({ email: emails.reset, password }).expect(401);
      await api().post("/auth/login/start").send({ email: emails.reset, password: "new-pass-123" }).expect(204);
    });

    it("voids an older link when a newer one is requested", async () => {
      await api().post("/auth/forgot-password").send({ email: emails.reset }).expect(204);
      const first = lastResetToken();
      await api().post("/auth/forgot-password").send({ email: emails.reset }).expect(204);
      const second = lastResetToken();
      await api().post("/auth/reset-password").send({ token: first, password: "new-pass-456", confirmPassword: "new-pass-456" }).expect(400);
      await api().post("/auth/reset-password").send({ token: second, password: "new-pass-456", confirmPassword: "new-pass-456" }).expect(204);
    });

    it("rejects an expired link", async () => {
      await api().post("/auth/forgot-password").send({ email: emails.reset }).expect(204);
      const token = lastResetToken();
      const user = await prisma.user.findUniqueOrThrow({ where: { email: emails.reset } });
      await prisma.passwordResetToken.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await api().post("/auth/reset-password").send({ token, password: "new-pass-789", confirmPassword: "new-pass-789" }).expect(400);
    });

    it("verifies the email and voids pending sign-in codes", async () => {
      await api().post("/auth/signup").send(su(emails.fresh, password)).expect(201);
      const pendingCode = lastCode();
      await api().post("/auth/forgot-password").send({ email: emails.fresh }).expect(204);
      await api().post("/auth/reset-password").send({ token: lastResetToken(), password: "new-pass-123", confirmPassword: "new-pass-123" }).expect(204);

      const user = await prisma.user.findUniqueOrThrow({ where: { email: emails.fresh } });
      expect(user.emailVerified).not.toBeNull();
      await api().post("/auth/login/verify").send({ email: emails.fresh, code: pendingCode }).expect(401);
    });
  });

  describe("account settings", () => {
    let id: string;
    let auth: string;

    beforeAll(async () => {
      id = await signUpVerified(emails.user);
      auth = `Bearer ${await tokenFor(id, emails.user)}`;
      await signUpVerified(emails.other);
    });

    it("requires a signed-in user for every endpoint", async () => {
      await api().patch("/me").send({ firstName: "X", lastName: "Y" }).expect(401);
      await api().patch("/me/username").send({ username: "someone" }).expect(401);
      await api().post("/me/password").send({ currentPassword: "a", newPassword: "bbbbbbbb", confirmPassword: "bbbbbbbb" }).expect(401);
      await api().post("/me/email/start").send({ newEmail: "a@b.co", password: "a" }).expect(401);
      await api().post("/me/email/confirm").send({ code: "123456" }).expect(401);
    });

    it("updates the first and last name", async () => {
      await api().patch("/me").set("Authorization", auth).send({ firstName: "   ", lastName: "Y" }).expect(400);
      const res = await api().patch("/me").set("Authorization", auth).send({ firstName: "  Ana ", lastName: " Krasniqi " }).expect(200);
      expect(res.body).toEqual({ firstName: "Ana", lastName: "Krasniqi" });
      const me = await api().get("/me").set("Authorization", auth).expect(200);
      expect(me.body).toMatchObject({ firstName: "Ana", lastName: "Krasniqi", username: userFor(emails.user) });
      expect(me.body).not.toHaveProperty("name");
    });

    it("changes the username, lowercased, unless it is invalid or taken", async () => {
      const patch = (username: string) => api().patch("/me/username").set("Authorization", auth).send({ username });
      await patch("ab").expect(400);
      await patch("has space").expect(400);
      await patch("Admin").expect(400);
      const taken = await patch(userFor(emails.other)).expect(409);
      expect(taken.body.code).toBe("USERNAME_TAKEN");

      const res = await patch("New_Handle1").expect(200);
      expect(res.body).toEqual({ username: "new_handle1" });
      const me = await api().get("/me").set("Authorization", auth).expect(200);
      expect(me.body.username).toBe("new_handle1");
      await patch("new_handle1").expect(200);
    });

    it("requires the new password to be confirmed when changing it", async () => {
      const change = (body: object) => api().post("/me/password").set("Authorization", auth).send(body);
      await change({ currentPassword: password, newPassword: "changed-pass1", confirmPassword: "different-1" }).expect(400);
      await change({ currentPassword: password, newPassword: "changed-pass1" }).expect(400);
      await change({ currentPassword: password, newPassword: password, confirmPassword: password }).expect(400);
      await api().post("/auth/login/start").send({ email: emails.user, password }).expect(204);
    });

    it("changes the password only with the current one", async () => {
      await api().post("/me/password").set("Authorization", auth).send({ currentPassword: "wrong", newPassword: "changed-pass1", confirmPassword: "changed-pass1" }).expect(403);
      await api().post("/me/password").set("Authorization", auth).send({ currentPassword: password, newPassword: "short", confirmPassword: "short" }).expect(400);
      await api().post("/me/password").set("Authorization", auth).send({ currentPassword: password, newPassword: "changed-pass1", confirmPassword: "changed-pass1" }).expect(204);
      await api().post("/auth/login/start").send({ email: emails.user, password }).expect(401);
      await api().post("/auth/login/start").send({ email: emails.user, password: "changed-pass1" }).expect(204);
    });

    it("refuses an email change with the wrong password, the same email, or a taken email", async () => {
      const start = (body: object) => api().post("/me/email/start").set("Authorization", auth).send(body);
      await start({ newEmail: emails.next, password: "wrong" }).expect(403);
      await start({ newEmail: emails.user, password: "changed-pass1" }).expect(400);
      await start({ newEmail: emails.other, password: "changed-pass1" }).expect(409);
    });

    it("sends the code to the new address and changes nothing until it is confirmed", async () => {
      await api().post("/me/email/start").set("Authorization", auth).send({ newEmail: emails.next, password: "changed-pass1" }).expect(204);
      expect(sent.at(-1)?.to).toBe(emails.next);
      const me = await api().get("/me").set("Authorization", auth).expect(200);
      expect(me.body.email).toBe(emails.user);
    });

    it("rejects a wrong code, then confirms with the right one, once", async () => {
      const code = lastCode();
      await api().post("/me/email/confirm").set("Authorization", auth).send({ code: wrongCode(code) }).expect(401);
      const res = await api().post("/me/email/confirm").set("Authorization", auth).send({ code }).expect(200);
      expect(res.body).toEqual({ email: emails.next });

      const me = await api().get("/me").set("Authorization", auth).expect(200);
      expect(me.body.email).toBe(emails.next);
      await api().post("/me/email/confirm").set("Authorization", auth).send({ code }).expect(401);
      await api().post("/auth/login/start").send({ email: emails.user, password: "changed-pass1" }).expect(401);
      await api().post("/auth/login/start").send({ email: emails.next, password: "changed-pass1" }).expect(204);
    });

    it("locks an email-change code after 5 wrong attempts and rejects expired ones", async () => {
      await api().post("/me/email/start").set("Authorization", auth).send({ newEmail: emails.user, password: "changed-pass1" }).expect(204);
      const code = lastCode();
      for (let i = 0; i < 5; i++) {
        await api().post("/me/email/confirm").set("Authorization", auth).send({ code: wrongCode(code) }).expect(401);
      }
      await api().post("/me/email/confirm").set("Authorization", auth).send({ code }).expect(401);

      await api().post("/me/email/start").set("Authorization", auth).send({ newEmail: emails.user, password: "changed-pass1" }).expect(204);
      const fresh = lastCode();
      await prisma.emailChange.update({ where: { userId: id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await api().post("/me/email/confirm").set("Authorization", auth).send({ code: fresh }).expect(401);
    });
  });
});
