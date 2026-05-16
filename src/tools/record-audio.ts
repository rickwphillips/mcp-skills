import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";

const PID_FILE = "/tmp/audio_recording.pid";
const PATH_FILE = "/tmp/audio_recording.path";
const LOG_FILE = "/tmp/audio_recording.log";

const inputSchema = {
  prefix: z
    .string()
    .optional()
    .describe("Optional filename prefix. Defaults to 'recording'."),
};

const isPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const timestamp = (): string => {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
};

export const registerRecordAudioTool = (server: McpServer) => {
  server.registerTool(
    "record_audio",
    {
      title: "Record Audio (Mac, BlackHole)",
      description:
        "Start recording Mac system audio via BlackHole 2ch + ffmpeg. Saves to ~/Recordings/<prefix>_<timestamp>.m4a. " +
        "Refuses if a recording is already in progress. " +
        "**Confirm with the user before starting a recording.**",
      inputSchema,
    },
    async ({ prefix }) => {
      if (existsSync(PID_FILE)) {
        const pidRaw = readFileSync(PID_FILE, "utf8").trim();
        const pid = parseInt(pidRaw, 10);
        if (pid && isPidAlive(pid)) {
          const existingPath = existsSync(PATH_FILE)
            ? readFileSync(PATH_FILE, "utf8").trim()
            : "(unknown)";
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    status: "ALREADY_RECORDING",
                    pid,
                    file: existingPath,
                    message: "A recording is already in progress. Stop it first.",
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }
      }

      const recordingsDir = join(homedir(), "Recordings");
      if (!existsSync(recordingsDir)) {
        mkdirSync(recordingsDir, { recursive: true });
      }

      const namePrefix = prefix && prefix.trim().length > 0 ? prefix.trim() : "recording";
      const outputFile = join(recordingsDir, `${namePrefix}_${timestamp()}.m4a`);

      const child = spawn(
        "ffmpeg",
        ["-f", "avfoundation", "-i", ":BlackHole 2ch", "-c:a", "aac", "-b:a", "192k", outputFile],
        {
          detached: true,
          stdio: ["ignore", "ignore", "ignore"],
        },
      );
      child.unref();

      if (!child.pid) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "ERROR",
                  message: "Failed to spawn ffmpeg. Verify it is installed: brew install ffmpeg",
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      writeFileSync(PID_FILE, String(child.pid));
      writeFileSync(PATH_FILE, outputFile);
      writeFileSync(LOG_FILE, `Started ${new Date().toISOString()} pid=${child.pid} file=${outputFile}\n`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "RECORDING",
                pid: child.pid,
                file: outputFile,
                stop_with: "stop_recording tool",
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
