/**
 * Pure helpers for the `re` tool slice that work directly on a binary's
 * bytes: entropy, section address mapping, byte search, C-string reads and
 * fixed-layout struct decoding. No I/O here, so every function is unit
 * testable against synthetic buffers. Little-endian only.
 */

export type Section = {
  name: string;
  paddr: number;
  size: number;
  vaddr: number;
  vsize: number;
  perm: string;
};

export type EntropyClass = "empty" | "encrypted_or_compressed" | "code_or_mixed" | "structured_or_sparse";

/** Shannon entropy in bits per byte (0..8), or null for an empty buffer. */
export function shannonEntropy(buf: Uint8Array): number | null {
  if (buf.length === 0) return null;
  const counts = new Array<number>(256).fill(0);
  for (const b of buf) counts[b]++;
  let h = 0;
  for (const c of counts) {
    if (c === 0) continue;
    const p = c / buf.length;
    h -= p * Math.log2(p);
  }
  return h;
}

// Thresholds are heuristics, not proof: compiled x86/ARM code typically lands
// around 5.5-6.8, encrypted or compressed data at 7.9+, and constant tables
// or zero padding well below 4.5.
export function classifyEntropy(e: number | null): EntropyClass {
  if (e === null) return "empty";
  if (e >= 7.5) return "encrypted_or_compressed";
  if (e >= 4.5) return "code_or_mixed";
  return "structured_or_sparse";
}

/** Accepts rabin2 `-Sj` output (`{sections:[...]}` or a bare array). */
export function parseRabinSections(json: string): Section[] {
  const parsed: unknown = JSON.parse(json);
  const raw = Array.isArray(parsed) ? parsed : (parsed as { sections?: unknown }).sections;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s: Record<string, unknown>) => ({
      name: String(s.name ?? ""),
      paddr: Number(s.paddr ?? 0),
      size: Number(s.size ?? 0),
      vaddr: Number(s.vaddr ?? 0),
      vsize: Number(s.vsize ?? 0),
      perm: String(s.perm ?? ""),
    }))
    .filter((s) => s.size > 0 || s.vsize > 0);
}

/** File offset backing a virtual address, or null if no section's raw data covers it. */
export function vaddrToOffset(sections: Section[], va: number): number | null {
  for (const s of sections) {
    const span = Math.min(s.size, s.vsize || s.size);
    if (va >= s.vaddr && va < s.vaddr + span) return s.paddr + (va - s.vaddr);
  }
  return null;
}

export function offsetToVaddr(sections: Section[], off: number): { vaddr: number; section: string } | null {
  for (const s of sections) {
    if (off >= s.paddr && off < s.paddr + s.size) {
      return { vaddr: s.vaddr + (off - s.paddr), section: s.name };
    }
  }
  return null;
}

/**
 * Every offset where `needle` occurs. `requireNulBefore` rejects matches that
 * are the tail of a longer string ("CloneForm" inside "TempCloneForm").
 */
export function findAll(
  buf: Uint8Array,
  needle: Uint8Array,
  opts: { requireNulBefore?: boolean; max?: number } = {},
): number[] {
  const hits: number[] = [];
  if (needle.length === 0) return hits;
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  let i = b.indexOf(needle);
  while (i !== -1 && hits.length < (opts.max ?? Infinity)) {
    if (!opts.requireNulBefore || i === 0 || b[i - 1] === 0) hits.push(i);
    i = b.indexOf(needle, i + 1);
  }
  return hits;
}

/** Printable-ASCII NUL-terminated string at `off`, or null if it isn't one. */
export function readCString(buf: Uint8Array, off: number, maxLen = 512): string | null {
  if (off < 0 || off >= buf.length) return null;
  let s = "";
  for (let i = off; i < Math.min(buf.length, off + maxLen); i++) {
    const c = buf[i];
    if (c === 0) return s;
    if (c < 0x20 || c > 0x7e) return null;
    s += String.fromCharCode(c);
  }
  return null;
}

export type FieldType = "u8" | "u16" | "u32" | "u64" | "i8" | "i16" | "i32" | "i64" | "f32" | "f64" | "ptr";
export type Field = { name: string; type: FieldType; offset: number; size: number };

