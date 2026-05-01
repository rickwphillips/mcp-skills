import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

const inputSchema = {
  journal_dir: z
    .string()
    .describe("Absolute directory where journal files live. One file per day: <YYYY-MM-DD>.md."),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
    .optional()
    .describe("Entry date in YYYY-MM-DD. Defaults to today."),
  content: z
    .string()
    .min(1)
    .describe("Markdown body of the entry. Should already be formatted with the agreed structure."),
  mood: z.string().optional().describe("Optional one-word mood for the frontmatter."),
  append: z
    .boolean()
    .optional()
    .describe(
      "If true and an entry for the date exists, append a new themed section. Default false: refuse if file exists.",
    ),
};

const today = (): string => {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const longDate = (iso: string): string => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
};

const buildFrontmatter = (date: string, mood?: string): string => {
  const lines = ["---", `date: ${date}`];
  if (mood) lines.push(`mood: ${mood}`);
  lines.push("---", "");
  return lines.join("\n");
};

export const registerSaveJournalEntryTool = (server: McpServer) => {
  server.registerTool(
    "save_journal_entry",
    {
      title: "Save Journal Entry",
      description:
        "Persist a journal entry to <journal_dir>/<YYYY-MM-DD>.md. Creates the directory if needed. " +
        "Refuses to overwrite an existing entry unless append=true (appends a new section).",
      inputSchema,
    },
    async ({ journal_dir, date, content, mood, append }) => {
      const entryDate = date ?? today();
      const filePath = join(journal_dir, `${entryDate}.md`);
      try {
        mkdirSync(dirname(filePath), { recursive: true });

        if (existsSync(filePath) && !append) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    status: "EXISTS",
                    file: filePath,
                    message: "Entry already exists. Pass append=true to add a section, or use a different date.",
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }

        if (existsSync(filePath) && append) {
          const existing = readFileSync(filePath, "utf8");
          const separator = existing.endsWith("\n") ? "\n" : "\n\n";
          writeFileSync(filePath, existing + separator + content + "\n");
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { status: "APPENDED", file: filePath, date: entryDate, bytes_added: content.length },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        const frontmatter = buildFrontmatter(entryDate, mood);
        const heading = `# Journal — ${longDate(entryDate)}\n\n`;
        writeFileSync(filePath, frontmatter + heading + content + "\n");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "SAVED",
                  file: filePath,
                  date: entryDate,
                  mood: mood ?? null,
                  bytes: (frontmatter + heading + content).length,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { status: "ERROR", message: err instanceof Error ? err.message : String(err) },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
    },
  );
};
