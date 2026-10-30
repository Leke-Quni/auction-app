// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormState } from "./actions";
import { SettingRow } from "./setting-row";

afterEach(cleanup);

const setup = (action: (s: FormState, f: FormData) => Promise<FormState> = async () => ({})) => {
  render(
    <SettingRow
      label="Username"
      value="ana_k"
      action={action}
      hidden={{ extra: "kept" }}
      fields={[{ name: "username", label: "Username", defaultValue: "ana_k" }]}
    />,
  );
  return {
    edit: () => fireEvent.click(screen.getByRole("button", { name: "Edit username" })),
    input: () => screen.getByDisplayValue("ana_k") as HTMLInputElement,
  };
};

describe("SettingRow", () => {
  it("shows the current value and an Edit button, with the form hidden", () => {
    setup();
    expect(screen.getByText("ana_k")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit username" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("opens the form on Edit, and Cancel closes it and discards typing", () => {
    const { edit, input } = setup();
    edit();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit username" })).toBeNull();

    fireEvent.change(input(), { target: { value: "changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByRole("button", { name: "Edit username" })).toBeTruthy();
    expect(input().value).toBe("ana_k");
  });

  it("submits the visible and hidden fields, then closes and shows the success message", async () => {
    const action = vi.fn<(s: FormState, f: FormData) => Promise<FormState>>(async () => ({ ok: "Username changed." }));
    const { edit, input } = setup(action);
    edit();
    fireEvent.change(input(), { target: { value: "new_name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(action).toHaveBeenCalled());
    const data = action.mock.calls[0][1];
    expect(data.get("username")).toBe("new_name");
    expect(data.get("extra")).toBe("kept");
    await waitFor(() => expect(screen.getByText("Username changed.")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("stays open and shows the error when the save fails", async () => {
    const { edit } = setup(async () => ({ error: "That username is already taken." }));
    edit();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("That username is already taken.")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });
});
