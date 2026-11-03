import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, authedApiFetch, redirect } = vi.hoisted(() => ({
  auth: vi.fn(),
  authedApiFetch: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/api", () => ({ authedApiFetch }));
vi.mock("next/navigation", () => ({ redirect }));

import { payWithTestCardAction, startPaymentAction } from "./actions";

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  auth.mockReset().mockResolvedValue({ user: { id: "u1" } });
  authedApiFetch.mockReset();
  redirect.mockClear();
});

describe("startPaymentAction", () => {
  it("needs a signed-in user", async () => {
    auth.mockResolvedValue(null);
    expect(await startPaymentAction("o1")).toEqual({ error: "Sign in to pay." });
    expect(authedApiFetch).not.toHaveBeenCalled();
  });

  it("sends the buyer to the provider's checkout", async () => {
    authedApiFetch.mockResolvedValue(reply(201, { url: "https://pay.example/session" }));
    await expect(startPaymentAction("o1")).rejects.toThrow("REDIRECT https://pay.example/session");
    expect(authedApiFetch).toHaveBeenCalledWith("/orders/o1/checkout", { method: "POST" });
  });

  it("says why it was refused", async () => {
    authedApiFetch.mockResolvedValue(reply(409, { code: "PAYMENT_WINDOW_CLOSED" }));
    expect(await startPaymentAction("o1")).toEqual({ error: "The time to pay for this order has run out." });
    authedApiFetch.mockResolvedValue(reply(500, {}));
    expect(await startPaymentAction("o1")).toEqual({ error: "Something went wrong. Try again." });
    authedApiFetch.mockResolvedValue(reply(401, {}));
    expect((await startPaymentAction("o1")).error).toContain("expired");
    authedApiFetch.mockRejectedValue(new Error("down"));
    expect((await startPaymentAction("o1")).error).toContain("Could not reach");
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("payWithTestCardAction", () => {
  it("marks the test payment, confirms it, and returns to the order", async () => {
    authedApiFetch.mockResolvedValue(reply(201, {}));
    await expect(payWithTestCardAction("o1")).rejects.toThrow("REDIRECT /orders/o1");
    expect(authedApiFetch.mock.calls.map((c) => c[0])).toEqual(["/orders/o1/test-pay", "/orders/o1/confirm"]);
  });

  it("stops and explains when the payment step is refused", async () => {
    authedApiFetch.mockResolvedValue(reply(404, { code: "NOT_FOUND" }));
    expect(await payWithTestCardAction("o1")).toEqual({ error: "That order does not exist." });
    expect(authedApiFetch).toHaveBeenCalledTimes(1);
    expect(redirect).not.toHaveBeenCalled();
  });
});
