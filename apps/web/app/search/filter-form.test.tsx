// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/form", () => ({ default: (props: React.ComponentProps<"form">) => <form {...props} /> }));
vi.mock("next/link", () => ({ default: ({ href, ...props }: React.ComponentProps<"a">) => <a href={href as string} {...props} onClick={(e) => (props.onClick?.(e), e.preventDefault())} /> }));

import { ClearFiltersLink, FilterForm } from "./filter-form";

afterEach(cleanup);

const form = () => (
  <FilterForm action="/search">
    <label>
      <input type="checkbox" name="condition" value="GOOD" aria-label="Good" />
    </label>
    <input aria-label="Max" name="maxPrice" defaultValue="" />
    <ClearFiltersLink>Clear</ClearFiltersLink>
  </FilterForm>
);

describe("FilterForm and Clear", () => {
  it("unticks what was ticked but not applied, and empties what was typed", () => {
    render(form());
    fireEvent.click(screen.getByLabelText("Good"));
    fireEvent.change(screen.getByLabelText("Max"), { target: { value: "500" } });
    expect((screen.getByLabelText("Good") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("link", { name: "Clear" }));
    expect((screen.getByLabelText("Good") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("Max") as HTMLInputElement).value).toBe("");
  });

  it("links to the plain search page", () => {
    render(form());
    expect(screen.getByRole("link", { name: "Clear" }).getAttribute("href")).toBe("/search");
  });
});
