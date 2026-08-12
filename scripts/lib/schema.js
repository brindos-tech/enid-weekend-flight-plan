// Validation gate per ARCHITECTURE.md §9.4. Returns { ok, errors } — the
// caller (validate.js) decides whether to fail the build. A failed build
// must preserve last-good data/generated/*.json (handled by the workflow,
// not here — this module only reports).

const CATEGORY_ENUM = new Set([
  "concert", "festival", "rodeo", "fair", "sports", "art", "food", "outdoors", "holiday", "misc",
]);
const SCALE_ENUM = new Set(["flagship", "major", "notable", "local"]);
const CONFIDENCE_ENUM = new Set(["confirmed", "annual-estimate", "unconfirmed"]);

function isValidLat(n) { return typeof n === "number" && n >= -90 && n <= 90; }
function isValidLon(n) { return typeof n === "number" && n >= -180 && n <= 180; }
function isDateString(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }

export function validatePlace(place, errors) {
  if (!place.id) errors.push(`place missing id: ${JSON.stringify(place).slice(0, 80)}`);
  if (!place.name) errors.push(`place ${place.id} missing name`);
  if (!isValidLat(place.lat)) errors.push(`place ${place.id} invalid lat: ${place.lat}`);
  if (!isValidLon(place.lon)) errors.push(`place ${place.id} invalid lon: ${place.lon}`);
  if (!Array.isArray(place.kinds) || place.kinds.length === 0) {
    errors.push(`place ${place.id} missing kinds`);
  }
  if (!Array.isArray(place.airports) || place.airports.length === 0) {
    errors.push(`place ${place.id} has no airports`);
  }
}

export function validateEvent(event, placeIds, errors) {
  if (!event.id) errors.push(`event missing id: ${JSON.stringify(event).slice(0, 80)}`);
  if (!event.title) errors.push(`event ${event.id} missing title`);
  if (!isDateString(event.start)) errors.push(`event ${event.id} invalid start: ${event.start}`);
  if (event.end && !isDateString(event.end)) errors.push(`event ${event.id} invalid end: ${event.end}`);
  if (!placeIds.has(event.placeId)) {
    errors.push(`event ${event.id} references unknown placeId: ${event.placeId}`);
  }
  if (!CATEGORY_ENUM.has(event.category)) {
    errors.push(`event ${event.id} invalid category: ${event.category}`);
  }
  if (!SCALE_ENUM.has(event.scale)) {
    errors.push(`event ${event.id} invalid scale: ${event.scale}`);
  }
  if (!CONFIDENCE_ENUM.has(event.confidence)) {
    errors.push(`event ${event.id} invalid confidence: ${event.confidence}`);
  }
}

/**
 * Full validation pass. `previousMeta` (last known-good meta.json) is used
 * to catch a silent API outage: if event count dropped >40% vs last run,
 * fail rather than publish a hollowed-out dataset.
 */
export function validateDataset({ places, events, previousMeta }) {
  const errors = [];
  const placeIds = new Set(places.map((p) => p.id));

  for (const place of places) validatePlace(place, errors);
  for (const event of events) validateEvent(event, placeIds, errors);

  const missingUrl = events.filter((e) => !e.url).length;
  if (events.length > 0 && missingUrl / events.length > 0.2) {
    errors.push(`${missingUrl}/${events.length} events (${Math.round((missingUrl / events.length) * 100)}%) are missing a url — exceeds 20% threshold`);
  }

  if (previousMeta && previousMeta.eventCount) {
    const drop = 1 - events.length / previousMeta.eventCount;
    if (drop > 0.4) {
      errors.push(
        `event count dropped ${Math.round(drop * 100)}% vs last build (${previousMeta.eventCount} -> ${events.length}) — likely a silent API outage, not a real drop`
      );
    }
  }

  return { ok: errors.length === 0, errors };
}
