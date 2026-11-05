import { describe, expect, it } from "vitest";
import { parseSeedArgs } from "./seed-args";

describe("parseSeedArgs", () => {
  it("has defaults", () => {
    expect(parseSeedArgs([])).toEqual({ count: 1000, users: 40 });
  });

  it("reads the count, the users and the owner in any order", () => {
    expect(parseSeedArgs(["2000", "--users", "200", "--owner", "Me@Example.com"])).toEqual({ count: 2000, users: 200, owner: "me@example.com" });
    expect(parseSeedArgs(["--users", "200", "2000"])).toMatchObject({ count: 2000, users: 200 });
  });

  it("reads the remote flags", () => {
    expect(parseSeedArgs(["500", "--allow-remote", "--confirm-host", "db.example.com"])).toMatchObject({ allowRemote: true, confirmHost: "db.example.com" });
  });

  it("allows 0 to mean only remove", () => {
    expect(parseSeedArgs(["0"]).count).toBe(0);
  });

  it("refuses nonsense", () => {
    expect(() => parseSeedArgs(["-1"])).toThrow(/count/);
    expect(() => parseSeedArgs(["abc"])).toThrow(/count/);
    expect(() => parseSeedArgs(["20001"])).toThrow(/count/);
    expect(() => parseSeedArgs(["--users", "29"])).toThrow(/--users/);
    expect(() => parseSeedArgs(["--users"])).toThrow(/needs a value/);
    expect(() => parseSeedArgs(["--users", "--owner", "a@b.co"])).toThrow(/needs a value/);
    expect(() => parseSeedArgs(["--owner", "not-an-email"])).toThrow(/email/);
    expect(() => parseSeedArgs(["--owner", "x@seed.local"])).toThrow(/real account/);
    expect(() => parseSeedArgs(["--bogus"])).toThrow(/Unknown option/);
    expect(() => parseSeedArgs(["10", "20"])).toThrow(/Unexpected/);
  });
});