const FIELD_SIZES: Record<Exclude<FieldType, "ptr">, number> = {
  u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4, f32: 4, u64: 8, i64: 8, f64: 8,
};

/**
 * Parses a packed field list like "ptr:name,u32:opcode,u16:count". Fields are
 * laid out back to back with no implicit padding; add explicit padding fields
 * (e.g. "u16:_pad") where the real struct has them.
 */
export function parseLayout(spec: string, pointerSize: 4 | 8): Field[] {
  const fields: Field[] = [];
  let offset = 0;
  for (const part of spec.split(",").map((p) => p.trim()).filter(Boolean)) {
    const m = /^(u8|u16|u32|u64|i8|i16|i32|i64|f32|f64|ptr):([A-Za-z_]\w*)$/.exec(part);
    if (!m) throw new Error(`Bad layout field "${part}": expected <type>:<name>, type one of u8..u64, i8..i64, f32, f64, ptr`);
    const type = m[1] as FieldType;
    const size = type === "ptr" ? pointerSize : FIELD_SIZES[type];
    fields.push({ name: m[2], type, offset, size });
    offset += size;
  }
  if (fields.length === 0) throw new Error("Layout is empty");
  return fields;
}

export type DecodedField = {
  name: string;
  type: FieldType;
  offset: number;
  value: number | string;
  hex?: string;
  points_to?: { section: string | null; string: string | null } | null;
};

/**
 * Decodes `fields` from `buf` starting at `start`. Pointer fields are resolved
 * through `sections`: which section they land in, and the C string there if
 * one is readable. Returns null if the struct runs past the buffer.
 */
export function decodeStruct(
  buf: Uint8Array,
  start: number,
  fields: Field[],
  sections: Section[],
): DecodedField[] | null {
  const last = fields[fields.length - 1];
  if (start < 0 || start + last.offset + last.size > buf.length) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return fields.map((f) => {
    const at = start + f.offset;
    const out: DecodedField = { name: f.name, type: f.type, offset: f.offset, value: 0 };
    switch (f.type) {
      case "u8": out.value = dv.getUint8(at); break;
      case "i8": out.value = dv.getInt8(at); break;
      case "u16": out.value = dv.getUint16(at, true); break;
      case "i16": out.value = dv.getInt16(at, true); break;
      case "u32": out.value = dv.getUint32(at, true); break;
      case "i32": out.value = dv.getInt32(at, true); break;
      case "f32": out.value = dv.getFloat32(at, true); break;
      case "f64": out.value = dv.getFloat64(at, true); break;
      case "u64": out.value = dv.getBigUint64(at, true).toString(); break;
      case "i64": out.value = dv.getBigInt64(at, true).toString(); break;
      case "ptr": {
        const v = f.size === 8 ? Number(dv.getBigUint64(at, true)) : dv.getUint32(at, true);
        out.value = v;
        out.hex = `0x${v.toString(16)}`;
        if (v === 0) {
          out.points_to = null;
        } else {
          const off = vaddrToOffset(sections, v);
          const sec = sections.find((s) => v >= s.vaddr && v < s.vaddr + Math.max(s.vsize, s.size));
          out.points_to = { section: sec?.name ?? null, string: off === null ? null : readCString(buf, off) };
        }
        break;
      }
    }
    if (f.type !== "ptr" && f.type !== "f32" && f.type !== "f64" && typeof out.value === "number") {
      out.hex = `0x${(out.value >>> 0).toString(16)}`;
    }
    return out;
  });
}

export function encodePointer(va: number, pointerSize: 4 | 8): Uint8Array {
  const b = Buffer.alloc(pointerSize);
  if (pointerSize === 8) b.writeBigUInt64LE(BigInt(va));
  else b.writeUInt32LE(va >>> 0);
  return b;
}

