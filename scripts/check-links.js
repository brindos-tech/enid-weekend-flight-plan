#!/usr/bin/env node
// Weekly link-health sweep. HEAD-requests every event/place URL, flags
// non-2xx into meta.linkHealth (keyed by URL) so a stale link surfaces
// without ever blocking the build.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRateLimiter } from "./lib/http.js";

const CURATED_DIR = path.resolve("data/curated");
const GENERATED_DIR = path.resolve("data/generated");
const limiter = createRateLimiter(5);

async function checkUrl(url) {
  await limiter();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
    clearTimeout(timeout);
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, status: null, error: err.message };
  }
}

async function main() {
  const [events, places] = await Promise.all([
    readFile(path.join(GENERATED_DIR, "events.json"), "utf-8").then(JSON.parse),
    readFile(path.join(CURATED_DIR, "places.json"), "utf-8").then(JSON.parse),
  ]);

  const urls = new Set();
  for (const e of events) if (e.url) urls.add(e.url);
  for (const p of places) if (p.links?.visit) urls.add(p.links.visit);

  const linkHealth = {};
  let brokenCount = 0;
  for (const url of urls) {
    const result = await checkUrl(url);
    if (!result.ok) {
      linkHealth[url] = { ...result, checkedAt: new Date().toISOString() };
      brokenCount++;
    }
  }

  const meta = JSON.parse(await readFile(path.join(GENERATED_DIR, "meta.json"), "utf-8").catch(() => "{}"));
  meta.linkHealth = linkHealth;
  await writeFile(path.join(GENERATED_DIR, "meta.json"), JSON.stringify(meta, null, 2));

  console.log(`Checked ${urls.size} URLs, ${brokenCount} flagged as broken.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
