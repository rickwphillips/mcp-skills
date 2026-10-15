import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

/**
 * Shared process-exec helper for the binary-reverse-engineering (`re`) tool
 * slice. Every tool here is a STATIC analyzer: it reads and parses the target
 * file as data, and never executes it. argv is always an array (no shell
 * string), so there is no shell-injection surface even though the target
 * itself is untrusted.
 */

export type ReRunResult = {
  exit_code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timed_out: boolean;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 2_000_000; // 2MB cap per stream; analyzers can be chatty

export function runRe(
  bin: string,
  args: string[],
  opts: { timeoutMs?: number; cwd?: string; env?: Record<string, string> } = {},
): Promise<ReRunResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolvePromise) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (d: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += d.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolvePromise({
        exit_code: null,
        signal: null,
        stdout,
        stderr: `${stderr}Failed to spawn ${bin}: ${err.message}`,
        timed_out: false,
      });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ exit_code: code, signal, stdout, stderr, timed_out: timedOut });
    });
  });
}

/** Resolves and validates a user-supplied path: must exist, be a regular
 * file, and (as a sanity cap, not a security boundary) be under 512MB so a
 * mistaken directory or disk image doesn't wedge an analyzer for minutes. */
export function resolveTargetPath(input: string, maxBytes = 512 * 1024 * 1024): string {
  const abs = resolve(input);
  if (!existsSync(abs)) throw new Error(`File not found: ${abs}`);
  const st = statSync(abs);
  if (!st.isFile()) throw new Error(`Not a regular file: ${abs}`);
  if (st.size > maxBytes) {
    throw new Error(
      `File too large (${st.size} bytes, cap ${maxBytes}): ${abs}. Use a smaller target or raise maxBytes.`,
    );
  }
  return abs;
}

// Tools installed outside Homebrew's PATH-visible prefix. Resolved via
// os.homedir() rather than a hardcoded user path since they're tied to
// per-user pip/pipx/manual installs.
export const RE_TOOLS = {
  capa: resolve(homedir(), ".local/bin/capa"),
  ghidraHeadless: resolve(homedir(), "tools/ghidra/support/analyzeHeadless"),
  // Our own GhidraScript(s), kept outside the Ghidra install so an upgrade
  // (re-extracting a new release zip over ~/tools/ghidra) doesn't wipe them.
  ghidraScriptsDir: resolve(homedir(), "tools/ghidra-scripts"),
  patchBytesScript: resolve(homedir(), "tools/mcp-re-scripts/patch_bytes.py"),
  // Homebrew's openjdk is keg-only (not linked), so Ghidra needs JAVA_HOME
  // passed explicitly rather than relying on the default `java` on PATH.
  ghidraJavaHome: "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home",
} as const;

export function toolExists(path: string): boolean {
  return existsSync(path);
}
