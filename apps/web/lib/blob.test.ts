import { describe, expect, it, vi } from "vitest";
import { deleteOwnBlobs, isOwnBlobUrl } from "./blob";

const own = (name: string) => `https://abc.public.blob.vercel-storage.com/listings/u1/${name}.jpg`;

describe("isOwnBlobUrl", () => {
  it("accepts a photo in the user's own folder on the public Blob host", () => {
    expect(isOwnBlobUrl(own("a"), "u1")).toBe(true);
    expect(isOwnBlobUrl(own("a b"), "u1")).toBe(true);
  });

  it("refuses other folders, other hosts, other schemes, and path tricks", () => {
    for (const url of [
      "https://abc.public.blob.vercel-storage.com/listings/u2/a.jpg",
      "https://abc.public.blob.vercel-storage.com/listings/u10/a.jpg",
      "https://abc.public.blob.vercel-storage.com/other/u1/a.jpg",
      "https://evil.example.com/listings/u1/a.jpg",
      "http://abc.public.blob.vercel-storage.com/listings/u1/a.jpg",
      "https://abc.private.blob.vercel-storage.com/listings/u1/a.jpg",
      "https://abc.public.blob.vercel-storage.com/listings/u1/../u2/a.jpg",
      "https://abc.public.blob.vercel-storage.com/listings/u1/%2e%2e/u2/a.jpg",
      "not a url",
      "",
    ]) {
      expect(isOwnBlobUrl(url, "u1")).toBe(false);
    }
  });
});

describe("deleteOwnBlobs", () => {
  it("deletes only the user's own photos, in one call", async () => {
    const remove = vi.fn(async () => {});
    await deleteOwnBlobs([own("a"), "https://abc.public.blob.vercel-storage.com/listings/u2/x.jpg", own("b")], "u1", remove as never);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith([own("a"), own("b")]);
  });

  it("does nothing when there is nothing of the user's to delete", async () => {
    const remove = vi.fn(async () => {});
    await deleteOwnBlobs([], "u1", remove as never);
    await deleteOwnBlobs(["https://evil.example.com/a.jpg"], "u1", remove as never);
    expect(remove).not.toHaveBeenCalled();
  });

  it("logs and carries on when Blob fails, so saving a listing never fails because of cleanup", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const remove = vi.fn(async () => {
      throw new Error("Blob is down");
    });
    await expect(deleteOwnBlobs([own("a")], "u1", remove as never)).resolves.toBeUndefined();
    expect(warn.mock.calls[0][0]).toContain("Blob is down");
    warn.mockRestore();
  });
});
