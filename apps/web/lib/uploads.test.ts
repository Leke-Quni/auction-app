import { describe, expect, it } from "vitest";
import { authorizeUpload } from "./uploads";

describe("authorizeUpload", () => {
  it("allows an image in the user's own folder", () => {
    for (const name of ["a.jpg", "a.JPEG", "a.png", "a.webp", "dir/a.webp"]) {
      expect(authorizeUpload("u1", `listings/u1/${name}`)).toEqual({ ok: true });
    }
  });

  it("requires a signed-in user", () => {
    expect(authorizeUpload(undefined, "listings/u1/a.jpg")).toMatchObject({ ok: false });
  });

  it("refuses another user's folder, other prefixes, and prefix tricks", () => {
    for (const path of ["listings/u2/a.jpg", "other/u1/a.jpg", "listings/u10/a.jpg", "listings/u1a.jpg", "u1/a.jpg", "/listings/u1/a.jpg"]) {
      expect(authorizeUpload("u1", path)).toMatchObject({ ok: false });
    }
  });

  it("refuses path traversal and very long names", () => {
    expect(authorizeUpload("u1", "listings/u1/../u2/a.jpg")).toMatchObject({ ok: false });
    expect(authorizeUpload("u1", `listings/u1/${"a".repeat(200)}.jpg`)).toMatchObject({ ok: false });
  });

  it("refuses anything that is not a jpg, png, or webp", () => {
    for (const name of ["a.gif", "a.svg", "a.html", "a.exe", "a", "a.jpg.exe"]) {
      expect(authorizeUpload("u1", `listings/u1/${name}`)).toMatchObject({ ok: false });
    }
  });
});
