import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asUserMessage, loadBody } from "./_helpers.js";

const BODY = loadBody(import.meta.url, "stop-recording.md");

export const registerStopRecordingPrompt = (server: McpServer) => {
  server.registerPrompt(
    "stop-recording",
    {
      title: "Stop Recording",
      description:
        'Stop an in-progress system audio recording started by record-audio. Use when the user says "stop recording", "end recording", "finish recording", or invokes /stop-recording.',
    },
    () => asUserMessage(BODY),
  );
};
