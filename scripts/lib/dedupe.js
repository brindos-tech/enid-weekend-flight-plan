// Event dedupe per ARCHITECTURE.md §16. Curated, recurring, and Ticketmaster
// records will collide — match when placeId matches, dates overlap within
// ±1 day, and normalized title similarity is high.

function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .join(" ");
}

const STOPWORDS = new Set(["the", "and", "for", "with", "featuring", "presents", "tour"]);

function bigrams(str) {
  const set = new Set();
  for (let i = 0; i < str.length - 1; i++) set.add(str.slice(i, i + 2));
  return set;
}

/** Sorensen-Dice coefficient over character bigrams of normalized titles. */
export function titleSimilarity(a, b) {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ba = bigrams(na);
  const bb = bigrams(nb);
  let intersection = 0;
  for (const bg of ba) if (bb.has(bg)) intersection++;
  return (2 * intersection) / (ba.size + bb.size || 1);
}

function daysBetween(dateA, dateB) {
  const a = new Date(dateA).getTime();
  const b = new Date(dateB).getTime();
  return Math.abs(a - b) / 86400000;
}

export function isDuplicate(eventA, eventB, { titleThreshold = 0.75, dayTolerance = 1 } = {}) {
  if (eventA.placeId !== eventB.placeId) return false;
  if (daysBetween(eventA.start, eventB.start) > dayTolerance) return false;
  return titleSimilarity(eventA.title, eventB.title) >= titleThreshold;
}

const FIELD_PRECEDENCE = {
  description: ["curated", "recurring", "ticketmaster"],
  scale: ["curated", "recurring", "ticketmaster"],
  attendance: ["curated", "recurring", "ticketmaster"],
  start: ["ticketmaster", "curated", "recurring"],
  end: ["ticketmaster", "curated", "recurring"],
  startTime: ["ticketmaster", "curated", "recurring"],
  ticketUrl: ["ticketmaster", "curated", "recurring"],
  url: ["ticketmaster", "curated", "recurring"],
};

const CONFIDENCE_RANK = { confirmed: 3, "annual-estimate": 2, unconfirmed: 1 };

/** Merge two duplicate event records field-by-field per precedence table. */
export function mergeEventPair(a, b) {
  const bySource = { [a.source]: a, [b.source]: b };
  const merged = { ...a };

  for (const [field, precedence] of Object.entries(FIELD_PRECEDENCE)) {
    for (const source of precedence) {
      const candidate = bySource[source];
      if (candidate && candidate[field] != null && candidate[field] !== "") {
        merged[field] = candidate[field];
        break;
      }
    }
  }

  merged.confidence =
    CONFIDENCE_RANK[a.confidence] >= CONFIDENCE_RANK[b.confidence] ? a.confidence : b.confidence;
  merged.id = a.source === "curated" ? a.id : b.source === "curated" ? b.id : a.id;
  merged.artistIds = Array.from(new Set([...(a.artistIds || []), ...(b.artistIds || [])]));
  merged.isFavoriteArtist = a.isFavoriteArtist || b.isFavoriteArtist;

  return merged;
}

/**
 * Dedupe a flat list of events, merging duplicates by precedence.
 * Returns { events, mergeLog } where mergeLog records what was merged
 * (written to meta.dedupe so a wrong match is diagnosable).
 */
export function dedupeEvents(events) {
  const result = [];
  const mergeLog = [];
  const consumed = new Set();

  for (let i = 0; i < events.length; i++) {
    if (consumed.has(i)) continue;
    let current = events[i];
    for (let j = i + 1; j < events.length; j++) {
      if (consumed.has(j)) continue;
      if (isDuplicate(current, events[j])) {
        mergeLog.push({ kept: current.title, mergedFrom: events[j].title, placeId: current.placeId });
        current = mergeEventPair(current, events[j]);
        consumed.add(j);
      }
    }
    result.push(current);
  }

  return { events: result, mergeLog };
}
