// @vitest-environment jsdom
// Tests the admin app's shared table (apps/admin/components/data-table). It lives here because only this app has the browser-style test
// tools (jsdom, Testing Library); the admin app has none yet.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("") }));

import { DataTable } from "../../admin/components/data-table/data-table";

interface Row {
  id: string;
  name: string;
  status: string;
  note: string;
}
const rows: Row[] = Array.from({ length: 3 }, (_, i) => ({ id: `r${i}`, name: `Row ${i}`, status: "ok", note: "a very long note that does not fit its column" }));
const columns = [
  { header: "Name", render: (r: Row) => r.name },
  { header: "Status", render: (r: Row) => r.status },
  { header: "Note", render: (r: Row) => r.note },
];

// jsdom has no layout: every header cell is 100px wide (300 in all), so a column is a third of the table.
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ total: 45, rows }))));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const w = this.tagName === "TH" ? 100 : 0;
    return { width: w, height: 20, left: 0, top: 0, right: w, bottom: 20, x: 0, y: 0, toJSON() {} } as DOMRect;
  });
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
  HTMLElement.prototype.hasPointerCapture = () => true;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const mount = async () => {
  render(<DataTable module="tmp" params={{}} columns={columns} rowKey={(r: Row) => r.id} rowsField="rows" emptyText="none" />);
  await screen.findByText("Row 0");
};
const handle = (name: string) => screen.getByRole("separator", { name: `Resize the ${name} column` });
// Each column's share of the table, in percent.
const shares = () => [...document.querySelectorAll("col")].map((c) => Math.round(Number.parseFloat((c as HTMLElement).style.width) * 100) / 100);

describe("admin table: column resizing and page numbers", () => {
  it("has a divider after every column but the last, and the natural layout until one is dragged", async () => {
    await mount();
    expect(screen.getAllByRole("separator")).toHaveLength(2);
    expect(screen.queryByRole("separator", { name: "Resize the Note column" })).toBeNull();
    expect(document.querySelector("colgroup")).toBeNull();
    expect(screen.queryByText("Reset column widths")).toBeNull();
    // A line shows between the columns, in the header and in the rows.
    expect(document.querySelector("th")!.className).toContain("border-r");
    expect(document.querySelector("td")!.className).toContain("border-r");
    expect(document.querySelector("thead th:last-child")!.className).not.toContain("border-r");
  });

  it("dragging a divider trades width between the two columns beside it, and no other column moves", async () => {
    await mount();
    const h = handle("Name");
    fireEvent.pointerDown(h, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(h, { clientX: 115, pointerId: 1 });
    expect(shares()).toEqual([38.33, 28.33, 33.33]);
    fireEvent.pointerMove(h, { clientX: 110, pointerId: 1 });
    expect(shares()).toEqual([36.67, 30, 33.33]);
    fireEvent.pointerUp(h, { pointerId: 1 });
    const table = document.querySelector("table")!;
    // The table is always as wide as the page: no sideways scrolling.
    expect(table.style.width).toBe("100%");
    expect(table.style.tableLayout).toBe("fixed");
    expect(shares().reduce((a, b) => a + b, 0)).toBeCloseTo(100, 1);
    expect(JSON.parse(localStorage.getItem("admin-column-widths-v2:tmp")!)).toMatchObject({ Note: expect.closeTo(1 / 3, 3) });
    expect(screen.getByText("Reset column widths")).toBeTruthy();
  });

  it("stops at the minimum width, and never takes it from a column further along", async () => {
    await mount();
    const h = handle("Status");
    fireEvent.pointerDown(h, { button: 0, clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(h, { clientX: 900, pointerId: 1 });
    // 300px wide, 80px minimum: the Note column keeps 80px (26.67%), Name keeps its third.
    expect(shares()).toEqual([33.33, 40, 26.67]);
    fireEvent.pointerMove(h, { clientX: -900, pointerId: 1 });
    expect(shares()).toEqual([33.33, 26.67, 40]);
    fireEvent.pointerUp(h, { pointerId: 1 });
  });

  it("the arrow keys move a divider by 10px", async () => {
    await mount();
    fireEvent.keyDown(handle("Name"), { key: "ArrowRight" });
    expect(shares()).toEqual([36.67, 30, 33.33]);
    fireEvent.keyDown(handle("Name"), { key: "ArrowLeft" });
    fireEvent.keyDown(handle("Name"), { key: "ArrowLeft" });
    expect(shares()).toEqual([30, 36.67, 33.33]);
  });

  it("cuts a cell off at its column's edge on one line instead of wrapping it", async () => {
    await mount();
    expect(document.querySelector("td")!.className).not.toContain("whitespace-nowrap!");
    fireEvent.keyDown(handle("Name"), { key: "ArrowRight" });
    for (const cell of document.querySelectorAll("tbody td")) {
      expect(cell.className).toContain("overflow-hidden");
      expect(cell.className).toContain("whitespace-nowrap!");
      expect(cell.className).toContain("text-ellipsis");
    }
  });

  it("restores saved widths on the next visit, and resets on request or double-click", async () => {
    localStorage.setItem("admin-column-widths-v2:tmp", JSON.stringify({ Name: 0.5, Status: 0.3, Note: 0.2 }));
    await mount();
    await act(async () => {});
    expect(shares()).toEqual([50, 30, 20]);
    fireEvent.click(screen.getByText("Reset column widths"));
    expect(document.querySelector("colgroup")).toBeNull();
    expect(localStorage.getItem("admin-column-widths-v2:tmp")).toBeNull();

    fireEvent.keyDown(handle("Name"), { key: "ArrowRight" });
    expect(document.querySelector("colgroup")).not.toBeNull();
    fireEvent.doubleClick(handle("Status"));
    expect(document.querySelector("colgroup")).toBeNull();
  });

  it("ignores widths saved in the old pixel format", async () => {
    localStorage.setItem("admin-column-widths-v2:tmp", JSON.stringify({ Name: 300, Status: 100, Note: 90 }));
    await mount();
    await act(async () => {});
    expect(document.querySelector("colgroup")).toBeNull();
  });

  it("the table fills the page and the page numbers are pushed to its bottom", async () => {
    await mount();
    const root = document.querySelector("[data-fill-page]") as HTMLElement;
    expect(root.className).toContain("flex-1");
    expect(root.className).toContain("flex-col");
    expect(screen.getByRole("navigation", { name: "Pages" }).className).toContain("mt-auto");
  });
});

describe("admin table: no highlight while dragging", () => {
  it("shows no coloured strip on the divider, and blocks text selection only while it is held", async () => {
    await mount();
    const h = handle("Name");
    expect(h.className).not.toMatch(/bg-accent|hover:bg|focus-visible:bg/);
    fireEvent.pointerDown(h, { button: 0, clientX: 100, pointerId: 1 });
    expect(document.body.style.userSelect).toBe("none");
    expect(document.body.style.cursor).toBe("col-resize");
    fireEvent.pointerUp(h, { pointerId: 1 });
    expect(document.body.style.userSelect).toBe("");
    expect(document.body.style.cursor).toBe("");
  });
});
