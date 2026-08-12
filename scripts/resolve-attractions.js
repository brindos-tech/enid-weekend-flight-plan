#!/usr/bin/env node
// Resolves Ticketmaster attractionId for any artist missing one, via fuzzy
// name search. Result is cached PERMANENTLY in curated/artists.json — do
// not re-resolve on every run, it wastes quota and name search is fuzzy
// enough that a stable match matters more than a fresh one.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchJsonWithRetry, createRateLimiter } from "./lib/http.js";

const CURATED_DIR = path.resolve("data/curated");
const API_KEY = process.env.TICKETMASTER_API_KEY;
const limiter = createRateLimiter(2);

function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function resolveOne(artist) {
  await limiter();
  const url = `https://app.ticketmaster.com/discovery/v2/attractions.json?apikey=${API_KEY}&keyword=${encodeURIComponent(artist.name)}&size=5`;
  try {
    const data = await fetchJsonWithRetry(url);
    const candidates = data._embedded?.attractions || [];
    const exact = candidates.find((c) => normalize(c.name) === normalize(artist.name));
    return (exact || candidates[0])?.id ?? null;
  } catch (err) {
    console.warn(`Attraction resolve failed for ${artist.name}: ${err.message}`);
    return null;
  }
}

async function main() {
  if (!API_KEY) {
    console.warn("TICKETMASTER_API_KEY not set — skipping attraction resolution.");
    process.exit(0);
  }

  const artists = JSON.parse(await readFile(path.join(CURATED_DIR, "artists.json"), "utf-8"));
  const unresolved = artists.filter((a) => !a.ticketmasterAttractionId);

  let resolvedCount = 0;
  for (const artist of unresolved) {
    const id = await resolveOne(artist);
    if (id) {
      artist.ticketmasterAttractionId = id;
      resolvedCount++;
    }
  }

  await writeFile(path.join(CURATED_DIR, "artists.json"), JSON.stringify(artists, null, 2));
  console.log(`Resolved ${resolvedCount}/${unresolved.length} previously-unresolved artists.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
