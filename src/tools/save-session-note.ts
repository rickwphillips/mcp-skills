import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

const inputSchema = {
  notes_dir: z
    .string()
    .describe("Absolute directory where session notes live. Filename pattern: <YYYY-MM-DD>-<slug>.md."),
  title: z
    .string()
    .min(1)
    .describe("Note title for the frontmatter `name` field. Used in YAML and slug."),
  description: z
    .string()
    .min(1)
    .describe("One-line summary that future search will match against. Goes in frontmatter `description`."),
  content: z
    .string()
    .min(1)
    .describe(
      "Markdown body of the note (NO frontmatter — this tool adds it). " +
        "Should include Resume Context paragraph, What changed, Decisions, Outstanding items, References.",
    ),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
    .optional()
    .describe("Date for the filename. Defaults to today."),
  type: z
    .enum(["project", "feedback", "user", "reference"])
    .optional()
    .describe("Memory type for frontmatter. Defaults to 'project'."),
  slug: z
    .string()
    .optional()
    .describe("Optional kebab-case slug. If omitted, derived from title."),
};

const today = (): string => {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

export const registerSaveSessionNoteTool = (server: McpServer) => {
  server.registerTool(
    "save_session_note",
    {
      title: "Save Session Note",
      description:
        "Persist a distilled session note to <notes_dir>/<YYYY-MM-DD>-<slug>.md with standard frontmatter. " +
        "The note body should already be distilled (resume context, what changed, decisions, outstanding, refs) — " +
        "this tool only handles persistence and frontmatter wrapping.",
      inputSchema,
    },
    async ({ notes_dir, title, description, content, date, type, slug }) => {
      const noteDate = date ?? today();
      const noteSlug = slug ?? slugify(title);
      const filePath = join(notes_dir, `${noteDate}-${noteSlug}.md`);
      const noteType = type ?? "project";

      try {
        mkdirSync(dirname(filePath), { recursive: true });

        if (existsSync(filePath)) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    status: "EXISTS",
                    file: filePath,
                    message: "A note already exists at this path. Pick a different slug or date.",
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }

        const frontmatter =
          `---\n` +
          `name: ${title}\n` +
          `description: ${description}\n` +
          `type: ${noteType}\n` +
          `---\n\n`;

        writeFileSync(filePath, frontmatter + content + (content.endsWith("\n") ? "" : "\n"));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "SAVED",
                  file: filePath,
                  date: noteDate,
                  slug: noteSlug,
                  type: noteType,
                  bytes: (frontmatter + content).length,
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
