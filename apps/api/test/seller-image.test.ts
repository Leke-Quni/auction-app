import { afterEach, describe, expect, it } from "vitest";
import { isSellerImage } from "../src/listings/seller-image";

const photo = (path: string, host = "abc123.public.blob.vercel-storage.com") => ({ url: `https://${host}/${path}`, pathname: path });
const saved = process.env.BLOB_PUBLIC_HOST;
afterEach(() => {
  if (saved === undefined) delete process.env.BLOB_PUBLIC_HOST;
  else process.env.BLOB_PUBLIC_HOST = saved;
});

describe("isSellerImage", () => {
  it("accepts a JPG, PNG or WebP photo in the seller's own folder on a Blob store", () => {
    for (const name of ["a.jpg", "a.JPEG", "a.png", "a.webp", "dir/a-x7Yk2.webp"]) {
      expect(isSellerImage(photo(`listings/u1/${name}`), "u1"), name).toBe(true);
    }
  });

  it("refuses anything that is not an image file, whatever store it is on", () => {
    for (const name of ["a.svg", "a.html", "a.js", "a.gif", "a", "a.jpg.html", "a.png/"]) {
      expect(isSellerImage(photo(`listings/u1/${name}`), "u1"), name).toBe(false);
    }
  });

  it("refuses another seller's folder, a path that differs from the address, traversal, other hosts and plain http", () => {
    expect(isSellerImage(photo("listings/u2/a.jpg"), "u1")).toBe(false);
    expect(isSellerImage(photo("listings/u10/a.jpg"), "u1")).toBe(false);
    expect(isSellerImage({ url: "https://abc123.public.blob.vercel-storage.com/listings/u1/a.jpg", pathname: "listings/u1/b.jpg" }, "u1")).toBe(false);
    expect(isSellerImage(photo("listings/u1/../u2/a.jpg"), "u1")).toBe(false);
    expect(isSellerImage(photo("listings/u1/a.jpg", "evil.example.com"), "u1")).toBe(false);
    expect(isSellerImage(photo("listings/u1/a.jpg", "abc123.public.blob.vercel-storage.com.evil.com"), "u1")).toBe(false);
    expect(isSellerImage({ url: "http://abc123.public.blob.vercel-storage.com/listings/u1/a.jpg", pathname: "listings/u1/a.jpg" }, "u1")).toBe(false);
    expect(isSellerImage({ url: "not a url", pathname: "listings/u1/a.jpg" }, "u1")).toBe(false);
  });

  it("accepts only our own store when its host is configured", () => {
    process.env.BLOB_PUBLIC_HOST = "Mine123.public.blob.vercel-storage.com";
    expect(isSellerImage(photo("listings/u1/a.jpg", "mine123.public.blob.vercel-storage.com"), "u1")).toBe(true);
    expect(isSellerImage(photo("listings/u1/a.jpg", "MINE123.public.blob.vercel-storage.com"), "u1")).toBe(true);
    // Another store on the same service, which anyone can create, is no longer accepted.
    expect(isSellerImage(photo("listings/u1/a.jpg", "theirs456.public.blob.vercel-storage.com"), "u1")).toBe(false);
    expect(isSellerImage(photo("listings/u1/a.jpg", "abc123.public.blob.vercel-storage.com"), "u1")).toBe(false);
  });
});
