import { describe, expect, it, vi } from "vitest";
import { authorizeUpload, getUploadToken, UploadLimitError } from "./uploads";

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

describe("getUploadToken", () => {
  type Token = { delegationToken: string; clientSigningToken: string; validUntil: number };
  const fakeIssue = () =>
    vi.fn<(options: unknown) => Promise<Token>>(async () => ({ delegationToken: "d", clientSigningToken: "c", validUntil: 1 }));

  it("issues a put-only token for images up to 5 MB, scoped to the requested path", async () => {
    const issue = fakeIssue();
    const result = await getUploadToken("u1", "listings/u1/a.jpg", issue as never);

    expect(issue).toHaveBeenCalledTimes(1);
    expect(issue.mock.calls[0][0]).toMatchObject({
      pathname: "listings/u1/a.jpg",
      operations: ["put"],
      allowedContentTypes: ["image/jpeg", "image/png", "image/webp"],
      maximumSizeInBytes: 5 * 1024 * 1024,
    });
    expect(result.token).toEqual({ delegationToken: "d", clientSigningToken: "c", validUntil: 1 });
    expect(result.urlOptions).toMatchObject({
      access: "public",
      allowedContentTypes: ["image/jpeg", "image/png", "image/webp"],
      maximumSizeInBytes: 5 * 1024 * 1024,
      addRandomSuffix: true,
      allowOverwrite: false,
    });
  });

  it("makes the token short-lived (10 minutes)", async () => {
    const before = Date.now();
    const issue = fakeIssue();
    const { urlOptions } = await getUploadToken("u1", "listings/u1/a.jpg", issue as never);
    expect(urlOptions.validUntil).toBeGreaterThanOrEqual(before + 9 * 60 * 1000);
    expect(urlOptions.validUntil).toBeLessThanOrEqual(Date.now() + 10 * 60 * 1000);
  });

  it("refuses, without issuing anything, when the user or path is not allowed", async () => {
    for (const [userId, path, reason] of [
      [undefined, "listings/u1/a.jpg", "Sign in"],
      ["u1", "listings/u2/a.jpg", "own folder"],
      ["u1", "listings/u1/a.gif", "JPG, PNG, and WebP"],
      ["u1", "listings/u1/../u2/a.jpg", "own folder|Invalid"],
    ] as const) {
      const issue = fakeIssue();
      await expect(getUploadToken(userId, path, issue as never)).rejects.toThrow(new RegExp(reason));
      expect(issue).not.toHaveBeenCalled();
    }
  });

  it("counts the upload against the person's limit after the path is accepted and before a token is issued", async () => {
    const order: string[] = [];
    const issue = vi.fn(async () => (order.push("issue"), { delegationToken: "d", clientSigningToken: "c", validUntil: 1 }));
    await getUploadToken("u1", "listings/u1/a.jpg", issue as never, async () => void order.push("reserve"));
    expect(order).toEqual(["reserve", "issue"]);
  });

  it("issues nothing when the person is over the limit, and counts nothing for a refused path", async () => {
    const issue = fakeIssue();
    await expect(getUploadToken("u1", "listings/u1/a.jpg", issue as never, async () => Promise.reject(new UploadLimitError("slow down")))).rejects.toBeInstanceOf(UploadLimitError);
    expect(issue).not.toHaveBeenCalled();

    const reserve = vi.fn(async () => {});
    await expect(getUploadToken("u1", "listings/u2/a.jpg", issue as never, reserve)).rejects.toThrow();
    await expect(getUploadToken(undefined, "listings/u1/a.jpg", issue as never, reserve)).rejects.toThrow();
    expect(reserve).not.toHaveBeenCalled();
  });
});
