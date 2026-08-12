import { formatDateRange, decodeEntities } from "../format.js";

export function renderArtists(container, filtered, { artists, meta, places }, onSelect) {
  const { visibleEvents } = filtered;
  const placeById = new Map(places.map((p) => [p.id, p]));

  const eventsByArtist = new Map();
  for (const ev of visibleEvents) {
    for (const aid of ev.artistIds || []) {
      if (!eventsByArtist.has(aid)) eventsByArtist.set(aid, []);
      eventsByArtist.get(aid).push(ev);
    }
  }

  const favoriteArtists = artists.filter((a) => a.source !== "manual" || eventsByArtist.has(a.id));
  const withShows = favoriteArtists.filter((a) => eventsByArtist.has(a.id));

  const reauthBanner =
    meta?.sources?.spotify?.status === "reauth_required"
      ? `<div class="reauth-banner">Spotify sync needs re-authorization (refresh tokens expire every 6 months) — showing the last-known artist list. Run <code>npm run spotify-auth</code> locally to reconnect (see README).</div>`
      : "";

  function showRow(ev) {
    const place = placeById.get(ev.placeId);
    const label = `${decodeEntities(ev.title)}${place ? `, ${place.name}` : ""}, ${formatDateRange(ev.start, ev.end)}`;
    return `<button type="button" class="show-row" data-place="${ev.placeId}" data-event="${ev.id}" aria-label="${label.replace(/"/g, "&quot;")}">
      <b>${formatDateRange(ev.start, ev.end)}</b> — ${decodeEntities(ev.title)}${place ? ` (${place.name})` : ""}
    </button>`;
  }

  function artistCard(artist) {
    const shows = eventsByArtist.get(artist.id) || [];
    const showsHtml = shows.length ? shows.map(showRow).join("") : `<div class="no-shows">No shows in the current window.</div>`;
    return `<div class="artist-card"><h4>${artist.name}</h4>${showsHtml}</div>`;
  }

  const withShowsHtml = withShows.length
    ? withShows.map(artistCard).join("")
    : `<div class="empty-state">None of your favorites have shows in the current filters — try widening the date window.</div>`;

  container.innerHTML = `
    <h2>Artists</h2>
    <p class="view-sub">Your favorites, with anything upcoming in the footprint.</p>
    ${reauthBanner}
    <div class="artist-grid">${withShowsHtml}</div>
  `;

  container.querySelectorAll("[data-place]").forEach((row) => {
    row.addEventListener("click", () => onSelect(row.dataset.place, row.dataset.event));
  });
}
