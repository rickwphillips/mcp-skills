#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/index.js";
import { registerResources } from "./resources/index.js";
import { getVersionInfo } from "./version.js";
import { backgroundBootCheck } from "./update-check.js";

const versionInfo = getVersionInfo();

const server = new McpServer({
  name: versionInfo.name,
  version: versionInfo.version,
});

registerTools(server);
registerResources(server);

backgroundBootCheck();

const transport = new StdioServerTransport();
await server.connect(transport);
