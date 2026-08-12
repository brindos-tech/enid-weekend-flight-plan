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

// Ticketmaster's event search almost never inlines venue.capacity (it's
// populated for well under 1% of results in this footprint) — relying on it
// alone made nearly every event, including genuine stadium tours, fall
// through to "local". venueCapacityMap is filled in by fetchVenueCapacities
// below via the dedicated venue-detail endpoint, which has much better
// capacity coverage, and is used as the fallback here.
function estimateScale(event, venueCapacityMap) {
  const venue = event._embedded?.venues?.[0];
  const capacity = venue?.capacity ?? (venue?.id ? venueCapacityMap?.get(venue.id) : undefined);
  if (capacity >= 30000) return "flagship";
  if (capacity >= 8000) return "major";
  if (capacity >= 1000) return "notable";
  return "local";
}

function mapTicketmasterEvent(tmEvent, { placeId, attractionId, venueCapacityMap } = {}) {
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
    scale: estimateScale(tmEvent, venueCapacityMap),
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

// One request per venue that (a) didn't already carry a capacity in the
// event embed and (b) hasn't been looked up yet. Runs after both passes so
// duplicate venues (the same amphitheater hosting a dozen different events)
// only cost a single request.
async function fetchVenueCapacities(rawEntries) {
  const venueCapacityMap = new Map();
  const idsToFetch = new Set();
  for (const { tmEvent } of rawEntries) {
    const venue = tmEvent._embedded?.venues?.[0];
    if (venue?.id && venue.capacity == null) idsToFetch.add(venue.id);
  }

  let fetched = 0;
  for (const id of idsToFetch) {
    await limiter();
    try {
      const venue = await fetchJsonWithRetry(`${API_BASE}/venues/${id}.json?apikey=${API_KEY}`);
      if (venue.capacity != null) {
        venueCapacityMap.set(id, Number(venue.capacity));
        fetched++;
      }
    } catch (err) {
      // missing/unavailable venue detail — leave uncapacitied, estimateScale falls back to "local"
    }
  }
  console.log(`Venue capacity lookups: ${fetched}/${idsToFetch.size} venues resolved.`);
  return venueCapacityMap;
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
    const raw = [];
    for (const ev of events) {
      const venue = ev._embedded?.venues?.[0];
      const lat = Number(venue?.location?.latitude);
      const lon = Number(venue?.location?.longitude);
      const place = Number.isFinite(lat) && Number.isFinite(lon) ? await findNearestPlace(lat, lon, places) : null;
      raw.push({ tmEvent: ev, placeId: place?.id, attractionId: artist.ticketmasterAttractionId });
    }
    return raw;
  } catch (err) {
    console.warn(`Artist pass failed for ${artist.name}: ${err.message}`);
    return [];
  }
}

async function fetchStateEvents(stateCode, classificationName, places) {
  const raw = [];
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
        if (place) raw.push({ tmEvent: ev, placeId: place.id });
      }
      const totalPages = data.page?.totalPages ?? 1;
      page++;
      if (page >= totalPages) break;
    } catch (err) {
      console.warn(`Geo pass failed for ${stateCode}/${classificationName} page ${page}: ${err.message}`);
      break;
    }
  }
  return raw;
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
  const artistRaw = artistEventLists.flat();
  console.log(`Artist pass: ${artistRaw.length} events across ${artists.filter((a) => a.ticketmasterAttractionId).length} resolved artists.`);

  const geoRaw = [];
  for (const state of FOOTPRINT_STATES) {
    for (const classification of CLASSIFICATIONS) {
      const raw = await fetchStateEvents(state, classification, places);
      geoRaw.push(...raw);
    }
  }
  console.log(`Geographic pass: ${geoRaw.length} events across ${FOOTPRINT_STATES.length} states.`);

  // dedupe raw entries by sourceId before the (rate-limited) venue lookup,
  // so a venue hosting several artist-pass + geo-pass duplicates of the same
  // show only gets counted, and looked up, once.
  const rawBySourceId = new Map();
  for (const entry of [...artistRaw, ...geoRaw]) {
    if (!rawBySourceId.has(entry.tmEvent.id)) rawBySourceId.set(entry.tmEvent.id, entry);
  }
  const rawEntries = Array.from(rawBySourceId.values());

  const venueCapacityMap = await fetchVenueCapacities(rawEntries);

  const allEvents = rawEntries.map((entry) => mapTicketmasterEvent(entry.tmEvent, { ...entry, venueCapacityMap }));

  // The geo sweep alone returns thousands of small local listings — keep
  // only events with a real popularity signal: artist-pass hits (every
  // artist here is one of the user's actual Spotify artists) plus anything
  // that scored above "local" on venue capacity (notable venue and up).
  // "local"-scale events found only via the geo sweep are the noise this
  // filter exists to cut.
  const combined = allEvents.filter((ev) => ev.artistIds.length > 0 || ev.scale !== "local");
  console.log(`Filtered ${allEvents.length} candidate events down to ${combined.length} big-ticket/favorite-artist events.`);

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(path.join(CACHE_DIR, "ticketmaster.json"), JSON.stringify(combined, null, 2));
  console.log(`Wrote ${combined.length} unique Ticketmaster events to .cache/ticketmaster.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
