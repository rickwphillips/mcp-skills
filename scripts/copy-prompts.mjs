#!/usr/bin/env node
import { readdirSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const srcDir = join(root, "src", "prompts");
const distDir = join(root, "dist", "prompts");

function copyMdRecursive(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    const fromPath = join(from, entry);
    const toPath = join(to, entry);
    if (statSync(fromPath).isDirectory()) {
      copyMdRecursive(fromPath, toPath);
    } else if (entry.endsWith(".md")) {
      copyFileSync(fromPath, toPath);
    }
  }
}

copyMdRecursive(srcDir, distDir);
process.stdout.write(`[copy-prompts] Copied .md files from ${srcDir} to ${distDir}\n`);
