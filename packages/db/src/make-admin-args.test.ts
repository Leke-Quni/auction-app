import { describe, expect, it } from "vitest";
import { parseMakeAdminArgs } from "./make-admin-args";

describe("parseMakeAdminArgs", () => {
  it("promotes the given email, lower-cased", () => {
    expect(parseMakeAdminArgs([" Boss@Example.com "])).toEqual({ email: "boss@example.com", role: "ADMIN" });
  });

  it("demotes with --remove", () => {
    expect(parseMakeAdminArgs(["boss@example.com", "--remove"])).toEqual({ email: "boss@example.com", role: "USER" });
  });

  it("refuses a missing email, extra words, an unknown flag and something that is not an email", () => {
    expect(() => parseMakeAdminArgs([])).toThrow(/Usage/);
    expect(() => parseMakeAdminArgs(["a@b.co", "c@d.co"])).toThrow(/Usage/);
    expect(() => parseMakeAdminArgs(["a@b.co", "--force"])).toThrow(/Usage/);
    expect(() => parseMakeAdminArgs(["not-an-email"])).toThrow(/not an email/);
  });
});
