// Parses MCP_SKILLS_SELECT into a Selector and installs a name filter on
// server.registerTool. Tokens are comma- or whitespace-separated and may be
// group names (e.g. "db") or exact tool names (e.g. "db_read") for per-tool
// precision. Unset / empty => full server.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ALWAYS_ON, GROUPS, RESOURCE_GROUP, TOOL_GROUPS } from "./tool-groups.js";

export interface Selector {
  raw: string;
  matchAll: boolean; // env unset/empty => behaves like the full server
  groups: ReadonlySet<string>; // recognized group tokens
  names: ReadonlySet<string>; // recognized exact tool-name tokens
  unknown: readonly string[]; // tokens matching no group or tool (ignored, warned)
  includes(toolName: string): boolean; // should this tool register?
  includesGroup(group: string): boolean; // is this group touched at all?
}

export function parseSelector(raw: string | undefined): Selector {
  const trimmed = (raw ?? "").trim();
  const matchAll = trimmed.length === 0;
  const tokens = trimmed.split(/[\s,]+/).filter(Boolean);

  const knownGroups = new Set(GROUPS);
  const knownNames = new Set([...Object.keys(TOOL_GROUPS), ...ALWAYS_ON]);

  const groups = new Set<string>();
  const names = new Set<string>();
  const unknown: string[] = [];
  for (const t of tokens) {
    if (knownGroups.has(t)) groups.add(t);
    else if (knownNames.has(t)) names.add(t);
    else unknown.push(t);
  }

  return {
    raw: trimmed,
    matchAll,
    groups,
    names,
    unknown,
    includes(toolName: string): boolean {
      if (ALWAYS_ON.includes(toolName)) return true;
      if (matchAll) return true;
      if (names.has(toolName)) return true;
      const g = TOOL_GROUPS[toolName];
      return g !== undefined && groups.has(g);
    },
    includesGroup(group: string): boolean {
      if (matchAll) return true;
      if (groups.has(group)) return true;
      // A per-tool token belonging to this group also touches it (e.g.
      // selecting "db_read" touches the "db" group). The resource group has no
      // per-tool tokens, so it is only touched by the explicit group name.
      if (group === RESOURCE_GROUP) return false;
      for (const n of names) {
        if (TOOL_GROUPS[n] === group) return true;
      }
      return false;
    },
  };
}

type RegisterTool = McpServer["registerTool"];

// Chainable no-op returned for filtered-out tools, so a registrar that reads
// registerTool's return value (.enable().update(...)) does not crash.
const NOOP_REGISTERED: ReturnType<RegisterTool> = {
  enable() {
    return NOOP_REGISTERED;
  },
  disable() {
    return NOOP_REGISTERED;
  },
  remove() {
    return NOOP_REGISTERED;
  },
  update() {
    return NOOP_REGISTERED;
  },
} as unknown as ReturnType<RegisterTool>;

// Wraps server.registerTool so only selected tool names register; everything
// else gets the no-op stub. Sits OUTSIDE the telemetry wrap (call after
// wrapRegisterTool) so filtered tools register nothing at all. Records the names
// that actually survive into registeredNames for list_tool_groups introspection.
export function applySliceFilter(
  server: McpServer,
  selector: Selector,
  registeredNames: string[],
): void {
  const real = server.registerTool.bind(server) as RegisterTool;
  const filtered = ((name: string, config: unknown, cb: unknown) => {
    if (selector.includes(name)) {
      registeredNames.push(name);
      return (real as (n: string, c: unknown, h: unknown) => ReturnType<RegisterTool>)(
        name,
        config,
        cb,
      );
    }
    return NOOP_REGISTERED;
  }) as RegisterTool;
  (server as unknown as { registerTool: RegisterTool }).registerTool = filtered;
}
