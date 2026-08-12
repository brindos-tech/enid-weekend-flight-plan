// The single filter pipeline. Every view renders from this output — do not
// let a view filter independently, or views will drift out of sync.
import { parseDate } from "./format.js";
import { eventScore } from "./score.js";
import { isHighlightEvent, passesVisibilityGate } from "./importance.js";

function eventOverlapsRange(event, rangeStart, rangeEnd) {
  const evStart = parseDate(event.start);
  const evEnd = parseDate(event.end || event.start);
  return evStart <= rangeEnd && evEnd >= rangeStart;
}

function matchesSearch(text, query) {
  if (!query) return true;
  return text.toLowerCase().includes(query.toLowerCase());
}

export function applyFilters(places, events, state, config) {
  // 1-3: place gates
  const visiblePlaces = places.filter((place) => {
    if (place.distanceNm > state.rangeNm) return false;
    if (state.westOnly && !place.isWest) return false;
    if (state.activities.size > 0) {
      const hasActivity = Array.from(state.activities).some(
        (a) => (place.activities?.[a] ?? 0) >= 3
      );
      if (!hasActivity) return false;
    }
    return true;
  });
  const visiblePlaceIds = new Set(visiblePlaces.map((p) => p.id));

  // 4-6: event gates
  const scaleOrder = { local: 0, notable: 1, major: 2, flagship: 3 };
  const minScaleRank = state.minScale ? scaleOrder[state.minScale] : -1;

  // The wider the selected window, the more curation it needs: inside ~2
  // weeks everything else already allowed stays visible for browsing
  // (smaller college games, non-favorite concerts); beyond that only
  // highlight events (favorite artist / pro-or-SEC game) stay visible at
  // all — see importance.js.
  const spanDays = Math.round((state.dateRange.end - state.dateRange.start) / 86400000);

  let visibleEvents = events.filter((ev) => {
    if (!visiblePlaceIds.has(ev.placeId)) return false;
    if (!eventOverlapsRange(ev, state.dateRange.start, state.dateRange.end)) return false;
    if (state.categories.size > 0 && !state.categories.has(ev.category)) return false;
    if (minScaleRank >= 0 && scaleOrder[ev.scale] < minScaleRank) return false;
    if (state.favoritesOnly && !ev.isFavoriteArtist) return false;
    if (!passesVisibilityGate(ev, spanDays)) return false;
    return true;
  });

  // 7: text search
  if (state.search) {
    const placeById = new Map(places.map((p) => [p.id, p]));
    visibleEvents = visibleEvents.filter((ev) => {
      const place = placeById.get(ev.placeId);
      const haystack = `${ev.title} ${place?.name || ""} ${ev.description || ""}`;
      return matchesSearch(haystack, state.search);
    });
  }

  // 8: score + sort
  const placeById = new Map(places.map((p) => [p.id, p]));
  const scored = visibleEvents
    .map((ev) => ({ event: ev, score: eventScore(ev, placeById.get(ev.placeId), config.scoring) }))
    .sort((a, b) => {
      const dateCompare = ev_start(a.event) - ev_start(b.event);
      if (dateCompare !== 0) return dateCompare;
      return b.score - a.score;
    });

  visibleEvents = scored.map((s) => s.event);

  // per-place event index for downstream views
  const eventsByPlace = new Map();
  for (const ev of visibleEvents) {
    if (!eventsByPlace.has(ev.placeId)) eventsByPlace.set(ev.placeId, []);
    eventsByPlace.get(ev.placeId).push(ev);
  }

  for (const place of visiblePlaces) {
    const evs = eventsByPlace.get(place.id) || [];
    place.eventCount = evs.length;
    // best-scoring first; a non-highlight event always scores 0 (see
    // score.js) so it only ever leads this list when nothing else at the
    // place qualifies as a highlight.
    place.rankedEvents = evs
      .slice()
      .sort((a, b) => eventScore(b, place, config.scoring) - eventScore(a, place, config.scoring));
    place.topEvent = place.rankedEvents[0] || null;
  }

  const counts = {
    placeCount: visiblePlaces.length,
    eventCount: visibleEvents.length,
    totalPlaceCount: places.length,
    totalEventCount: events.length,
  };

  return { visiblePlaces, visibleEvents, eventsByPlace, counts };
}

function ev_start(event) {
  return parseDate(event.start).getTime();
}

let lastHash = null;
let lastResult = null;

export function applyFiltersMemoized(places, events, state, config) {
  const hash = JSON.stringify({
    rangeNm: state.rangeNm,
    westOnly: state.westOnly,
    categories: Array.from(state.categories).sort(),
    activities: Array.from(state.activities).sort(),
    favoritesOnly: state.favoritesOnly,
    minScale: state.minScale,
    search: state.search,
    start: state.dateRange.start.getTime(),
    end: state.dateRange.end.getTime(),
  });
  if (hash === lastHash && lastResult) return lastResult;
  lastHash = hash;
  lastResult = applyFilters(places, events, state, config);
  return lastResult;
}
