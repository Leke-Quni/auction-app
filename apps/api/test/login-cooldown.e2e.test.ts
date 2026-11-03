import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PRISMA, type Prisma } from "../src/db/db.module";
import { MAIL_SENDER, type MailSender } from "../src/email/mail-sender";

const sent: { to: string }[] = [];
const fakeMail: MailSender = {
  async send(to) {
    sent.push({ to });
  },
};

const stamp = Date.now();
const email = `cool-${stamp}@example.com`;
const password = "hunter22!";
const signUpBody = {
  firstName: "Cool",
  lastName: "Down",
  username: `cool${stamp}`.slice(0, 20),
  email,
  password,
  confirmPassword: password,
};

describe("login code cooldown", () => {
  let app: INestApplication;
  let prisma: Prisma;
  const saved = process.env.LOGIN_CODE_COOLDOWN_SECONDS;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    process.env.LOGIN_CODE_COOLDOWN_SECONDS = "30";
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(MAIL_SENDER).useValue(fakeMail).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PRISMA);
  });

  afterAll(async () => {
    process.env.LOGIN_CODE_COOLDOWN_SECONDS = saved;
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it("makes a second code request wait, and says how long", async () => {
    await api().post("/auth/signup").send(signUpBody).expect(201);
    expect(sent).toHaveLength(1);

    const res = await api().post("/auth/login/start").send({ email, password }).expect(429);
    expect(res.body.code).toBe("CODE_COOLDOWN");
    expect(res.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(res.body.retryAfterSeconds).toBeLessThanOrEqual(30);
    expect(res.body.message).toMatch(/Wait \d+ seconds? before asking for another/);
    await api().post("/auth/signup").send(signUpBody).expect(429);
    expect(sent).toHaveLength(1);
  });

  it("does not reveal anything to someone without the password", async () => {
    await api().post("/auth/login/start").send({ email, password: "wrong-password" }).expect(401);
    await api().post("/auth/login/start").send({ email: `nobody-${stamp}@example.com`, password }).expect(401);
  });

  it("sends a new code once the wait is over", async () => {
    await prisma.loginCode.updateMany({ where: { user: { email } }, data: { createdAt: new Date(Date.now() - 31_000) } });
    await api().post("/auth/login/start").send({ email, password }).expect(204);
    expect(sent).toHaveLength(2);
    await api().post("/auth/login/start").send({ email, password }).expect(429);
  });
});
