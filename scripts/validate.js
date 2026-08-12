#!/usr/bin/env node
// Validation gate. Compares the just-written data/generated/*.json against
// the PREVIOUS COMMITTED state (via `git show HEAD:...`, not the working
// tree merge.js just overwrote) so the event-count-drop check has something
// real to compare against. Exits non-zero on failure — the CI workflow must
// skip the commit step when this fails, leaving last-good data live.

import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { validateDataset } from "./lib/schema.js";

const execFileAsync = promisify(execFile);
const GENERATED_DIR = path.resolve("data/generated");
const CURATED_DIR = path.resolve("data/curated");

async function getPreviousCommittedMeta() {
  try {
    const { stdout } = await execFileAsync("git", ["show", "HEAD:data/generated/meta.json"]);
    return JSON.parse(stdout);
  } catch {
    return null; // first run, or not in a git repo — skip the drop check
  }
}

async function main() {
  const [places, events, previousMeta] = await Promise.all([
    readFile(path.join(CURATED_DIR, "places.json"), "utf-8").then(JSON.parse),
    readFile(path.join(GENERATED_DIR, "events.json"), "utf-8").then(JSON.parse),
    getPreviousCommittedMeta(),
  ]);

  const { ok, errors } = validateDataset({ places, events, previousMeta });

  if (!ok) {
    console.error(`Validation FAILED (${errors.length} error${errors.length === 1 ? "" : "s"}):`);
    for (const e of errors) console.error(`  - ${e}`);
    console.error("\nLast-good data/generated/*.json will NOT be overwritten by this run.");
    process.exit(1);
  }

  console.log(`Validation passed: ${places.length} places, ${events.length} events.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
