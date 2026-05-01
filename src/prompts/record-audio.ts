import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { asUserMessage, interpolate, loadBody } from "./_helpers.js";

const BODY = loadBody(import.meta.url, "record-audio.md");

const argsSchema = {
  prefix: z
    .string()
    .optional()
    .describe('Optional filename prefix. If omitted, uses "recording".'),
};

export const registerRecordAudioPrompt = (server: McpServer) => {
  server.registerPrompt(
    "record-audio",
    {
      title: "Record Audio (Mac, BlackHole)",
      description:
        'Start recording Mac system audio via BlackHole. Use when the user says "record audio", "start recording", "capture audio", or invokes /record-audio.',
      argsSchema,
    },
    (args) => asUserMessage(interpolate(BODY, { prefix: args?.prefix ?? "recording" })),
  );
};
