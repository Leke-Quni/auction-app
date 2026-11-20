import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));

import AccountPage from "./page";

describe("/account", () => {
  it("goes to the settings page, where the account details now are", () => {
    AccountPage();
    expect(redirect).toHaveBeenCalledWith("/account/settings");
  });
});
