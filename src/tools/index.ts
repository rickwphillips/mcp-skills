import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGetVersionTool } from "./get-version.js";
import { registerCheckForUpdatesTool } from "./check-for-updates.js";
import { registerListDbConnectionsTool } from "./list-db-connections.js";
import { registerDbReadTool } from "./db-read.js";
import { registerDbWriteTool } from "./db-write.js";
import { registerPdfMergeTool } from "./pdf-merge.js";
import { registerPdfSplitTool } from "./pdf-split.js";
import { registerPdfExtractTextTool } from "./pdf-extract-text.js";
import { registerPdfRotateTool } from "./pdf-rotate.js";
import { registerPdfWatermarkTool } from "./pdf-watermark.js";
import { registerPdfEncryptTool } from "./pdf-encrypt.js";
import { registerPdfDecryptTool } from "./pdf-decrypt.js";

export const registerTools = (server: McpServer) => {
  registerGetVersionTool(server);
  registerCheckForUpdatesTool(server);
  registerListDbConnectionsTool(server);
  registerDbReadTool(server);
  registerDbWriteTool(server);
  registerPdfMergeTool(server);
  registerPdfSplitTool(server);
  registerPdfExtractTextTool(server);
  registerPdfRotateTool(server);
  registerPdfWatermarkTool(server);
  registerPdfEncryptTool(server);
  registerPdfDecryptTool(server);
};
