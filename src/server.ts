#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/index.js";
import { registerResources } from "./resources/index.js";
import { getVersionInfo } from "./version.js";
import { backgroundBootCheck } from "./update-check.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { wrapRegisterTool } from "./lib/dispatch-wrapper.js";
import { logger } from "./lib/logger.js";

const versionInfo = getVersionInfo();

const server = new McpServer(
  {
    name: versionInfo.name,
    version: versionInfo.version,
  },
  {
    instructions: SERVER_INSTRUCTIONS,
  },
);

// Wrap registerTool BEFORE any tools register, so every tool gets
// telemetry, swallowed-error detection, and _steering injection.
wrapRegisterTool(server);

registerTools(server);
registerResources(server);

backgroundBootCheck();

const transport = new StdioServerTransport();
await server.connect(transport);

logger.info({
  msg: "mcp-skills started",
  version: versionInfo.version,
  logLevel: logger.level,
  logFile: logger.fileEnabled ? logger.filePath : "disabled",
});
