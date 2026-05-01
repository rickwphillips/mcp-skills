import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCommanderCollectorResource } from "./commander-collector.js";
import { registerGrandkidArcadeResource } from "./grandkid-arcade.js";
import { registerPortfolioResource } from "./portfolio.js";
import { registerRoyalCasinoResource } from "./royal-casino.js";
import { registerCanvasDesignResource } from "./canvas-design.js";
import { registerMtgRulesGuruResource } from "./mtg-rules-guru.js";

export const registerResources = (server: McpServer) => {
  registerCommanderCollectorResource(server);
  registerGrandkidArcadeResource(server);
  registerPortfolioResource(server);
  registerRoyalCasinoResource(server);
  registerCanvasDesignResource(server);
  registerMtgRulesGuruResource(server);
};
