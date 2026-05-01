export function parsePageRange(spec: string, totalPages: number): number[] {
  const result = new Set<number>();
  for (const segment of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (segment.includes("-")) {
      const [from, to] = segment.split("-").map((n) => parseInt(n.trim(), 10));
      if (Number.isNaN(from) || Number.isNaN(to)) {
        throw new Error(`Invalid page range "${segment}"`);
      }
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);
      for (let i = lo; i <= hi; i++) result.add(i);
    } else {
      const n = parseInt(segment, 10);
      if (Number.isNaN(n)) throw new Error(`Invalid page number "${segment}"`);
      result.add(n);
    }
  }
  for (const p of result) {
    if (p < 1 || p > totalPages) {
      throw new Error(`Page ${p} out of bounds (PDF has ${totalPages} pages).`);
    }
  }
  return Array.from(result).sort((a, b) => a - b);
}
