// Relevance scoring — pure functions, all weights read from config.scoring.

export function eventScore(event, place, scoring) {
  const scaleW = scoring.scaleWeight[event.scale] ?? 1;
  const favMult = event.isFavoriteArtist ? scoring.favoriteArtistMultiplier : 1;
  const distanceNm = place ? place.distanceNm : 0;
  const proximity = Math.pow(2, -distanceNm / scoring.proximityHalfLifeNm);
  const confPenalty = scoring.confidencePenalty[event.confidence] ?? 1;
  const rarity = event.recurringId
    ? scoring.rarityBoost.annual
    : scoring.rarityBoost.recurring;

  return scaleW * favMult * proximity * confPenalty * rarity;
}

// Which event categories count toward each activity's event bonus. Without
// this, eventBonus summed over every event at a place regardless of category
// — for a place with a lot going on, that sum dwarfs the 0-10 spread of the
// curated baseScore and ends up nearly identical across all six activity
// tabs, so the ranking barely changes when you switch tabs. Nightlife and
// weird have no clean event-category counterpart, so they're intentionally
// scored on the curated place attribute alone.
const ACTIVITY_CATEGORIES = {
  "live-music": ["concert"],
  art: ["art"],
  food: ["food"],
  outdoors: ["outdoors", "fair"],
  nightlife: [],
  weird: [],
};

/**
 * Rank places for a given activity key within the currently-visible event
 * set. Returns [{place, score, topEvent}] sorted descending.
 */
export function rankPlacesByActivity(places, eventsByPlace, activityKey, scoring) {
  const relevantCategories = new Set(ACTIVITY_CATEGORIES[activityKey] ?? []);
  const results = [];
  for (const place of places) {
    const baseScore = (place.activities?.[activityKey] ?? 0) * 2;
    const events = (eventsByPlace.get(place.id) || []).filter((ev) => relevantCategories.has(ev.category));
    let eventBonus = 0;
    let topEvent = null;
    let topEventScore = -Infinity;
    for (const ev of events) {
      const s = eventScore(ev, place, scoring);
      eventBonus += s * 0.15; // stacking bonus, diminishing weight
      if (s > topEventScore) {
        topEventScore = s;
        topEvent = ev;
      }
    }
    const distancePenalty = place.distanceNm / 200;
    const score = baseScore + eventBonus - distancePenalty;
    if (score > 0) {
      results.push({ place, score, topEvent, eventCount: events.length });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

/**
 * Generate weekend candidates (Fri-Sun) within a date window.
 * fridaysInRange: array of Date objects (Fridays)
 * eventsByWeekend: Map<fridayKey, Event[]>
 * overrides: { "YYYY-MM-DD": { placeId, note } }
 */
export function rankWeekendCandidates(friday, weekendEvents, places, scoring, override) {
  const placesById = new Map(places.map((p) => [p.id, p]));
  const byPlace = new Map();

  for (const ev of weekendEvents) {
    const place = placesById.get(ev.placeId);
    if (!place) continue;
    const s = eventScore(ev, place, scoring);
    if (!byPlace.has(ev.placeId)) {
      byPlace.set(ev.placeId, { place, score: 0, events: [] });
    }
    const entry = byPlace.get(ev.placeId);
    entry.events.push(ev);
    entry.score += s;
    if (entry.events.length > 1) entry.score += s * 0.1; // small stacking bonus
  }

  let candidates = Array.from(byPlace.values()).sort((a, b) => b.score - a.score);

  if (override) {
    const overridePlace = placesById.get(override.placeId);
    if (overridePlace) {
      candidates = candidates.filter((c) => c.place.id !== override.placeId);
      const existingEntry = byPlace.get(override.placeId);
      candidates.unshift({
        place: overridePlace,
        score: Infinity,
        events: existingEntry ? existingEntry.events : [],
        manual: true,
        note: override.note,
      });
    }
  }

  return candidates.slice(0, 3);
}
