// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saveShippingAndPayAction = vi.fn();
vi.mock("../../actions", () => ({ saveShippingAndPayAction: (...args: unknown[]) => saveShippingAndPayAction(...args) }));

import { ShippingForm } from "./shipping-form";

const options = [
  { id: "standard", name: "Standard", estimatedDays: 6, tracked: false, insured: false, priceCents: 300 },
  { id: "express", name: "Express", estimatedDays: 2, tracked: true, insured: false, priceCents: 900 },
];

const fill = () => {
  const set = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  set(/full name/i, "Ada Buyer");
  set(/street address/i, "Rr. Nene Tereza 1");
  set(/city/i, "Prishtina");
  set(/postcode/i, "10000");
  set("Country", "XK");
  fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "44 111 222" } });
};

beforeEach(() => saveShippingAndPayAction.mockReset().mockResolvedValue({}));
afterEach(cleanup);

describe("ShippingForm", () => {
  it("lists the options with their prices and totals the chosen one with the item price", () => {
    render(<ShippingForm orderId="o1" amountCents={3150} options={options} saved={null} savedOptionId={null} />);
    expect(screen.getByText("Total: €34.50")).toBeTruthy(); // the first option is chosen: 31.50 + 3.00
    fireEvent.click(screen.getByLabelText(/Express/));
    expect(screen.getByText("Total: €40.50")).toBeTruthy();
    expect(screen.getByRole("button", { name: /continue to payment \(€40.50\)/i })).toBeTruthy();
  });

  it("starts from the delivery chosen before, if any", () => {
    render(<ShippingForm orderId="o1" amountCents={3150} options={options} saved={{ name: "Ada Buyer", line1: "Rr. Nene Tereza 1", city: "Prishtina", postcode: "10000", country: "XK", phone: "+38344111222" }} savedOptionId="express" />);
    expect((screen.getByLabelText(/Express/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/street address/i) as HTMLInputElement).value).toBe("Rr. Nene Tereza 1");
    expect((screen.getByLabelText("Phone country code") as HTMLSelectElement).value).toBe("383");
    expect((screen.getByLabelText("Phone number") as HTMLInputElement).value).toBe("44111222");
  });

  it("sends the address and the chosen option id, not a price, to pay", async () => {
    render(<ShippingForm orderId="o1" amountCents={3150} options={options} saved={null} savedOptionId={null} />);
    fill();
    fireEvent.click(screen.getByLabelText(/Express/));
    fireEvent.click(screen.getByRole("button", { name: /continue to payment/i }));
    await waitFor(() =>
      expect(saveShippingAndPayAction).toHaveBeenCalledWith("o1", expect.objectContaining({ name: "Ada Buyer", city: "Prishtina", country: "XK", phone: "+38344111222" }), "express"),
    );
  });

  it("shows why the save or payment failed", async () => {
    saveShippingAndPayAction.mockResolvedValue({ error: "That delivery option is no longer available. Choose another." });
    render(<ShippingForm orderId="o1" amountCents={3150} options={options} saved={null} savedOptionId={null} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /continue to payment/i }));
    expect((await screen.findByRole("alert")).textContent).toContain("no longer available");
  });

  it("fills the phone prefix from the chosen country until the person picks a code themselves", () => {
    render(<ShippingForm orderId="o1" amountCents={3150} options={options} saved={null} savedOptionId={null} />);
    const code = () => (screen.getByLabelText("Phone country code") as HTMLSelectElement).value;
    expect(code()).toBe("1"); // +1 to start with
    fireEvent.change(screen.getByLabelText("Country"), { target: { value: "AL" } });
    expect(code()).toBe("355");
    fireEvent.change(screen.getByLabelText("Country"), { target: { value: "MK" } });
    expect(code()).toBe("389");
    fireEvent.change(screen.getByLabelText("Phone country code"), { target: { value: "49" } }); // a German number
    fireEvent.change(screen.getByLabelText("Country"), { target: { value: "XK" } });
    expect(code()).toBe("49"); // their choice stays
  });

  it("sends the phone as one international number", async () => {
    render(<ShippingForm orderId="o1" amountCents={3150} options={options} saved={null} savedOptionId={null} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /continue to payment/i }));
    await waitFor(() => expect(saveShippingAndPayAction).toHaveBeenCalledWith("o1", expect.objectContaining({ phone: "+38344111222" }), "standard"));
  });

  it("lists each code as a flag and the code, without country names or help text", () => {
    render(<ShippingForm orderId="o1" amountCents={3150} options={options} saved={null} savedOptionId={null} />);
    const labels = Array.from((screen.getByLabelText("Phone country code") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(labels[0]).toBe("\u{1F1FA}\u{1F1F8} +1");
    expect(labels).toContain("\u{1F1E6}\u{1F1F1} +355");
    expect(labels).toContain("\u{1F1FD}\u{1F1F0} +383");
    expect(labels.join(" ")).not.toMatch(/Albania|Kosovo|United States/);
    expect(screen.getByText("Phone")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/carrier calls|leading 0/);
    expect((screen.getByLabelText("Phone number") as HTMLInputElement).placeholder).toBe("");
  });
});
