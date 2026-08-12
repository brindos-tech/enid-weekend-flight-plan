import { parseDate, formatDateRange, formatFlightTime, decodeEntities, fridayOf, toDateKey } from "../format.js";

export function renderFeed(container, { visibleEvents, eventsByPlace }, places, onSelect) {
  const placeById = new Map(places.map((p) => [p.id, p]));

  if (visibleEvents.length === 0) {
    container.innerHTML = `
      <h2>Feed</h2>
      <p class="view-sub">Chronological, respecting every filter in the rail.</p>
      <div class="empty-state">Nothing matches the current filters. Try widening the range or date window.</div>
    `;
    return;
  }

  // group by weekend (Friday key)
  const groups = new Map();
  for (const ev of visibleEvents) {
    const friday = fridayOf(parseDate(ev.start));
    const key = toDateKey(friday);
    if (!groups.has(key)) groups.set(key, { friday, events: [] });
    groups.get(key).events.push(ev);
  }

  const sortedKeys = Array.from(groups.keys()).sort();

  const html = sortedKeys
    .map((key) => {
      const group = groups.get(key);
      const rows = group.events
        .map((ev) => {
          const place = placeById.get(ev.placeId);
          const badge = ev.confidence !== "confirmed" ? `<span class="badge estimate">est.</span>` : "";
          const favStar = ev.isFavoriteArtist ? `<span class="badge favorite">★</span>` : "";
          const label = `${decodeEntities(ev.title)}, ${place ? place.name : ev.placeId}, ${formatDateRange(ev.start, ev.end)}`;
          return `
            <button type="button" class="feed-row" data-event="${ev.id}" data-place="${ev.placeId}" aria-label="${label.replace(/"/g, "&quot;")}">
              <div class="fr-date">${formatDateRange(ev.start, ev.end)}</div>
              <div>
                <div class="fr-title"><span class="scale-dot ${ev.scale}"></span>${decodeEntities(ev.title)}</div>
                <div class="fr-place">${place ? place.name : ev.placeId} · ${place ? formatFlightTime(place.flightMinutes) : ""}</div>
              </div>
              <div class="fr-meta">
                <span class="badge">${ev.category}</span>
                ${favStar}${badge}
              </div>
            </button>`;
        })
        .join("");
      return `
        <div class="feed-group">
          <h4>Weekend of ${formatDateRange(key, key)}</h4>
          ${rows}
        </div>`;
    })
    .join("");

  container.innerHTML = `
    <h2>Feed</h2>
    <p class="view-sub">Chronological, grouped by weekend, respecting every filter in the rail.</p>
    ${html}
  `;

  container.querySelectorAll(".feed-row").forEach((row) => {
    row.addEventListener("click", () => onSelect(row.dataset.place, row.dataset.event));
  });
}
