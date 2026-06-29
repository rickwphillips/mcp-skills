#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/index.js";
import { registerListToolGroupsTool } from "./tools/list-tool-groups.js";
import { registerResources } from "./resources/index.js";
import { getVersionInfo } from "./version.js";
import { backgroundBootCheck } from "./update-check.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { wrapRegisterTool } from "./lib/dispatch-wrapper.js";
import { parseSelector, applySliceFilter } from "./tool-select.js";
import { RESOURCE_GROUP } from "./tool-groups.js";
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

// Optional slice filter (MCP_SKILLS_SELECT). Applied AFTER the telemetry wrap so
// filtered-out tools register nothing at all. Unset selector => full server.
const selector = parseSelector(process.env.MCP_SKILLS_SELECT);
const registeredNames: string[] = [];
applySliceFilter(server, selector, registeredNames);

// Always-on introspection; reads registeredNames at request time.
registerListToolGroupsTool(server, selector, registeredNames);

registerTools(server);

// Resource descriptors load eagerly in clients without ToolSearch deferral, so
// they are gated by the same selector (always on when no slice is selected).
if (selector.includesGroup(RESOURCE_GROUP)) {
  registerResources(server);
}

if (selector.unknown.length > 0) {
  logger.warn({
    msg: "MCP_SKILLS_SELECT contained unrecognized tokens (ignored)",
    unknown: selector.unknown,
    hint: "Call list_tool_groups for valid group / tool tokens.",
  });
}
logger.info({
  msg: "mcp-skills registered slice",
  selector: selector.matchAll ? "ALL" : selector.raw,
  tools: registeredNames.length,
});

backgroundBootCheck();

const transport = new StdioServerTransport();
await server.connect(transport);

logger.info({
  msg: "mcp-skills started",
  version: versionInfo.version,
  logLevel: logger.level,
  logFile: logger.fileEnabled ? logger.filePath : "disabled",
});
