import { describe, it, expect } from "vitest";
import {
  classifyEntropy,
  decodeStruct,
  encodePointer,
  findAll,
  findDataXrefs,
  locateStringVaddrs,
  offsetToVaddr,
  parseLayout,
  parseRabinSections,
  readCString,
  shannonEntropy,
  vaddrToOffset,
  type Section,
} from "../src/lib/re-binary.js";

const bytes = (...xs: number[]) => Uint8Array.from(xs);
const ascii = (s: string) => Uint8Array.from(Buffer.from(s, "latin1"));

// Synthetic 32-bit image: a "code" section and a "data" section at an image base.
const sections: Section[] = [
  { name: ".text", paddr: 0x00, size: 0x40, vaddr: 0x1000, vsize: 0x40, perm: "-r-x" },
  { name: ".data", paddr: 0x40, size: 0x40, vaddr: 0x2000, vsize: 0x80, perm: "-rw-" },
];

describe("shannonEntropy / classifyEntropy", () => {
  it("is null for empty input", () => {
    expect(shannonEntropy(new Uint8Array())).toBeNull();
    expect(classifyEntropy(null)).toBe("empty");
  });
  it("is 0 for a constant buffer and 8 for all 256 values", () => {
    expect(shannonEntropy(new Uint8Array(64))).toBe(0);
    expect(shannonEntropy(Uint8Array.from({ length: 256 }, (_, i) => i))).toBeCloseTo(8);
  });
  it("is 1 bit for two equally likely symbols", () => {
    expect(shannonEntropy(bytes(0, 1, 0, 1))).toBeCloseTo(1);
  });
  it("classifies by threshold", () => {
    expect(classifyEntropy(7.99)).toBe("encrypted_or_compressed");
    expect(classifyEntropy(7.5)).toBe("encrypted_or_compressed");
    expect(classifyEntropy(6.2)).toBe("code_or_mixed");
    expect(classifyEntropy(4.5)).toBe("code_or_mixed");
    expect(classifyEntropy(1.9)).toBe("structured_or_sparse");
  });
});

describe("parseRabinSections", () => {
  const row = { name: ".text", size: 16, vsize: 32, perm: "-r-x", paddr: 1024, vaddr: 4096, flags: 1 };
  it("reads the {sections:[...]} shape and drops empty sections", () => {
    const out = parseRabinSections(JSON.stringify({ sections: [row, { name: "empty", size: 0, vsize: 0 }] }));
    expect(out).toEqual([{ name: ".text", paddr: 1024, size: 16, vaddr: 4096, vsize: 32, perm: "-r-x" }]);
  });
  it("reads a bare array and defaults missing fields", () => {
    expect(parseRabinSections(JSON.stringify([{ size: 4 }]))).toEqual([
      { name: "", paddr: 0, size: 4, vaddr: 0, vsize: 0, perm: "" },
    ]);
  });
  it("returns [] when there is no section list", () => {
    expect(parseRabinSections(JSON.stringify({ other: 1 }))).toEqual([]);
  });
});

describe("address mapping", () => {
  it("maps vaddr to file offset only where raw data exists", () => {
    expect(vaddrToOffset(sections, 0x1010)).toBe(0x10);
    expect(vaddrToOffset(sections, 0x2010)).toBe(0x50);
    // .data has vsize 0x80 but only 0x40 bytes on disk
    expect(vaddrToOffset(sections, 0x2050)).toBeNull();
    expect(vaddrToOffset(sections, 0x9999)).toBeNull();
  });
  it("falls back to size when vsize is 0", () => {
    expect(vaddrToOffset([{ ...sections[0], vsize: 0 }], 0x1004)).toBe(0x04);
  });
  it("maps file offset to vaddr and section", () => {
    expect(offsetToVaddr(sections, 0x44)).toEqual({ vaddr: 0x2004, section: ".data" });
    expect(offsetToVaddr(sections, 0x200)).toBeNull();
  });
});