/** Virtual addresses of every standalone NUL-terminated occurrence of `text`. */
export function locateStringVaddrs(buf: Uint8Array, sections: Section[], text: string): { offset: number; vaddr: number; section: string }[] {
  const needle = Buffer.concat([Buffer.from(text, "utf8"), Buffer.from([0])]);
  return findAll(buf, needle, { requireNulBefore: true })
    .map((offset) => {
      const m = offsetToVaddr(sections, offset);
      return m ? { offset, vaddr: m.vaddr, section: m.section } : null;
    })
    .filter((x): x is { offset: number; vaddr: number; section: string } => x !== null);
}

export type DataXrefHit = {
  file_offset: string;
  vaddr: string | null;
  section: string | null;
  aligned: boolean;
  struct: { start_vaddr: string | null; fields: DecodedField[] } | null;
};

/**
 * Every place `target` is stored as a little-endian pointer. With a layout,
 * also decodes the enclosing struct, assuming the pointer sits in `pointerField`
 * (default: the layout's first field).
 */
export function findDataXrefs(
  buf: Uint8Array,
  sections: Section[],
  target: number,
  opts: { pointerSize: 4 | 8; layout?: Field[]; pointerField?: string; limit: number },
): { hits: DataXrefHit[]; total: number } {
  const all = findAll(buf, encodePointer(target, opts.pointerSize));
  let fieldOffset = 0;
  if (opts.layout && opts.pointerField) {
    const f = opts.layout.find((x) => x.name === opts.pointerField);
    if (!f) throw new Error(`pointer_field "${opts.pointerField}" is not in the layout`);
    if (f.type !== "ptr") throw new Error(`pointer_field "${opts.pointerField}" must be a ptr field, got ${f.type}`);
    fieldOffset = f.offset;
  }
  const hits = all.slice(0, opts.limit).map((off) => {
    const m = offsetToVaddr(sections, off);
    let struct: DataXrefHit["struct"] = null;
    if (opts.layout) {
      const start = off - fieldOffset;
      const fields = decodeStruct(buf, start, opts.layout, sections);
      const sv = offsetToVaddr(sections, start);
      struct = fields ? { start_vaddr: sv ? `0x${sv.vaddr.toString(16)}` : null, fields } : null;
    }
    return {
      file_offset: `0x${off.toString(16)}`,
      vaddr: m ? `0x${m.vaddr.toString(16)}` : null,
      section: m?.section ?? null,
      aligned: off % opts.pointerSize === 0,
      struct,
    };
  });
  return { hits, total: all.length };
}

export type ByteRange = { start: number; end: number; length: number };

export type ByteDiff = {
  identical: boolean;
  size_a: number;
  size_b: number;
  compared_bytes: number;
  changed_bytes: number;
  tail_bytes: number;
  ranges: ByteRange[];
  ranges_total: number;
};

/**
 * Byte-level diff of two buffers. Runs of differing bytes separated by fewer
 * than `mergeGap` equal bytes are reported as one range, so a patched
 * instruction reads as a single change instead of several. `tail_bytes` counts
 * bytes past the shorter file's end, which are reported but never compared.
 */
export function diffByteRanges(
  a: Uint8Array,
  b: Uint8Array,
  opts: { mergeGap?: number; max?: number } = {},
): ByteDiff {
  const gap = opts.mergeGap ?? 8;
  const max = opts.max ?? 100;
  const common = Math.min(a.length, b.length);
  const ranges: ByteRange[] = [];
  let changed = 0;
  let total = 0;
  let open: ByteRange | null = null;

  const close = () => {
    if (!open) return;
    if (ranges.length < max) ranges.push(open);
    total++;
    open = null;
  };

  for (let i = 0; i < common; i++) {
    if (a[i] === b[i]) {
      // leave `open` alone until the equal run is long enough to split it.
      // open.end is exclusive, so the run seen so far is i - open.end + 1.
      if (open && i - open.end + 1 >= gap) close();
      continue;
    }
    changed++;
    if (open) open.end = i + 1;
    else open = { start: i, end: i + 1, length: 0 };
  }
  close();
  for (const r of ranges) r.length = r.end - r.start;

  return {
    identical: a.length === b.length && changed === 0,
    size_a: a.length,
    size_b: b.length,
    compared_bytes: common,
    changed_bytes: changed,
    tail_bytes: Math.abs(a.length - b.length),
    ranges,
    ranges_total: total,
  };
}
