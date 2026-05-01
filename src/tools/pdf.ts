import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PDFDocument, degrees, rgb, StandardFonts } from "pdf-lib";
import { z } from "zod";

const PathSchema = z.string().min(1).describe("Absolute or relative path on the server filesystem.");

export const pdfMergeSchema = z.object({
  inputs: z.array(PathSchema).min(2).describe("Paths of PDFs to merge in order."),
  output: PathSchema.describe("Output path for the merged PDF."),
});

export const pdfSplitSchema = z.object({
  input: PathSchema.describe("Path of the PDF to split."),
  ranges: z
    .array(
      z.object({
        pages: z
          .string()
          .describe(
            "Page range, 1-indexed inclusive. Examples: '1-3', '5', '7-10'. " +
              "Each range becomes one output PDF.",
          ),
        output: PathSchema,
      }),
    )
    .min(1),
});

export const pdfExtractTextSchema = z.object({
  input: PathSchema,
  pages: z
    .string()
    .optional()
    .describe(
      "Optional 1-indexed page selection. Examples: '1', '1-3', '1,3,5'. Omit for all pages.",
    ),
});

export const pdfRotateSchema = z.object({
  input: PathSchema,
  output: PathSchema,
  degrees: z
    .union([z.literal(90), z.literal(180), z.literal(270), z.literal(-90), z.literal(-180), z.literal(-270)])
    .describe("Rotation in degrees clockwise. Must be a multiple of 90."),
  pages: z
    .string()
    .optional()
    .describe("Optional 1-indexed page selection. Omit to rotate all pages."),
});

export const pdfWatermarkSchema = z.object({
  input: PathSchema,
  output: PathSchema,
  text: z.string().min(1).describe("Watermark text."),
  opacity: z.number().min(0).max(1).default(0.2),
  font_size: z.number().int().positive().default(48),
});

export const pdfEncryptSchema = z.object({
  input: PathSchema,
  output: PathSchema,
  user_password: z.string().min(1),
  owner_password: z.string().optional(),
});

export const pdfDecryptSchema = z.object({
  input: PathSchema,
  output: PathSchema,
  password: z.string().min(1),
});

function parsePageRange(spec: string, totalPages: number): number[] {
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

export async function pdfMerge(input: z.infer<typeof pdfMergeSchema>): Promise<string> {
  const { inputs, output } = pdfMergeSchema.parse(input);
  const merged = await PDFDocument.create();
  for (const path of inputs) {
    const bytes = await readFile(resolve(path));
    const src = await PDFDocument.load(bytes);
    const copied = await merged.copyPages(src, src.getPageIndices());
    copied.forEach((p) => merged.addPage(p));
  }
  const out = await merged.save();
  await writeFile(resolve(output), out);
  return JSON.stringify(
    { status: "OK", output: resolve(output), page_count: merged.getPageCount() },
    null,
    2,
  );
}

export async function pdfSplit(input: z.infer<typeof pdfSplitSchema>): Promise<string> {
  const { input: inputPath, ranges } = pdfSplitSchema.parse(input);
  const bytes = await readFile(resolve(inputPath));
  const src = await PDFDocument.load(bytes);
  const total = src.getPageCount();
  const outputs: { output: string; page_count: number }[] = [];

  for (const range of ranges) {
    const pages = parsePageRange(range.pages, total);
    const dest = await PDFDocument.create();
    const copied = await dest.copyPages(
      src,
      pages.map((p) => p - 1),
    );
    copied.forEach((p) => dest.addPage(p));
    const out = await dest.save();
    await writeFile(resolve(range.output), out);
    outputs.push({ output: resolve(range.output), page_count: pages.length });
  }
  return JSON.stringify({ status: "OK", outputs }, null, 2);
}

export async function pdfExtractText(input: z.infer<typeof pdfExtractTextSchema>): Promise<string> {
  const { input: inputPath, pages } = pdfExtractTextSchema.parse(input);
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await readFile(resolve(inputPath)));
  const doc = await getDocument({ data, useSystemFonts: true }).promise;
  const total = doc.numPages;
  const targetPages = pages ? parsePageRange(pages, total) : Array.from({ length: total }, (_, i) => i + 1);

  const result: { page: number; text: string }[] = [];
  for (const p of targetPages) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .filter(Boolean)
      .join(" ");
    result.push({ page: p, text });
  }
  await doc.destroy();
  return JSON.stringify(
    { status: "OK", input: resolve(inputPath), total_pages: total, pages: result },
    null,
    2,
  );
}

export async function pdfRotate(input: z.infer<typeof pdfRotateSchema>): Promise<string> {
  const parsed = pdfRotateSchema.parse(input);
  const bytes = await readFile(resolve(parsed.input));
  const doc = await PDFDocument.load(bytes);
  const total = doc.getPageCount();
  const target = parsed.pages
    ? parsePageRange(parsed.pages, total)
    : Array.from({ length: total }, (_, i) => i + 1);

  for (const p of target) {
    const page = doc.getPage(p - 1);
    const current = page.getRotation().angle;
    page.setRotation(degrees((current + parsed.degrees) % 360));
  }
  const out = await doc.save();
  await writeFile(resolve(parsed.output), out);
  return JSON.stringify(
    { status: "OK", output: resolve(parsed.output), pages_rotated: target },
    null,
    2,
  );
}

export async function pdfWatermark(input: z.infer<typeof pdfWatermarkSchema>): Promise<string> {
  const parsed = pdfWatermarkSchema.parse(input);
  const bytes = await readFile(resolve(parsed.input));
  const doc = await PDFDocument.load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    page.drawText(parsed.text, {
      x: width / 2 - (parsed.text.length * parsed.font_size) / 4,
      y: height / 2,
      size: parsed.font_size,
      font,
      color: rgb(0.5, 0.5, 0.5),
      opacity: parsed.opacity,
      rotate: degrees(45),
    });
  }
  const out = await doc.save();
  await writeFile(resolve(parsed.output), out);
  return JSON.stringify({ status: "OK", output: resolve(parsed.output) }, null, 2);
}

export async function pdfEncrypt(input: z.infer<typeof pdfEncryptSchema>): Promise<string> {
  const parsed = pdfEncryptSchema.parse(input);
  const bytes = await readFile(resolve(parsed.input));
  const doc = await PDFDocument.load(bytes);
  const out = await doc.save({
    useObjectStreams: false,
  });
  await writeFile(resolve(parsed.output), out);
  return JSON.stringify(
    {
      status: "PARTIAL",
      message:
        "pdf-lib does not yet implement password encryption. Output written without encryption. " +
        "For real encryption, install qpdf and shell out, or wait for v0.2.0.",
      output: resolve(parsed.output),
    },
    null,
    2,
  );
}

export async function pdfDecrypt(input: z.infer<typeof pdfDecryptSchema>): Promise<string> {
  const parsed = pdfDecryptSchema.parse(input);
  const bytes = await readFile(resolve(parsed.input));
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await doc.save();
  await writeFile(resolve(parsed.output), out);
  return JSON.stringify(
    {
      status: "OK",
      message:
        "Loaded with ignoreEncryption=true and re-saved without password. " +
        "Note: pdf-lib does not validate the supplied password.",
      output: resolve(parsed.output),
    },
    null,
    2,
  );
}
