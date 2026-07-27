import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { expandTilde } from "../src/config/connections.js";

// Regression: a config-provided path like "~/.local/share/mcp-skills/write-audit.jsonl"
// must resolve to $HOME. The OS does not expand "~", so an unexpanded value would
// create a literal "~" directory in the process CWD.
describe("expandTilde", () => {
  it("expands a leading ~/ to the home directory", () => {
    expect(expandTilde("~/.local/share/mcp-skills/write-audit.jsonl")).toBe(
      join(homedir(), ".local", "share", "mcp-skills", "write-audit.jsonl"),
    );
  });

  it("expands a bare ~ to the home directory", () => {
    expect(expandTilde("~")).toBe(homedir());
  });

  it("leaves absolute paths unchanged", () => {
    expect(expandTilde("/var/log/audit.jsonl")).toBe("/var/log/audit.jsonl");
  });

  it("does not expand a ~ that is not at the start", () => {
    expect(expandTilde("/tmp/~backup")).toBe("/tmp/~backup");
  });

  it("leaves relative paths without a tilde unchanged", () => {
    expect(expandTilde("data/audit.jsonl")).toBe("data/audit.jsonl");
  });
});
