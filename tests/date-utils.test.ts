import { describe, it, expect } from "vitest";
import { today } from "../src/lib/date-utils.js";

describe("today", () => {
  it("returns a YYYY-MM-DD formatted string", () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("matches the current calendar year", () => {
    const year = new Date().getFullYear().toString();
    expect(today().startsWith(year)).toBe(true);
  });

  it("pads single-digit month and day with leading zeros", () => {
    const parts = today().split("-");
    expect(parts[1]).toHaveLength(2);
    expect(parts[2]).toHaveLength(2);
  });
});