describe("findAll / readCString", () => {
  const buf = ascii("TempCloneForm\0CloneForm\0xCloneForm\0");
  const needle = ascii("CloneForm\0");
  it("finds every occurrence", () => {
    expect(findAll(buf, needle)).toEqual([4, 14, 25]);
  });
  it("can require a NUL before the match, so tails of longer strings don't count", () => {
    expect(findAll(buf, needle, { requireNulBefore: true })).toEqual([14]);
    expect(findAll(ascii("CloneForm\0"), needle, { requireNulBefore: true })).toEqual([0]);
  });
  it("respects max and ignores an empty needle", () => {
    expect(findAll(buf, needle, { max: 1 })).toEqual([4]);
    expect(findAll(buf, new Uint8Array())).toEqual([]);
  });
  it("reads printable NUL-terminated strings only", () => {
    expect(readCString(buf, 14)).toBe("CloneForm");
    expect(readCString(bytes(0x41, 0x01, 0x00), 0)).toBeNull();
    expect(readCString(ascii("unterminated"), 0)).toBeNull();
    expect(readCString(ascii("abc\0"), 0, 2)).toBeNull();
    expect(readCString(buf, -1)).toBeNull();
    expect(readCString(buf, buf.length)).toBeNull();
  });
});

describe("parseLayout", () => {
  it("packs fields back to back with pointer width applied", () => {
    expect(parseLayout("ptr:a, u16:b, u8:c, f64:d", 4)).toEqual([
      { name: "a", type: "ptr", offset: 0, size: 4 },
      { name: "b", type: "u16", offset: 4, size: 2 },
      { name: "c", type: "u8", offset: 6, size: 1 },
      { name: "d", type: "f64", offset: 7, size: 8 },
    ]);
    expect(parseLayout("ptr:a,u32:b", 8)[1].offset).toBe(8);
  });
  it("rejects bad fields and empty layouts", () => {
    expect(() => parseLayout("ptr:a,bogus:b", 4)).toThrow(/Bad layout field "bogus:b"/);
    expect(() => parseLayout("u32", 4)).toThrow(/Bad layout field/);
    expect(() => parseLayout(" , ", 4)).toThrow(/empty/);
  });
});

