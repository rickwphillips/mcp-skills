#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";

import {
  dbRead,
  dbReadSchema,
  dbWrite,
  dbWriteSchema,
  listAvailableConnections,
} from "./tools/db.js";
import {
  pdfDecrypt,
  pdfDecryptSchema,
  pdfEncrypt,
  pdfEncryptSchema,
  pdfExtractText,
  pdfExtractTextSchema,
  pdfMerge,
  pdfMergeSchema,
  pdfRotate,
  pdfRotateSchema,
  pdfSplit,
  pdfSplitSchema,
  pdfWatermark,
  pdfWatermarkSchema,
} from "./tools/pdf.js";
import { loadPrompts } from "./prompts/loader.js";
import { getVersionInfo } from "./version.js";
import { backgroundBootCheck, checkForUpdates } from "./update-check.js";

const versionInfo = getVersionInfo();

const server = new Server(
  {
    name: versionInfo.name,
    version: versionInfo.version,
  },
  {
    capabilities: {
      tools: {},
      prompts: {},
    },
  },
);

interface ToolDef<T extends z.ZodTypeAny> {
  name: string;
  description: string;
  schema: T;
  handler: (input: z.infer<T>) => Promise<string>;
}

function tool<T extends z.ZodTypeAny>(def: ToolDef<T>): ToolDef<T> {
  return def;
}

const TOOLS = [
  tool({
    name: "get_version",
    description:
      "Returns the mcp-skills server version, the most recent CHANGELOG entries, and the result of the latest update check (cached up to 1 hour). " +
      "Call this at session start. If `update_status` is 'behind', surface the message to the user and ask before running `upgrade_command`.",
    schema: z.object({}),
    handler: async () => {
      const info = getVersionInfo();
      const updateCheck = await checkForUpdates(false);
      return JSON.stringify({ ...info, update_check: updateCheck }, null, 2);
    },
  }),
  tool({
    name: "check_for_updates",
    description:
      "Force a fresh check of GitHub for a newer mcp-skills release (bypasses the 1-hour cache). " +
      "Returns the current version, latest tag/release, and an upgrade command if behind. Never runs the upgrade itself — ask the user first.",
    schema: z.object({}),
    handler: async () => JSON.stringify(await checkForUpdates(true), null, 2),
  }),
  tool({
    name: "list_db_connections",
    description:
      "List the database connections currently configured on the server. " +
      "Use this before db_read or db_write to know what connection names are valid.",
    schema: z.object({}),
    handler: async () => listAvailableConnections(),
  }),
  tool({
    name: "db_read",
    description:
      "Run a read-only SQL query against a configured MySQL connection. Returns rows as JSON. " +
      "The server uses a native MySQL driver — pass raw SQL exactly as MySQL expects it; do NOT shell-escape. " +
      "Use SQL's own escaping (e.g. '' for a literal apostrophe) or pass the optional `params` array to bind values safely. " +
      "The response includes `executed_sql` so you can verify exactly what reached the database.",
    schema: dbReadSchema,
    handler: dbRead,
  }),
  tool({
    name: "db_write",
    description:
      "Run a write SQL statement (INSERT/UPDATE/DELETE) against a configured MySQL connection. " +
      "If the target connection is marked env: 'prod', the first call returns REQUIRES_CONFIRMATION; " +
      "the agent must surface the SQL + read-before state to the user, then re-call with confirm: 'CONFIRM'. " +
      "All successful writes are appended to the audit log (kept 30 days). " +
      "Pass `rollback_sql` so the response and audit log can echo it.",
    schema: dbWriteSchema,
    handler: dbWrite,
  }),
  tool({
    name: "pdf_merge",
    description: "Merge multiple PDFs into one in the order given.",
    schema: pdfMergeSchema,
    handler: pdfMerge,
  }),
  tool({
    name: "pdf_split",
    description:
      "Split a PDF into one or more output PDFs by page range. Each range becomes a separate output file.",
    schema: pdfSplitSchema,
    handler: pdfSplit,
  }),
  tool({
    name: "pdf_extract_text",
    description: "Extract text content from a PDF, page by page. Optional page selection.",
    schema: pdfExtractTextSchema,
    handler: pdfExtractText,
  }),
  tool({
    name: "pdf_rotate",
    description: "Rotate pages of a PDF by 90/180/270 degrees. Optional page selection.",
    schema: pdfRotateSchema,
    handler: pdfRotate,
  }),
  tool({
    name: "pdf_watermark",
    description: "Stamp text watermark across every page of a PDF, rotated 45° at configurable opacity.",
    schema: pdfWatermarkSchema,
    handler: pdfWatermark,
  }),
  tool({
    name: "pdf_encrypt",
    description:
      "(v0.1.0 stub) Save the PDF — pdf-lib does not yet implement password encryption. " +
      "Returns PARTIAL status. Real encryption coming in v0.2.0 via qpdf shell-out.",
    schema: pdfEncryptSchema,
    handler: pdfEncrypt,
  }),
  tool({
    name: "pdf_decrypt",
    description:
      "Load a PDF with ignoreEncryption and re-save without password. " +
      "Note: pdf-lib does not validate the supplied password.",
    schema: pdfDecryptSchema,
    handler: pdfDecrypt,
  }),
] as const;

const TOOLS_BY_NAME = new Map<string, ToolDef<z.ZodTypeAny>>(
  TOOLS.map((t) => [t.name, t as unknown as ToolDef<z.ZodTypeAny>]),
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: zodToJsonSchema(t.schema, { target: "openApi3" }) as Record<string, unknown>,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = TOOLS_BY_NAME.get(request.params.name);
  if (!tool) {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }
  try {
    const parsed = tool.schema.parse(request.params.arguments ?? {});
    const result = await tool.handler(parsed);
    return {
      content: [{ type: "text", text: result }],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: msg }],
    };
  }
});

const PROMPTS = loadPrompts();
const PROMPTS_BY_NAME = new Map(PROMPTS.map((p) => [p.name, p]));

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: PROMPTS.map((p) => ({
    name: p.name,
    description: p.description ?? p.title ?? p.name,
    arguments: p.arguments?.map((a) => ({
      name: a.name,
      description: a.description,
      required: Boolean(a.required),
    })),
  })),
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const prompt = PROMPTS_BY_NAME.get(request.params.name);
  if (!prompt) {
    throw new Error(`Unknown prompt: ${request.params.name}`);
  }
  let body = prompt.body;
  if (request.params.arguments) {
    for (const [key, val] of Object.entries(request.params.arguments)) {
      body = body.replaceAll(`{${key}}`, String(val));
    }
  }
  return {
    description: prompt.description ?? prompt.title ?? prompt.name,
    messages: [
      {
        role: "user",
        content: { type: "text", text: body },
      },
    ],
  };
});

backgroundBootCheck();

const transport = new StdioServerTransport();
await server.connect(transport);
