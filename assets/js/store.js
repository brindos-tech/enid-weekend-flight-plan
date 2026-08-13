// Minimal state container. No framework, no two-way binding.

function defaultState(config, today) {
  const horizonEnd = new Date(today);
  horizonEnd.setDate(horizonEnd.getDate() + (config.defaults.horizonDays || 45));
  return {
    today,
    dateRange: { start: today, end: horizonEnd },
    originId: config.defaultOriginId,
    rangeNm: config.defaults.rangeNm,
    westOnly: config.defaults.westOfMississippiOnly,
    categories: new Set(),
    activities: new Set(),
    minScale: null, // null = no floor; show everything in range
    search: "",
    view: "map",
    selectedPlaceId: null,
    selectedEventId: null,
  };
}

export function createStore(config, today = new Date()) {
  let state = defaultState(config, today);
  const listeners = new Set();
  let notifyQueued = false;

  function notify() {
    if (notifyQueued) return;
    notifyQueued = true;
    queueMicrotask(() => {
      notifyQueued = false;
      for (const fn of listeners) fn(state);
    });
  }

  return {
    getState() {
      return state;
    },
    setState(patch) {
      state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
      notify();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    reset() {
      state = defaultState(config, state.today);
      notify();
    },
  };
}
