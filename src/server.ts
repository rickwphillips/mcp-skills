#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/index.js";
import { registerPrompts } from "./prompts/index.js";
import { getVersionInfo } from "./version.js";
import { backgroundBootCheck } from "./update-check.js";

const versionInfo = getVersionInfo();

const server = new McpServer({
  name: versionInfo.name,
  version: versionInfo.version,
});

registerTools(server);
registerPrompts(server);

backgroundBootCheck();

const transport = new StdioServerTransport();
await server.connect(transport);
