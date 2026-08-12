#!/usr/bin/env node
// Ticketmaster Discovery API fetch. Free tier: 5,000 req/day, throttled to
// <=2 req/sec here — this script uses roughly 300. Two passes:
//   A. Artist pass — upcoming events for each cached attraction id.
//   B. Geographic pass — per-state, per-classification, rolling 90-day
//      window, for every state inside the footprint. NOT a radius sweep:
//      Discovery API results cap at 1,000/query and the footprint is huge,
//      so state-by-state is the only way to get full coverage.
//
// Requires env var TICKETMASTER_API_KEY (repo secret, CI-only).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fetchJsonWithRetry, createRateLimiter } from "./lib/http.js";

const CURATED_DIR = path.resolve("data/curated");
const CACHE_DIR = path.resolve(".cache");
const API_BASE = "https://app.ticketmaster.com/discovery/v2";
const API_KEY = process.env.TICKETMASTER_API_KEY;

// States inside the 800nm-west-of-Mississippi footprint (config.rangeSlider
// tops out at 1200nm, so this is deliberately a bit wider than the default
// range to give the runtime slider headroom above 800).
const FOOTPRINT_STATES = [
  "OK", "KS", "TX", "NM", "CO", "AR", "MO", "NE", "IA", "MN", "SD", "ND", "WY", "UT", "AZ", "LA", "MT", "NV",
];
const CLASSIFICATIONS = ["music", "sports", "arts&theatre"];

const limiter = createRateLimiter(2);

function classificationToCategory(classificationName) {
  const map = { music: "concert", sports: "sports", "arts&theatre": "art" };
  return map[classificationName] || "misc";
}

function estimateScale(event) {
  const capacity = event._embedded?.venues?.[0]?.capacity;
  if (capacity >= 30000) return "flagship";
  if (capacity >= 8000) return "major";
  if (capacity >= 1000) return "notable";
  return "local";
}

function mapTicketmasterEvent(tmEvent, { placeId, attractionId } = {}) {
  const venue = tmEvent._embedded?.venues?.[0];
  const dateInfo = tmEvent.dates?.start;
  return {
    id: `tm-${tmEvent.id}`,
    title: tmEvent.name,
    start: dateInfo?.localDate || null,
    end: dateInfo?.localDate || null,
    startTime: dateInfo?.dateTime || null,
    placeId: placeId || null,
    venue: venue ? { name: venue.name, lat: Number(venue.location?.latitude), lon: Number(venue.location?.longitude) } : null,
    category: classificationToCategory(tmEvent.classifications?.[0]?.segment?.name?.toLowerCase()),
    subcategory: tmEvent.classifications?.[0]?.genre?.name || null,
    scale: estimateScale(tmEvent),
    attendance: null,
    artistIds: attractionId ? [attractionId] : [],
    isFavoriteArtist: false,
    description: tmEvent.info || "",
    url: tmEvent.url || "",
    ticketUrl: tmEvent.url || "",
    source: "ticketmaster",
    sourceId: tmEvent.id,
    confidence: "confirmed",
    fetchedAt: new Date().toISOString(),
    recurringId: null,
  };
}

async function findNearestPlace(lat, lon, places, maxNm = 40) {
  const { greatCircleNm } = await import("../assets/js/geo.js");
  let best = null;
  let bestDist = Infinity;
  for (const p of places) {
    const d = greatCircleNm({ lat, lon }, p);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return bestDist <= maxNm ? best : null;
}

async function fetchArtistEvents(artist, places) {
  if (!artist.ticketmasterAttractionId) return [];
  await limiter();
  const url = `${API_BASE}/events.json?apikey=${API_KEY}&attractionId=${artist.ticketmasterAttractionId}&startDateTime=${new Date().toISOString().split(".")[0]}Z`;
  try {
    const data = await fetchJsonWithRetry(url);
    const events = data._embedded?.events || [];
    const mapped = [];
    for (const ev of events) {
      const venue = ev._embedded?.venues?.[0];
      const lat = Number(venue?.location?.latitude);
      const lon = Number(venue?.location?.longitude);
      const place = Number.isFinite(lat) && Number.isFinite(lon) ? await findNearestPlace(lat, lon, places) : null;
      mapped.push(mapTicketmasterEvent(ev, { placeId: place?.id, attractionId: artist.ticketmasterAttractionId }));
    }
    return mapped;
  } catch (err) {
    console.warn(`Artist pass failed for ${artist.name}: ${err.message}`);
    return [];
  }
}

async function fetchStateEvents(stateCode, classificationName, places) {
  const events = [];
  let page = 0;
  const startDateTime = `${new Date().toISOString().split(".")[0]}Z`;
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 90);
  const endDateTime = `${endDate.toISOString().split(".")[0]}Z`;

  while (page < 5) {
    await limiter();
    const url =
      `${API_BASE}/events.json?apikey=${API_KEY}&stateCode=${stateCode}&countryCode=US` +
      `&classificationName=${encodeURIComponent(classificationName)}` +
      `&startDateTime=${startDateTime}&endDateTime=${endDateTime}&size=200&page=${page}`;
    try {
      const data = await fetchJsonWithRetry(url);
      const pageEvents = data._embedded?.events || [];
      if (pageEvents.length === 0) break;
      for (const ev of pageEvents) {
        const venue = ev._embedded?.venues?.[0];
        const lat = Number(venue?.location?.latitude);
        const lon = Number(venue?.location?.longitude);
        const place = Number.isFinite(lat) && Number.isFinite(lon) ? await findNearestPlace(lat, lon, places) : null;
        if (place) events.push(mapTicketmasterEvent(ev, { placeId: place.id }));
      }
      const totalPages = data.page?.totalPages ?? 1;
      page++;
      if (page >= totalPages) break;
    } catch (err) {
      console.warn(`Geo pass failed for ${stateCode}/${classificationName} page ${page}: ${err.message}`);
      break;
    }
  }
  return events;
}

async function main() {
  if (!API_KEY) {
    console.error("TICKETMASTER_API_KEY not set — skipping fetch, leaving .cache/ticketmaster.json untouched.");
    process.exit(0); // not a hard failure — merge.js tolerates a missing cache file
  }

  const [artists, places] = await Promise.all([
    readFile(path.join(CURATED_DIR, "artists.json"), "utf-8").then(JSON.parse),
    readFile(path.join(CURATED_DIR, "places.json"), "utf-8").then(JSON.parse),
  ]);

  const artistEventLists = await Promise.all(artists.map((a) => fetchArtistEvents(a, places)));
  const artistEvents = artistEventLists.flat();
  console.log(`Artist pass: ${artistEvents.length} events across ${artists.filter((a) => a.ticketmasterAttractionId).length} resolved artists.`);

  const geoEvents = [];
  for (const state of FOOTPRINT_STATES) {
    for (const classification of CLASSIFICATIONS) {
      const events = await fetchStateEvents(state, classification, places);
      geoEvents.push(...events);
    }
  }
  console.log(`Geographic pass: ${geoEvents.length} events across ${FOOTPRINT_STATES.length} states.`);

  // dedupe by ticketmaster sourceId before caching (artist pass and geo pass overlap)
  const bySourceId = new Map();
  for (const ev of [...artistEvents, ...geoEvents]) {
    if (!bySourceId.has(ev.sourceId)) bySourceId.set(ev.sourceId, ev);
  }
  const combined = Array.from(bySourceId.values());

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(path.join(CACHE_DIR, "ticketmaster.json"), JSON.stringify(combined, null, 2));
  console.log(`Wrote ${combined.length} unique Ticketmaster events to .cache/ticketmaster.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
