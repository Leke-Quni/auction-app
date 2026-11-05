import { describe, expect, it } from "vitest";
import { assertSafeToSeed } from "./seed-guard";

const local = "postgresql://auction:auction@localhost:5432/auction";

describe("assertSafeToSeed", () => {
  it("allows a local database", () => {
    for (const host of ["localhost:5432", "127.0.0.1:5432", "[::1]:5432"]) {
      expect(() => assertSafeToSeed({ DATABASE_URL: `postgresql://auction:auction@${host}/auction` })).not.toThrow();
    }
    expect(() => assertSafeToSeed({ NODE_ENV: "development", DATABASE_URL: local })).not.toThrow();
  });

  it("refuses production, even for a local database", () => {
    expect(() => assertSafeToSeed({ NODE_ENV: "production", DATABASE_URL: local })).toThrow(/NODE_ENV is production/);
  });

  it("refuses a database that is not local, and names only the host", () => {
    const remote = "postgresql://owner:s3cret-password@ep-cool-name-123.eu-central-1.aws.neon.tech/neondb?sslmode=require";
    expect(() => assertSafeToSeed({ DATABASE_URL: remote })).toThrow(/ep-cool-name-123\.eu-central-1\.aws\.neon\.tech.*not local/);
    try {
      assertSafeToSeed({ DATABASE_URL: remote });
    } catch (error) {
      expect(String(error)).not.toContain("s3cret-password");
    }
  });

  it("is not fooled by a local name inside a remote address", () => {
    expect(() => assertSafeToSeed({ DATABASE_URL: "postgresql://u:p@localhost.example.com:5432/db" })).toThrow(/not local/);
    expect(() => assertSafeToSeed({ DATABASE_URL: "postgresql://localhost:p@db.example.com:5432/db" })).toThrow(/not local/);
  });

  it("refuses a missing or unreadable address", () => {
    expect(() => assertSafeToSeed({})).toThrow(/DATABASE_URL is not set/);
    expect(() => assertSafeToSeed({ DATABASE_URL: "not a url" })).toThrow(/not a valid URL/);
  });

  describe("a remote database, on purpose", () => {
    const remote = "postgresql://owner:s3cret-password@ep-cool-name-123.eu-central-1.aws.neon.tech/neondb?sslmode=require";
    const host = "ep-cool-name-123.eu-central-1.aws.neon.tech";

    it("needs both flags, and the host typed back exactly", () => {
      expect(() => assertSafeToSeed({ DATABASE_URL: remote }, { allowRemote: true })).toThrow(/--confirm-host must be exactly/);
      expect(() => assertSafeToSeed({ DATABASE_URL: remote }, { confirmHost: host })).toThrow(/--allow-remote --confirm-host ep-cool/);
      expect(() => assertSafeToSeed({ DATABASE_URL: remote }, { allowRemote: true, confirmHost: "ep-other.neon.tech" })).toThrow(/exactly/);
      expect(() => assertSafeToSeed({ DATABASE_URL: remote }, { allowRemote: true, confirmHost: host })).not.toThrow();
    });

    it("still refuses in production, and never prints the password", () => {
      expect(() => assertSafeToSeed({ NODE_ENV: "production", DATABASE_URL: remote }, { allowRemote: true, confirmHost: host })).toThrow(/NODE_ENV is production/);
      for (const options of [{}, { allowRemote: true }, { allowRemote: true, confirmHost: "x" }]) {
        try {
          assertSafeToSeed({ DATABASE_URL: remote }, options);
        } catch (error) {
          expect(String(error)).not.toContain("s3cret-password");
        }
      }
    });
  });
});
