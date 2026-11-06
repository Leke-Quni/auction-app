import { describe, expect, it } from "vitest";
import { bidFailure } from "../src/bids/bids.service";

describe("bidFailure", () => {
  it("turns a repeated bid key into a 409 with its code", () => {
    const failure = bidFailure({ code: "P2002" })!;
    expect(failure.getStatus()).toBe(409);
    expect(failure.getResponse()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("answers 404 when the listing or the bidder was deleted while the bid ran", () => {
    const failure = bidFailure({ code: "P2003" })!;
    expect(failure.getStatus()).toBe(404);
    expect(failure.getResponse()).toMatchObject({ code: "NOT_FOUND" });
  });

  it("answers 503 and says the bid was not placed when the database is too busy or the bid waited too long", () => {
    for (const code of ["P2024", "P2028"]) {
      const failure = bidFailure({ code })!;
      expect(failure.getStatus(), code).toBe(503);
      expect(failure.getResponse(), code).toMatchObject({ code: "BUSY", message: expect.stringContaining("not placed") });
    }
  });

  it("answers 503 when no database connection became free in time", () => {
    const failure = bidFailure(new Error("timeout exceeded when trying to connect"))!;
    expect(failure.getStatus()).toBe(503);
    expect(failure.getResponse()).toMatchObject({ code: "BUSY" });
  });

  it("leaves anything else alone, whatever it is", () => {
    for (const error of [new Error("boom"), { code: "P9999" }, null, undefined, "text"]) {
      expect(bidFailure(error)).toBeUndefined();
    }
  });
});
