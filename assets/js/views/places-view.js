import { formatFlightTime, decodeEntities } from "../format.js";
import { rankPlacesByActivity } from "../score.js";

const ACTIVITIES = [
  { key: "live-music", label: "Live Music" },
  { key: "art", label: "Art" },
  { key: "food", label: "Food" },
  { key: "nightlife", label: "Nightlife" },
  { key: "outdoors", label: "Outdoors" },
  { key: "weird", label: "Boutique" },
];

let activeActivity = "live-music";

export function renderPlaces(container, filtered, config, onSelect) {
  const { visiblePlaces, eventsByPlace } = filtered;

  const tabsHtml = ACTIVITIES.map(
    (a) => `<button class="chip ${a.key === activeActivity ? "active" : ""}" data-activity="${a.key}">${a.label}</button>`
  ).join("");

  const ranked = rankPlacesByActivity(visiblePlaces, eventsByPlace, activeActivity, config.scoring);

  const cardsHtml = ranked.length
    ? ranked
        .map(
          (r, i) => `
      <button type="button" class="place-card" data-place="${r.place.id}" aria-label="${r.place.name}${r.place.state ? `, ${r.place.state}` : ""}, ranked number ${i + 1}">
        <div class="pc-rank">#${i + 1}</div>
        <h4>${r.place.name}${r.place.state ? `, ${r.place.state}` : ""}</h4>
        <div class="pc-dist">${formatFlightTime(r.place.flightMinutes)} · ${Math.round(r.place.distanceNm)} nm</div>
        ${r.topEvent ? `<div class="pc-event">${decodeEntities(r.topEvent.title)}</div>` : `<div class="pc-event" style="color:var(--muted)">No events in window — scores on activity fit alone</div>`}
        <div class="pc-kinds">${r.place.kinds.map((k) => `<span class="kind-pill">${k}</span>`).join("")}</div>
      </button>`
        )
        .join("")
    : `<div class="empty-state">No places score for ${(ACTIVITIES.find((a) => a.key === activeActivity)?.label || activeActivity).toLowerCase()} in the current range and window.</div>`;

  container.innerHTML = `
    <h2>Places</h2>
    <p class="view-sub">Ranked per activity, not one flat list — the winners change as you move the date window.</p>
    <div class="activity-tabs">${tabsHtml}</div>
    <div class="place-grid">${cardsHtml}</div>
  `;

  container.querySelectorAll("[data-activity]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeActivity = btn.dataset.activity;
      renderPlaces(container, filtered, config, onSelect);
    });
  });

  container.querySelectorAll(".place-card").forEach((card) => {
    card.addEventListener("click", () => onSelect(card.dataset.place));
  });
}
