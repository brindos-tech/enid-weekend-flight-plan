// HTML entity decode for migrated/scraped text. Mirrors the small map in
// assets/js/format.js — kept separate because this runs in Node, not the
// browser, and the two must not import across the plane boundary.

const ENTITY_MAP = {
  "&mdash;": "—", "&ndash;": "–", "&amp;": "&", "&hellip;": "…",
  "&middot;": "·", "&Uuml;": "Ü", "&minus;": "−", "&#9992;": "✈",
  "&quot;": '"', "&#39;": "'", "&lt;": "<", "&gt;": ">",
};

export function decodeEntities(str) {
  if (!str) return str;
  return str.replace(/&[a-zA-Z#0-9]+;/g, (m) => ENTITY_MAP[m] || m);
}
