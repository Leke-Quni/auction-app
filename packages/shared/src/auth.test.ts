import { describe, expect, it } from "vitest";
import {
  changePasswordSchema,
  confirmEmailChangeSchema,
  loginCodeSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  startEmailChangeSchema,
  updateProfileSchema,
  updateUsernameSchema,
} from "./auth";

const validSignUp = {
  firstName: "Ana",
  lastName: "Krasniqi",
  username: "ana_k",
  email: "a@b.co",
  password: "hunter22!",
  confirmPassword: "hunter22!",
};

const firstMessage = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0]?.message;

describe("signUpSchema", () => {
  it("accepts valid input and lowercases the username", () => {
    const r = signUpSchema.safeParse({ ...validSignUp, username: "  Ana_K " });
    expect(r.success && r.data.username).toBe("ana_k");
  });

  it("rejects short passwords and bad emails", () => {
    expect(signUpSchema.safeParse({ ...validSignUp, password: "short", confirmPassword: "short" }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...validSignUp, email: "nope" }).success).toBe(false);
  });

  it("requires the confirmation to match", () => {
    const r = signUpSchema.safeParse({ ...validSignUp, confirmPassword: "different1" });
    expect(r.success).toBe(false);
    expect(firstMessage(r)).toBe("Passwords do not match");
  });

  it("requires both names", () => {
    expect(signUpSchema.safeParse({ ...validSignUp, firstName: "  " }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...validSignUp, lastName: "" }).success).toBe(false);
  });
});

describe("username", () => {
  const ok = (username: string) => updateUsernameSchema.safeParse({ username }).success;

  it("accepts 3-20 letters, digits, and underscores, none of which is required", () => {
    expect(ok("abc")).toBe(true);
    expect(ok("letters")).toBe(true);
    expect(ok("12345")).toBe(true);
    expect(ok("___")).toBe(true);
    expect(ok("a_1_b")).toBe(true);
    expect(ok("a".repeat(20))).toBe(true);
  });

  it("rejects bad lengths, characters, and reserved names", () => {
    for (const bad of ["ab", "a".repeat(21), "has space", "dash-ed", "émile", "admin", "ADMIN", "Support"]) {
      expect(ok(bad)).toBe(false);
    }
  });
});

describe("signInSchema", () => {
  it("requires a password", () => {
    expect(signInSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
  });
});

describe("loginCodeSchema", () => {
  it("accepts exactly six digits", () => {
    expect(loginCodeSchema.safeParse({ email: "a@b.co", code: "012345" }).success).toBe(true);
  });

  it("rejects short, long, and non-numeric codes", () => {
    for (const code of ["12345", "1234567", "12345a", ""]) {
      expect(loginCodeSchema.safeParse({ email: "a@b.co", code }).success).toBe(false);
    }
  });
});

describe("password confirmation", () => {
  it("is required when changing or resetting a password", () => {
    const change = { currentPassword: "x", newPassword: "long-enough1", confirmPassword: "long-enough1" };
    expect(changePasswordSchema.safeParse(change).success).toBe(true);
    expect(changePasswordSchema.safeParse({ ...change, confirmPassword: "nope-nope1" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ ...change, newPassword: "short", confirmPassword: "short" }).success).toBe(false);

    const same = changePasswordSchema.safeParse({ ...change, currentPassword: "long-enough1" });
    expect(same.success).toBe(false);
    expect(firstMessage(same)).toBe("Your new password must be different from your current password");

    const reset = { token: "t", password: "long-enough1", confirmPassword: "long-enough1" };
    expect(resetPasswordSchema.safeParse(reset).success).toBe(true);
    expect(resetPasswordSchema.safeParse({ ...reset, confirmPassword: "" }).success).toBe(false);
  });
});

describe("other account schemas", () => {
  it("trims names and requires them", () => {
    expect(updateProfileSchema.parse({ firstName: "  Ana ", lastName: " K " })).toEqual({ firstName: "Ana", lastName: "K" });
    expect(updateProfileSchema.safeParse({ firstName: "   ", lastName: "K" }).success).toBe(false);
  });

  it("validates the email-change inputs", () => {
    expect(startEmailChangeSchema.safeParse({ newEmail: "nope", password: "x" }).success).toBe(false);
    expect(confirmEmailChangeSchema.safeParse({ code: "12345" }).success).toBe(false);
    expect(confirmEmailChangeSchema.safeParse({ code: "123456" }).success).toBe(true);
  });
});
