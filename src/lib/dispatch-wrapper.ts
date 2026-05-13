import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logger } from "./logger.js";
import { getSteeringForPattern, type SteeringPayload } from "./audit-patterns.js";

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v).slice(0, 240);
  } catch {
    return String(v);
  }
}

function pickErrorMessage(obj: Record<string, unknown>): string | null {
  const err = obj.error;
  if (typeof err === "string" && err.length > 0) return err;
  if (err && typeof err === "object") {
    const nested = err as { message?: unknown; name?: unknown };
    if (typeof nested.message === "string" && nested.message.length > 0) return nested.message;
    if (typeof nested.name === "string" && nested.name.length > 0) return nested.name;
    return safeStringify(err);
  }

  const errs = obj.errors;
  if (Array.isArray(errs) && errs.length > 0) {
    const parts = errs
      .map((e) => {
        if (typeof e === "string") return e;
        if (e && typeof e === "object") {
          const m = (e as { message?: unknown }).message;
          if (typeof m === "string") return m;
          return safeStringify(e);
        }
        return String(e);
      })
      .filter((s) => s.length > 0);
    if (parts.length > 0) return parts.join("; ");
  }
  if (errs && typeof errs === "object" && !Array.isArray(errs)) {
    const entries = Object.entries(errs as Record<string, unknown>).map(
      ([k, v]) => `${k}: ${typeof v === "string" ? v : safeStringify(v)}`,
    );
    if (entries.length > 0) return entries.join("; ");
  }

  if (obj.status === "error" || obj.status === "ERROR") {
    const msg = obj.message;
    if (typeof msg === "string" && msg.length > 0) return msg;
    return "status=error with no message";
  }

  if (obj.ok === false) {
    const msg = obj.message;
    if (typeof msg === "string" && msg.length > 0) return msg;
    const reason = obj.reason;
    if (typeof reason === "string" && reason.length > 0) return reason;
    return "ok=false with no message";
  }

  return null;
}

export function extractSwallowedError(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as { isError?: boolean; content?: Array<{ type?: string; text?: string }> };
  if (r.isError === true) return "isError flag set on tool result";
  if (!Array.isArray(r.content)) return null;
  for (const block of r.content) {
    if (block?.type !== "text" || typeof block.text !== "string") continue;
    const text = block.text;
    if (!/"(error|errors|status|ok)"/.test(text)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const found = pickErrorMessage(parsed as Record<string, unknown>);
    if (found) return found;
  }
  return null;
}

function injectSteering(result: unknown, steering: SteeringPayload): unknown {
  if (!result || typeof result !== "object") return result;
  const r = result as { content?: Array<{ type?: string; text?: string }> };
  if (!Array.isArray(r.content)) return result;
  for (let i = 0; i < r.content.length; i++) {
    const block = r.content[i];
    if (block?.type !== "text" || typeof block.text !== "string") continue;
    try {
      const parsed = JSON.parse(block.text);
      if (parsed && typeof parsed === "object") {
        (parsed as Record<string, unknown>)._steering = steering;
        const newContent = [...r.content];
        newContent[i] = { ...block, text: JSON.stringify(parsed, null, 2) };
        return { ...r, content: newContent };
      }
    } catch {
      // not JSON; try next block
    }
  }
  return result;
}

/**
 * Wraps `server.registerTool` so every tool registration goes through telemetry:
 * - emits `{tool, ok, ms}` on stderr + per-PID log file
 * - detects swallowed errors in `{error: ...}`-style envelopes via extractSwallowedError
 * - feeds the audit pattern store via the logger (errors.jsonl)
 * - on recurrence, injects a `_steering` payload into the response so the next
 *   agent that hits the same signature inherits prior triage notes inline
 */
export function wrapRegisterTool(server: McpServer): void {
  type RegisterTool = typeof server.registerTool;
  const original: RegisterTool = server.registerTool.bind(server) as RegisterTool;

  const wrapped: RegisterTool = ((name, config, cb) => {
    type Cb = typeof cb;
    const handler = (async (args: Parameters<Cb>[0], extra: Parameters<Cb>[1]) => {
      const start = Date.now();
      logger.debug({ tool: name, phase: "start" });
      try {
        const result = await (cb as (a: typeof args, e: typeof extra) => Promise<unknown>)(args, extra);
        const ms = Date.now() - start;
        const swallowed = extractSwallowedError(result);
        if (swallowed) {
          logger.error({ tool: name, ok: false, ms, err: swallowed, swallowed: true });
          const steering = getSteeringForPattern(name, "error", swallowed);
          if (steering) {
            logger.warn({
              tool: name,
              steering: {
                pattern_id: steering.pattern_id,
                recommendation: steering.recommendation,
                active_notes: steering.active_notes.length,
              },
            });
            return injectSteering(result, steering);
          }
        } else {
          logger.info({ tool: name, ok: true, ms });
        }
        return result;
      } catch (err) {
        const ms = Date.now() - start;
        logger.error({ tool: name, ok: false, ms, err });
        const msg = err instanceof Error ? err.message : String(err);
        const steering = getSteeringForPattern(name, "error", msg);
        if (steering) {
          logger.warn({
            tool: name,
            steering: {
              pattern_id: steering.pattern_id,
              recommendation: steering.recommendation,
              active_notes: steering.active_notes.length,
            },
          });
        }
        throw err;
      }
    }) as Cb;
    return original(name, config, handler);
  }) as RegisterTool;

  server.registerTool = wrapped;
}
