import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "globals.css"), "utf8");

// The tokens of a rule that starts with `selector {`, as sorted "name: value" lines.
const tokensOf = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThan(-1);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return body.split(";").map((l) => l.trim()).filter(Boolean).sort();
};

describe("dark theme tokens", () => {
  it("are the same whether dark comes from the device setting or from the footer switch", () => {
    const fromDevice = tokensOf(':root:not([data-theme="light"])');
    const fromSwitch = tokensOf(':root[data-theme="dark"]');
    expect(fromDevice.length).toBeGreaterThan(20);
    expect(fromSwitch).toEqual(fromDevice);
  });
});
