import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { z } from "zod";

// The `sidecar` shell command (self-compiling wrapper around the private
// SidecarCore framework) is installed on PATH. The MCP server's PATH is not
// guaranteed to include Homebrew's bin, so resolve an explicit path first.
const CANDIDATES = [
  process.env.SIDECAR_BIN,
  "/opt/homebrew/bin/sidecar",
  "/usr/local/bin/sidecar",
].filter((p): p is string => Boolean(p));

const resolveBin = (): string | null =>
  CANDIDATES.find((p) => existsSync(p)) ?? null;

// reconnect/toggle poll for up to 90s inside the command; give the child room.
const TIMEOUT_MS = 100_000;

const inputSchema = {
  action: z
    .enum(["list", "connect", "disconnect", "reconnect", "toggle"])
    .default("toggle")
    .describe(
      "list = show devices offering a display now; connect = attach first match; " +
        "disconnect = drop it; reconnect = poll up to 90s then attach; " +
        "toggle = disconnect if connected else reconnect (the one-hotkey action).",
    ),
  device: z
    .string()
    .optional()
    .describe(
      "Optional device name (partial, case-insensitive). Omit to match the first available device.",
    ),
};

export const registerSidecarTool = (server: McpServer) => {
  server.registerTool(
    "sidecar",
    {
      title: "Sidecar Display (connect/toggle)",
      description:
        "Connect, reconnect, or toggle an Apple Sidecar display from the CLI without pushing the cursor to the screen edge. " +
        "Drives the private SidecarCore framework via the installed `sidecar` command. " +
        "connect/reconnect only work while the target Mac is actively advertising a display; a slept or off-network device cannot be forced.",
      inputSchema,
    },
    async ({ action, device }) => {
      const bin = resolveBin();
      if (!bin) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "NOT_INSTALLED",
                  message:
                    "The `sidecar` command was not found. Install it to /opt/homebrew/bin/sidecar or set SIDECAR_BIN.",
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      const args = device ? [action, device] : [action];

      return await new Promise((resolve) => {
        execFile(bin, args, { timeout: TIMEOUT_MS }, (err, stdout, stderr) => {
          const out = (stdout || "").trim();
          const errOut = (stderr || "").trim();
          const failed = Boolean(err);
          resolve({
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    status: failed ? "ERROR" : "OK",
                    action,
                    device: device ?? null,
                    stdout: out,
                    stderr: errOut,
                    exitCode: err && typeof err.code === "number" ? err.code : failed ? 1 : 0,
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: failed,
          });
        });
      });
    },
  );
};
