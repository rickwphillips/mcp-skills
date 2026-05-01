import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface LoadedPrompt {
  name: string;
  title?: string;
  description?: string;
  arguments?: PromptArgument[];
  body: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

const PROMPT_DIRS = [
  process.env.MCP_SKILLS_PROMPTS_DIR,
  join(__dirname, "..", "..", "prompts"),
  join(__dirname, "..", "prompts"),
].filter((p): p is string => Boolean(p));

export function loadPrompts(): LoadedPrompt[] {
  for (const dir of PROMPT_DIRS) {
    if (existsSync(dir)) {
      return readdirSync(dir)
        .filter((f) => f.endsWith(".md"))
        .map((f) => parsePrompt(readFileSync(join(dir, f), "utf8"), f));
    }
  }
  return [];
}

function parsePrompt(raw: string, filename: string): LoadedPrompt {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { name: filename.replace(/\.md$/, ""), body: raw };
  }
  const fm = match[1];
  const body = match[2].trim();

  const get = (key: string): string | undefined => {
    const re = new RegExp(`^${key}:\\s*(.+)$`, "m");
    const m = fm.match(re);
    return m ? m[1].trim() : undefined;
  };

  const args: PromptArgument[] = [];
  const fmLines = fm.split("\n");
  let inArgs = false;
  let current: PromptArgument | null = null;
  for (const line of fmLines) {
    if (/^arguments:\s*$/.test(line)) {
      inArgs = true;
      continue;
    }
    if (inArgs) {
      if (/^\S/.test(line)) {
        inArgs = false;
        if (current) {
          args.push(current);
          current = null;
        }
        continue;
      }
      const itemMatch = line.match(/^\s*-\s*name:\s*(.+)$/);
      if (itemMatch) {
        if (current) args.push(current);
        current = { name: itemMatch[1].trim() };
        continue;
      }
      const descMatch = line.match(/^\s+description:\s*(.+)$/);
      if (descMatch && current) {
        current.description = descMatch[1].trim().replace(/^["']|["']$/g, "");
        continue;
      }
      const reqMatch = line.match(/^\s+required:\s*(.+)$/);
      if (reqMatch && current) {
        current.required = reqMatch[1].trim() === "true";
      }
    }
  }
  if (current) args.push(current);

  return {
    name: get("name") ?? filename.replace(/\.md$/, ""),
    title: get("title"),
    description: get("description"),
    arguments: args.length ? args : undefined,
    body,
  };
}
