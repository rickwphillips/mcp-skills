import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";

const PID_FILE = "/tmp/audio_recording.pid";
const PATH_FILE = "/tmp/audio_recording.path";

const isPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const formatBytes = (n: number): string => {
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
};

export const registerStopRecordingTool = (server: McpServer) => {
  server.registerTool(
    "stop_recording",
    {
      title: "Stop Recording",
      description:
        "Stop the active system audio recording. Sends SIGINT to ffmpeg so the m4a is finalized cleanly. " +
        "Returns the final file path and size.",
      inputSchema: {},
    },
    async () => {
      if (!existsSync(PID_FILE)) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { status: "NOT_RECORDING", message: "No active recording found." },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      const pidRaw = readFileSync(PID_FILE, "utf8").trim();
      const pid = parseInt(pidRaw, 10);
      const file = existsSync(PATH_FILE) ? readFileSync(PATH_FILE, "utf8").trim() : null;

      if (!pid) {
        unlinkSync(PID_FILE);
        if (existsSync(PATH_FILE)) unlinkSync(PATH_FILE);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { status: "STALE_PID", message: "PID file was empty; cleaned up." },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      if (!isPidAlive(pid)) {
        unlinkSync(PID_FILE);
        if (existsSync(PATH_FILE)) unlinkSync(PATH_FILE);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "ALREADY_STOPPED",
                  pid,
                  file,
                  message: "Process was no longer running. Cleaned up tmp files.",
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      try {
        process.kill(pid, "SIGINT");
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "ERROR",
                  pid,
                  message: `Failed to signal ffmpeg: ${err instanceof Error ? err.message : String(err)}`,
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      await sleep(1500);
      unlinkSync(PID_FILE);
      if (existsSync(PATH_FILE)) unlinkSync(PATH_FILE);

      let size: string | null = null;
      let bytes = 0;
      if (file && existsSync(file)) {
        bytes = statSync(file).size;
        size = formatBytes(bytes);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "STOPPED",
                pid,
                file,
                size,
                bytes,
                warning: bytes === 0 ? "File is 0 bytes — check /tmp/audio_recording.log" : undefined,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
};
