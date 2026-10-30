import { describe, expect, it } from "vitest";
import { signInSchema, signUpSchema } from "./auth";

describe("signUpSchema", () => {
  it("accepts valid input", () => {
    const r = signUpSchema.safeParse({ email: "a@b.co", password: "hunter22!", name: "Ana" });
    expect(r.success).toBe(true);
  });

  it("rejects short passwords and bad emails", () => {
    expect(signUpSchema.safeParse({ email: "a@b.co", password: "short", name: "Ana" }).success).toBe(false);
    expect(signUpSchema.safeParse({ email: "nope", password: "hunter22!", name: "Ana" }).success).toBe(false);
  });
});

describe("signInSchema", () => {
  it("requires a password", () => {
    expect(signInSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
  });
});
