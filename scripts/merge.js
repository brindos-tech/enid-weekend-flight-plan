#!/usr/bin/env node
// Combines curated/events.seed.json + .cache/recurring-expanded.json +
// .cache/ticketmaster.json into data/generated/events.json, deduping
// overlapping records. Also writes data/generated/meta.json — this file is
// written on EVERY run, even a no-op, so scheduled GitHub Actions workflows
// don't get disabled after 60 days of inactivity (see ARCHITECTURE.md §9.4).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { dedupeEvents } from "./lib/dedupe.js";

const CURATED_DIR = path.resolve("data/curated");
const GENERATED_DIR = path.resolve("data/generated");
const CACHE_DIR = path.resolve(".cache");

async function readJsonIfExists(filePath, fallback = []) {
  try {
    return JSON.parse(await readFile(filePath, "utf-8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

async function main() {
  const [seedEvents, recurringEvents, ticketmasterEvents, artists, places, previousMeta] = await Promise.all([
    readJsonIfExists(path.join(CURATED_DIR, "events.seed.json")),
    readJsonIfExists(path.join(CACHE_DIR, "recurring-expanded.json")),
    readJsonIfExists(path.join(CACHE_DIR, "ticketmaster.json")),
    readJsonIfExists(path.join(CURATED_DIR, "artists.json")),
    readJsonIfExists(path.join(CURATED_DIR, "places.json")),
    readJsonIfExists(path.join(GENERATED_DIR, "meta.json"), null),
  ]);

  const placeIds = new Set(places.map((p) => p.id));
  const favoriteArtistIds = new Set(artists.map((a) => a.id));

  // tag isFavoriteArtist on ticketmaster events using resolved attraction ids
  const attractionToArtist = new Map(
    artists.filter((a) => a.ticketmasterAttractionId).map((a) => [a.ticketmasterAttractionId, a.id])
  );
  for (const ev of ticketmasterEvents) {
    const matchedArtistIds = (ev.artistIds || [])
      .map((attrId) => attractionToArtist.get(attrId))
      .filter(Boolean);
    if (matchedArtistIds.length) {
      ev.artistIds = matchedArtistIds;
      ev.isFavoriteArtist = matchedArtistIds.some((id) => favoriteArtistIds.has(id));
    }
  }

  // drop ticketmaster events whose venue didn't resolve to a known place
  // (strictPlaces default true per ARCHITECTURE.md §9.2)
  const droppedForUnknownPlace = ticketmasterEvents.filter((e) => !placeIds.has(e.placeId));
  const validTicketmasterEvents = ticketmasterEvents.filter((e) => placeIds.has(e.placeId));

  const combined = [...seedEvents, ...recurringEvents, ...validTicketmasterEvents];
  const { events: deduped, mergeLog } = dedupeEvents(combined);

  // prune events more than 30 days in the past
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const pruned = deduped.filter((e) => new Date(e.end || e.start) >= cutoff);

  await mkdir(GENERATED_DIR, { recursive: true });
  await writeFile(path.join(GENERATED_DIR, "events.json"), JSON.stringify(pruned, null, 2));

  const meta = {
    buildId: `build-${Date.now()}`,
    buildAt: new Date().toISOString(),
    eventCount: pruned.length,
    sources: {
      ticketmaster: {
        status: ticketmasterEvents.length ? "ok" : "not_run_or_empty",
        lastSuccess: ticketmasterEvents.length ? new Date().toISOString() : previousMeta?.sources?.ticketmaster?.lastSuccess ?? null,
        droppedForUnknownPlace: droppedForUnknownPlace.length,
      },
      spotify: previousMeta?.sources?.spotify ?? { status: "not_yet_run", lastSuccess: null },
      recurring: { status: "ok", lastSuccess: new Date().toISOString() },
    },
    dedupe: mergeLog,
    linkHealth: previousMeta?.linkHealth ?? {},
  };
  await writeFile(path.join(GENERATED_DIR, "meta.json"), JSON.stringify(meta, null, 2));

  console.log(
    `Merged ${combined.length} raw events -> ${pruned.length} after dedupe/prune (${mergeLog.length} merges, ${droppedForUnknownPlace.length} dropped for unknown place).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