describe("decodeStruct / encodePointer", () => {
  // .data layout at file offset 0x40: string "hi\0" at +0x00 (vaddr 0x2000),
  // then a record at +0x10 pointing at it.
  const img = new Uint8Array(0x80);
  img.set(ascii("hi\0"), 0x40);
  const rec = Buffer.alloc(0x2c);
  rec.writeUInt32LE(0x2000, 0); // ptr -> "hi"
  rec.writeUInt32LE(0, 4); // null ptr
  rec.writeUInt32LE(0x9999, 8); // ptr outside any section
  rec.writeUInt32LE(0x1000, 12); // ptr into code, not a string
  rec.writeInt8(-2, 16);
  rec.writeUInt8(200, 17);
  rec.writeInt16LE(-3, 18);
  rec.writeUInt16LE(65000, 20);
  rec.writeInt32LE(-4, 22);
  rec.writeFloatLE(1.5, 26);
  img.set(rec, 0x50);
  img[0x00] = 0x90; // non-printable byte so the code pointer has no string
  const layout = parseLayout("ptr:s,ptr:z,ptr:far,ptr:code,i8:a,u8:b,i16:c,u16:d,i32:e,f32:f", 4);

  it("decodes each type and resolves pointers", () => {
    const out = decodeStruct(img, 0x50, layout, sections)!;
    const by = Object.fromEntries(out.map((f) => [f.name, f]));
    expect(by.s).toMatchObject({ value: 0x2000, hex: "0x2000", points_to: { section: ".data", string: "hi" } });
    expect(by.z).toMatchObject({ value: 0, points_to: null });
    expect(by.far).toMatchObject({ points_to: { section: null, string: null } });
    expect(by.code).toMatchObject({ points_to: { section: ".text", string: null } });
    expect(by.a).toMatchObject({ value: -2, hex: "0xfffffffe" });
    expect(by.b.value).toBe(200);
    expect(by.c.value).toBe(-3);
    expect(by.d.value).toBe(65000);
    expect(by.e.value).toBe(-4);
    expect(by.f.value).toBe(1.5);
    expect(by.f.hex).toBeUndefined();
  });
  it("decodes 64-bit integers and pointers as exact values", () => {
    const b = Buffer.alloc(32);
    b.writeBigUInt64LE(2n ** 63n, 0);
    b.writeBigInt64LE(-5n, 8);
    b.writeBigUInt64LE(0x2000n, 16);
    b.writeDoubleLE(0.25, 24);
    const out = decodeStruct(b, 0, parseLayout("u64:a,i64:b,ptr:p,f64:d", 8), [])!;
    expect(out.map((f) => f.value)).toEqual(["9223372036854775808", "-5", 0x2000, 0.25]);
  });
  it("returns null when the struct runs out of bounds", () => {
    expect(decodeStruct(img, 0x7f, layout, sections)).toBeNull();
    expect(decodeStruct(img, -1, layout, sections)).toBeNull();
  });
  it("encodes little-endian pointers", () => {
    expect([...encodePointer(0x10203040, 4)]).toEqual([0x40, 0x30, 0x20, 0x10]);
    expect([...encodePointer(0x10, 8)]).toEqual([0x10, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("locateStringVaddrs / findDataXrefs", () => {
  // String "Cmd\0" at file 0x44 (vaddr 0x2004), plus "XCmd\0" whose tail must not count.
  // Two records point at it: an aligned one at 0x50 and a misaligned one at 0x61.
  const img = new Uint8Array(0x80);
  img.set(ascii("\0Cmd\0XCmd\0"), 0x43);
  const rec = Buffer.alloc(12);
  rec.writeUInt32LE(0x1234, 0); // handler
  rec.writeUInt32LE(0x2004, 4); // name -> "Cmd"
  rec.writeUInt32LE(7, 8);
  img.set(rec, 0x4c);
  img.set(encodePointer(0x2004, 4), 0x61);

  it("finds standalone strings inside sections only", () => {
    expect(locateStringVaddrs(img, sections, "Cmd")).toEqual([{ offset: 0x44, vaddr: 0x2004, section: ".data" }]);
    expect(locateStringVaddrs(img, [], "Cmd")).toEqual([]);
  });

  it("reports every pointer hit with alignment and decodes the enclosing struct", () => {
    const layout = parseLayout("ptr:handler,ptr:name,u32:n", 4);
    const { hits, total } = findDataXrefs(img, sections, 0x2004, { pointerSize: 4, layout, pointerField: "name", limit: 10 });
    expect(total).toBe(2);
    expect(hits[0]).toMatchObject({ file_offset: "0x50", vaddr: "0x2010", section: ".data", aligned: true });
    expect(hits[0].struct?.start_vaddr).toBe("0x200c");
    expect(hits[0].struct?.fields.map((f) => f.value)).toEqual([0x1234, 0x2004, 7]);
    expect(hits[0].struct?.fields[1].points_to?.string).toBe("Cmd");
    expect(hits[1].aligned).toBe(false);
  });

  it("works without a layout, truncates to limit, and reports out-of-section hits", () => {
    const { hits, total } = findDataXrefs(img, sections, 0x2004, { pointerSize: 4, limit: 1 });
    expect(total).toBe(2);
    expect(hits).toHaveLength(1);
    expect(hits[0].struct).toBeNull();
    const none = findDataXrefs(img, [], 0x2004, { pointerSize: 4, limit: 5 });
    expect(none.hits[0]).toMatchObject({ vaddr: null, section: null });
  });

  it("returns a null struct when it would start outside the file or section", () => {
    const layout = parseLayout("u32:pad,u32:pad2,u32:pad3,ptr:name", 4);
    const { hits } = findDataXrefs(img, [], 0x2004, { pointerSize: 4, layout, pointerField: "name", limit: 5 });
    expect(hits[0].struct).toEqual({ start_vaddr: null, fields: expect.any(Array) });
    const tooFar = parseLayout("ptr:name,u32:a,u32:b,u32:c,u32:d,u32:e,u32:f,u32:g", 4);
    const r = findDataXrefs(img, sections, 0x2004, { pointerSize: 4, layout: tooFar, pointerField: "name", limit: 5 });
    expect(r.hits[1].struct).toBeNull();
  });

  it("rejects a pointer_field that is missing or not a pointer", () => {
    const layout = parseLayout("ptr:a,u32:b", 4);
    expect(() => findDataXrefs(img, sections, 1, { pointerSize: 4, layout, pointerField: "nope", limit: 1 })).toThrow(/not in the layout/);
    expect(() => findDataXrefs(img, sections, 1, { pointerSize: 4, layout, pointerField: "b", limit: 1 })).toThrow(/must be a ptr field/);
  });
});
