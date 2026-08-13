const CATEGORIES = ["concert", "festival", "rodeo", "fair", "sports", "art", "food", "outdoors", "holiday"];
const ACTIVITIES = [
  { key: "live-music", label: "Live Music" },
  { key: "art", label: "Art" },
  { key: "food", label: "Food" },
  { key: "nightlife", label: "Nightlife" },
  { key: "outdoors", label: "Outdoors" },
  { key: "weird", label: "Weird" },
];

export function createFilterRail({ store, config }) {
  const originChips = document.getElementById("originChips");
  const rangeOriginLabel = document.getElementById("rangeOriginLabel");
  const rangeSlider = document.getElementById("rangeSlider");
  const rangeValue = document.getElementById("rangeValue");
  const rangeCounts = document.getElementById("rangeCounts");
  const rangeMarks = document.getElementById("rangeMarks");
  const westToggle = document.getElementById("westToggle");
  const westDelta = document.getElementById("westDelta");
  const categoryChips = document.getElementById("categoryChips");
  const activityChips = document.getElementById("activityChips");
  const railReset = document.getElementById("railReset");
  const railToggleBtn = document.getElementById("railToggle");
  const filterRail = document.getElementById("filterRail");

  rangeSlider.min = config.rangeSlider.min;
  rangeSlider.max = config.rangeSlider.max;
  rangeSlider.step = config.rangeSlider.step;

  const marksHtml = config.rangeSlider.marks
    .map((nm) => {
      const pct = ((nm - config.rangeSlider.min) / (config.rangeSlider.max - config.rangeSlider.min)) * 100;
      const isLeg = nm === config.aircraft.legRangeNm;
      return `<span class="${isLeg ? "leg-boundary" : ""}" style="left:${pct}%">${nm}</span>`;
    })
    .join("");
  rangeMarks.innerHTML = marksHtml;

  originChips.innerHTML = config.origins
    .map((o) => `<button class="chip" data-origin="${o.id}">${o.name} (${o.icao})</button>`)
    .join("");

  categoryChips.innerHTML = CATEGORIES.map((c) => `<button class="chip" data-cat="${c}">${c}</button>`).join("");
  activityChips.innerHTML = ACTIVITIES.map(
    (a) => `<button class="chip" data-act="${a.key}">${a.label}</button>`
  ).join("");

  originChips.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-origin]");
    if (!btn) return;
    store.setState({ originId: btn.dataset.origin });
  });

  rangeSlider.addEventListener("input", () => {
    store.setState({ rangeNm: Number(rangeSlider.value) });
  });

  westToggle.addEventListener("change", () => {
    store.setState({ westOnly: westToggle.checked });
  });

  categoryChips.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cat]");
    if (!btn) return;
    const cat = btn.dataset.cat;
    const cats = new Set(store.getState().categories);
    cats.has(cat) ? cats.delete(cat) : cats.add(cat);
    store.setState({ categories: cats });
  });

  activityChips.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    const acts = new Set(store.getState().activities);
    acts.has(act) ? acts.delete(act) : acts.add(act);
    store.setState({ activities: acts });
  });

  railReset.addEventListener("click", () => store.reset());

  railToggleBtn.addEventListener("click", () => {
    filterRail.classList.toggle("open");
  });

  function syncFromState(state) {
    originChips.querySelectorAll("[data-origin]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.origin === state.originId);
    });
    const origin = config.origins.find((o) => o.id === state.originId) || config.origins[0];
    rangeOriginLabel.textContent = origin.icao;
    rangeSlider.value = state.rangeNm;
    rangeValue.textContent = state.rangeNm;
    westToggle.checked = state.westOnly;
    categoryChips.querySelectorAll("[data-cat]").forEach((btn) => {
      btn.classList.toggle("active", state.categories.has(btn.dataset.cat));
    });
    activityChips.querySelectorAll("[data-act]").forEach((btn) => {
      btn.classList.toggle("active", state.activities.has(btn.dataset.act));
    });
  }

  function setCounts(placeCount, eventCount) {
    rangeCounts.textContent = `${placeCount} place${placeCount === 1 ? "" : "s"} · ${eventCount} event${eventCount === 1 ? "" : "s"} in window`;
  }

  function setWestDelta(text) {
    westDelta.textContent = text || "";
  }

  return { syncFromState, setCounts, setWestDelta, ACTIVITIES };
}
