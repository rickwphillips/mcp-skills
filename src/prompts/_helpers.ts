import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function loadBody(metaUrl: string, filename: string): string {
  const dir = dirname(fileURLToPath(metaUrl));
  return readFileSync(join(dir, filename), "utf8");
}

export function interpolate(body: string, args: Record<string, unknown> | undefined): string {
  if (!args) return body;
  let result = body;
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;
    result = result.replaceAll(`{{${key}}}`, String(value));
  }
  return result;
}

export function asUserMessage(text: string) {
  return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
}
