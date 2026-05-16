import { describe, it, expect } from "vitest";
import { parsePageRange } from "../src/lib/pdf-pages.js";

describe("parsePageRange", () => {
  it("parses a single page", () => {
    expect(parsePageRange("3", 10)).toEqual([3]);
  });

  it("parses a range", () => {
    expect(parsePageRange("2-5", 10)).toEqual([2, 3, 4, 5]);
  });

  it("parses a reversed range (to < from)", () => {
    expect(parsePageRange("5-2", 10)).toEqual([2, 3, 4, 5]);
  });

  it("parses multiple comma-separated segments", () => {
    expect(parsePageRange("1,3,5-7", 10)).toEqual([1, 3, 5, 6, 7]);
  });

  it("deduplicates overlapping ranges", () => {
    expect(parsePageRange("1-3,2-4", 10)).toEqual([1, 2, 3, 4]);
  });

  it("returns results sorted ascending", () => {
    expect(parsePageRange("5,1,3", 10)).toEqual([1, 3, 5]);
  });

  it("throws on a non-numeric segment", () => {
    expect(() => parsePageRange("abc", 10)).toThrow('Invalid page number "abc"');
  });

  it("throws on a range with a non-numeric bound", () => {
    expect(() => parsePageRange("1-abc", 10)).toThrow('Invalid page range "1-abc"');
  });

  it("throws when a page number is below 1", () => {
    expect(() => parsePageRange("0", 10)).toThrow("Page 0 out of bounds");
  });

  it("throws when a page number exceeds totalPages", () => {
    expect(() => parsePageRange("11", 10)).toThrow("Page 11 out of bounds");
  });

  it("throws when a range spans beyond totalPages", () => {
    expect(() => parsePageRange("8-12", 10)).toThrow("out of bounds");
  });

  it("handles a single-page PDF", () => {
    expect(parsePageRange("1", 1)).toEqual([1]);
  });

  it("handles whitespace around segments", () => {
    expect(parsePageRange(" 1 , 3 ", 10)).toEqual([1, 3]);
  });
});
