// Bidirectional state <-> location.hash, so a link fully reproduces a view.
import { toDateKey, parseDate } from "./format.js";

export function stateToHash(state) {
  const params = new URLSearchParams();
  params.set("v", state.view);
  params.set("from", toDateKey(state.dateRange.start));
  params.set("to", toDateKey(state.dateRange.end));
  params.set("origin", state.originId);
  params.set("r", String(state.rangeNm));
  params.set("west", state.westOnly ? "1" : "0");
  if (state.categories.size) params.set("cat", Array.from(state.categories).join(","));
  if (state.activities.size) params.set("act", Array.from(state.activities).join(","));
  if (state.search) params.set("q", state.search);
  if (state.selectedPlaceId) params.set("place", state.selectedPlaceId);
  return `#/${params.toString()}`;
}

export function hashToState(hash, defaults) {
  const clean = hash.replace(/^#\/?/, "");
  const params = new URLSearchParams(clean);
  const patch = {};

  if (params.has("v")) patch.view = params.get("v");
  if (params.has("from")) patch.dateRange = { ...defaults.dateRange, start: parseDate(params.get("from")) };
  if (params.has("to")) {
    patch.dateRange = { ...(patch.dateRange || defaults.dateRange), end: parseDate(params.get("to")) };
  }
  if (params.has("origin")) patch.originId = params.get("origin");
  if (params.has("r")) patch.rangeNm = Number(params.get("r"));
  if (params.has("west")) patch.westOnly = params.get("west") === "1";
  if (params.has("cat")) patch.categories = new Set(params.get("cat").split(",").filter(Boolean));
  if (params.has("act")) patch.activities = new Set(params.get("act").split(",").filter(Boolean));
  if (params.has("q")) patch.search = params.get("q");
  if (params.has("place")) patch.selectedPlaceId = params.get("place");

  return patch;
}

export function initUrlState(store) {
  if (window.location.hash && window.location.hash.length > 3) {
    const patch = hashToState(window.location.hash, store.getState());
    store.setState(patch);
  }

  // setTimeout, not requestAnimationFrame — this is background bookkeeping,
  // not a paint-timed update, and rAF can be suspended entirely in a
  // backgrounded/non-visible tab, silently freezing the URL out of sync.
  let replaceQueued = false;
  store.subscribe((state) => {
    if (replaceQueued) return;
    replaceQueued = true;
    setTimeout(() => {
      replaceQueued = false;
      const hash = stateToHash(state);
      if (hash !== window.location.hash) {
        history.replaceState(null, "", hash);
      }
    }, 0);
  });
}
