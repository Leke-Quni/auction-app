// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Gallery } from "./gallery";

afterEach(cleanup);

const images = [1, 2, 3].map((n) => ({ id: `i${n}`, url: `https://x.example/${n}.jpg` }));

describe("Gallery", () => {
  it("says there are no photos instead of showing a broken image", () => {
    render(<Gallery images={[]} alt="Watch" />);
    expect(screen.getByText("No photos")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("shows no thumbnails for a single photo", () => {
    render(<Gallery images={images.slice(0, 1)} alt="Watch" />);
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("starts on the cover and switches the large photo when a thumbnail is clicked", () => {
    render(<Gallery images={images} alt="Watch" />);
    const big = () => screen.getByRole("img", { name: "Watch" }) as HTMLImageElement;
    expect(big().src).toBe(images[0].url);

    fireEvent.click(screen.getByRole("button", { name: "Show photo 3" }));
    expect(big().src).toBe(images[2].url);
    expect(screen.getByRole("button", { name: "Show photo 3" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Show photo 1" }).getAttribute("aria-pressed")).toBe("false");
  });
});
