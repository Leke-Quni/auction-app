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
    expect(screen.queryByRole("button", { name: /Show photo/ })).toBeNull();
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

  describe("enlarged view", () => {
    const viewer = () => screen.queryByRole("dialog");

    it("opens the clicked photo large and closes with the button, the backdrop or Escape", () => {
      render(<Gallery images={images} alt="Watch" />);
      expect(viewer()).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Enlarge photo" }));
      expect((screen.getByRole("img", { name: "Watch, photo 1 of 3" }) as HTMLImageElement).src).toBe(images[0].url);
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(viewer()).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Enlarge photo" }));
      fireEvent.click(screen.getByRole("dialog"));
      expect(viewer()).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Enlarge photo" }));
      fireEvent.keyDown(document, { key: "Escape" });
      expect(viewer()).toBeNull();
    });

    it("stays open when the photo itself is clicked", () => {
      render(<Gallery images={images} alt="Watch" />);
      fireEvent.click(screen.getByRole("button", { name: "Enlarge photo" }));
      fireEvent.click(screen.getByRole("img", { name: "Watch, photo 1 of 3" }));
      expect(viewer()).not.toBeNull();
    });

    it("opens on the selected thumbnail and steps through photos with the buttons and arrow keys, wrapping round", () => {
      render(<Gallery images={images} alt="Watch" />);
      fireEvent.click(screen.getByRole("button", { name: "Show photo 2" }));
      fireEvent.click(screen.getByRole("button", { name: "Enlarge photo" }));
      expect(screen.getByRole("img", { name: "Watch, photo 2 of 3" })).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
      expect(screen.getByRole("img", { name: "Watch, photo 3 of 3" })).toBeTruthy();
      fireEvent.keyDown(document, { key: "ArrowRight" });
      expect(screen.getByRole("img", { name: "Watch, photo 1 of 3" })).toBeTruthy();
      fireEvent.keyDown(document, { key: "ArrowLeft" });
      expect(screen.getByRole("img", { name: "Watch, photo 3 of 3" })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Previous photo" }));
      expect(screen.getByRole("img", { name: "Watch, photo 2 of 3" })).toBeTruthy();
    });

    it("has no arrows for a single photo", () => {
      render(<Gallery images={images.slice(0, 1)} alt="Watch" />);
      fireEvent.click(screen.getByRole("button", { name: "Enlarge photo" }));
      expect(screen.queryByRole("button", { name: "Next photo" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Previous photo" })).toBeNull();
    });
  });
});
