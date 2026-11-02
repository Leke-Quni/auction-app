// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PriceSlider } from "./price-slider";

afterEach(cleanup);

const minBox = () => screen.getByLabelText("Minimum price (€)") as HTMLInputElement;
const maxBox = () => screen.getByLabelText("Maximum price (€)") as HTMLInputElement;
const minSlider = () => screen.getByLabelText("Minimum price slider") as HTMLInputElement;
const maxSlider = () => screen.getByLabelText("Maximum price slider") as HTMLInputElement;
// What the form would send: only boxes with a name and something in them.
const sent = () =>
  Object.fromEntries([minBox(), maxBox()].filter((box) => box.name && box.value.trim()).map((box) => [box.name, box.value]));

describe("PriceSlider", () => {
  it("adds no filter until a price is set", () => {
    render(<PriceSlider maxEuros={1000} />);
    expect(sent()).toEqual({});
    expect(minSlider().value).toBe("0");
    expect(maxSlider().value).toBe("1000");
  });

  it("fills in the boxes as a handle is dragged, and sends only the ones that moved", () => {
    render(<PriceSlider maxEuros={1000} />);
    fireEvent.change(minSlider(), { target: { value: "500" } });
    expect(Object.keys(sent())).toEqual(["minPrice"]);
    fireEvent.change(maxSlider(), { target: { value: "800" } });
    expect(Number(sent().maxPrice)).toBeGreaterThan(Number(sent().minPrice));
    fireEvent.change(minSlider(), { target: { value: "0" } });
    expect(minBox().value).toBe("");
    expect(Object.keys(sent())).toEqual(["maxPrice"]);
  });

  it("moves the handles when a price is typed, and sends exactly what was typed", () => {
    render(<PriceSlider maxEuros={1000} />);
    fireEvent.change(minBox(), { target: { value: "123.45" } });
    fireEvent.change(maxBox(), { target: { value: "800" } });
    expect(sent()).toEqual({ minPrice: "123.45", maxPrice: "800" });
    expect(Number(minSlider().value)).toBeGreaterThan(0);
    expect(Number(maxSlider().value)).toBeLessThan(1000);
    expect(Number(minSlider().value)).toBeLessThan(Number(maxSlider().value));
  });

  it("keeps the handle at the end for a price beyond the scale, and ignores text that is not a price", () => {
    render(<PriceSlider maxEuros={1000} />);
    fireEvent.change(maxBox(), { target: { value: "99999" } });
    expect(maxSlider().value).toBe("1000");
    fireEvent.change(minBox(), { target: { value: "cheap" } });
    expect(minSlider().value).toBe("0");
  });

  it("does not let the handles cross", () => {
    render(<PriceSlider maxEuros={1000} />);
    fireEvent.change(maxSlider(), { target: { value: "300" } });
    fireEvent.change(minSlider(), { target: { value: "900" } });
    expect(Number(minSlider().value)).toBeLessThanOrEqual(Number(maxSlider().value));
    expect(Number(minBox().value)).toBeLessThanOrEqual(Number(maxBox().value));
  });

  it("swaps a minimum typed above the maximum once the box is left", () => {
    render(<PriceSlider maxEuros={1000} />);
    fireEvent.change(minBox(), { target: { value: "500" } });
    fireEvent.change(maxBox(), { target: { value: "100" } });
    fireEvent.blur(maxBox());
    expect(sent()).toEqual({ minPrice: "100", maxPrice: "500" });
  });

  it("starts from the prices already in the search", () => {
    render(<PriceSlider maxEuros={1000} initialMin="100" initialMax="500" />);
    expect(sent()).toEqual({ minPrice: "100", maxPrice: "500" });
    expect(Number(minSlider().value)).toBeGreaterThan(0);
  });

  it("goes back to no limit when the prices in the search are cleared", () => {
    const { rerender } = render(<PriceSlider maxEuros={1000} initialMin="100" initialMax="500" />);
    rerender(<PriceSlider maxEuros={1000} />);
    expect(sent()).toEqual({});
    expect(minSlider().value).toBe("0");
    expect(maxSlider().value).toBe("1000");
  });

  it("keeps what the visitor entered while the search is unchanged", () => {
    const { rerender } = render(<PriceSlider maxEuros={1000} />);
    fireEvent.change(minBox(), { target: { value: "40" } });
    rerender(<PriceSlider maxEuros={1000} />);
    expect(sent()).toEqual({ minPrice: "40" });
  });
});
