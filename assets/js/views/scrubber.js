import { addDays, formatDateShort, toDateKey, parseDate } from "../format.js";

const PRESETS = [
  { label: "This weekend", days: 3 },
  { label: "Next 2 weeks", days: 14 },
  { label: "Next 30 days", days: 30 },
  { label: "Next 90 days", days: 90 },
];

export function createScrubber({ store, config, allEvents }) {
  const wrap = document.getElementById("scrubberWrap");
  wrap.innerHTML = `
    <button type="button" class="scrubber-summary" id="scrubberSummary" aria-controls="scrubberBody" aria-expanded="false">
      <span id="scrubberSummaryLabel"></span>
      <span class="scrubber-summary-hint">Change</span>
    </button>
    <div class="scrubber-body" id="scrubberBody">
      <div class="scrubber-presets" style="display:flex;gap:6px;flex-wrap:wrap;">
        ${PRESETS.map((p, i) => `<button class="chip" data-preset="${i}">${p.label}</button>`).join("")}
        <button class="chip" data-preset="custom">Custom</button>
      </div>
      <div class="scrubber-track" style="position:relative;height:34px;">
        <canvas id="densityCanvas" style="position:absolute;inset:0;width:100%;height:100%;"></canvas>
        <div id="brushLabel" style="position:absolute;top:-2px;right:0;font-size:0.72em;color:var(--muted);"></div>
      </div>
      <input type="range" id="scrubStart" min="0" max="1" value="0" style="width:100%;">
    </div>
  `;

  const canvas = document.getElementById("densityCanvas");
  const brushLabel = document.getElementById("brushLabel");
  const presetRow = wrap.querySelector(".scrubber-presets");
  const scrubStart = document.getElementById("scrubStart");
  const summaryBtn = document.getElementById("scrubberSummary");
  const summaryLabel = document.getElementById("scrubberSummaryLabel");

  // On phones this strip eats scarce vertical space that the map wants, and
  // once a horizon is picked it's reference material rather than a control.
  // Collapse it to a one-line summary of the chosen range; tapping that
  // brings the presets and density histogram back. Matches the CSS
  // breakpoint — the collapse rules live inside the same media query, so a
  // stale .collapsed class is inert on desktop.
  const isNarrow = window.matchMedia("(max-width: 860px)");

  function setCollapsed(collapsed) {
    wrap.classList.toggle("collapsed", collapsed);
    summaryBtn.setAttribute("aria-expanded", String(!collapsed));
    // The density canvas measures 0px wide while it's display:none, so any
    // draw that happened during collapse produced nothing. Redraw once it
    // has real layout back, or it reappears blank.
    if (!collapsed) {
      requestAnimationFrame(() => {
        const { dateRange } = store.getState();
        drawDensity(dateRange.start, dateRange.end);
      });
    }
  }

  summaryBtn.addEventListener("click", () => {
    setCollapsed(!wrap.classList.contains("collapsed"));
  });

  const today = store.getState().today;
  const horizonStart = addDays(today, -14);

  // weekly density histogram, starting from the widest horizon we'd ever
  // consider (a year out)
  function computeWeeklyDensity(totalDays) {
    const weeks = Math.ceil(totalDays / 7);
    const buckets = new Array(weeks).fill(0);
    for (const ev of allEvents) {
      const d = parseDate(ev.start);
      const offset = Math.round((d - horizonStart) / 86400000);
      const week = Math.floor(offset / 7);
      if (week >= 0 && week < weeks) buckets[week]++;
    }
    return buckets;
  }

  const rawTotalDays = Math.round((addDays(today, 365) - horizonStart) / 86400000);
  const rawBuckets = computeWeeklyDensity(rawTotalDays);

  // Fetched event data thins out hard once the source horizon is
  // exhausted — past that point all that's left is the odd annual-estimate
  // placeholder for next year's recurrence of a handful of festivals, not
  // real browsable coverage. Cap what's scrubbable at the first point
  // coverage goes empty for two weeks running, so the slider can't be
  // dragged into a dead zone with nothing to show.
  const todayWeek = Math.floor((today - horizonStart) / 86400000 / 7);
  let coverageWeeks = rawBuckets.length;
  for (let i = todayWeek; i < rawBuckets.length - 1; i++) {
    if (rawBuckets[i] === 0 && rawBuckets[i + 1] === 0) {
      coverageWeeks = i;
      break;
    }
  }

  const totalDays = coverageWeeks * 7;
  const buckets = rawBuckets.slice(0, coverageWeeks);
  const maxBucket = Math.max(1, ...buckets);

  function drawDensity(rangeStart, rangeEnd) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const barW = w / buckets.length;
    const rangeStartOffset = Math.round((rangeStart - horizonStart) / 86400000);
    const rangeEndOffset = Math.round((rangeEnd - horizonStart) / 86400000);

    buckets.forEach((count, i) => {
      const barH = Math.max(2, (count / maxBucket) * (h - 4));
      const x = i * barW;
      const weekStartOffset = i * 7;
      const weekEndOffset = weekStartOffset + 7;
      const inRange = weekEndOffset > rangeStartOffset && weekStartOffset < rangeEndOffset;
      ctx.fillStyle = inRange ? "#ff8a3d" : "#2a2f3a";
      ctx.fillRect(x + 0.5, h - barH, Math.max(1, barW - 1), barH);
    });
  }

  function applyRange(startOffsetDays, spanDays) {
    const start = addDays(horizonStart, startOffsetDays);
    const end = addDays(start, spanDays);
    store.setState({ dateRange: { start, end } });
    const label = `${formatDateShort(start)} – ${formatDateShort(end)}`;
    brushLabel.textContent = label;
    summaryLabel.textContent = label;
    drawDensity(start, end);
  }

  let currentSpan = 45;

  presetRow.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-preset]");
    if (!btn) return;
    presetRow.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    // "Custom" means the user wants the slider, so leave the strip open.
    if (btn.dataset.preset === "custom") return;
    const preset = PRESETS[Number(btn.dataset.preset)];
    currentSpan = preset.days;
    const startOffset = Math.round((today - horizonStart) / 86400000);
    scrubStart.max = String(Math.max(0, totalDays - currentSpan));
    scrubStart.value = String(startOffset);
    applyRange(startOffset, currentSpan);
    if (isNarrow.matches) setCollapsed(true);
  });

  scrubStart.max = String(Math.max(0, totalDays - currentSpan));
  scrubStart.addEventListener("input", () => {
    presetRow.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
    presetRow.querySelector('[data-preset="custom"]').classList.add("active");
    applyRange(Number(scrubStart.value), currentSpan);
  });

  // init to "Next 30 days"
  presetRow.querySelectorAll(".chip")[2].classList.add("active");
  const initStartOffset = Math.round((today - horizonStart) / 86400000);
  currentSpan = 30;
  scrubStart.value = String(initStartOffset);
  scrubStart.max = String(Math.max(0, totalDays - currentSpan));
  applyRange(initStartOffset, currentSpan);
  // A default horizon is already applied on load, so on phones start folded
  // away — the summary line still says which range is active.
  setCollapsed(isNarrow.matches);

  window.addEventListener("resize", () => {
    const s = store.getState();
    drawDensity(s.dateRange.start, s.dateRange.end);
  });

  // main.js calls this on every state change, which makes it the one place a
  // date range set from *outside* this strip gets reflected back into it —
  // a range restored from the URL, mainly. Without it the label and the
  // highlighted preset keep advertising whatever was last clicked here while
  // the app filters by something else entirely.
  function redraw(state) {
    const { start, end } = state.dateRange;
    const label = `${formatDateShort(start)} – ${formatDateShort(end)}`;
    brushLabel.textContent = label;
    summaryLabel.textContent = label;

    const spanDays = Math.round((end - start) / 86400000);
    const startOffset = Math.round((start - horizonStart) / 86400000);
    currentSpan = spanDays;
    scrubStart.max = String(Math.max(0, totalDays - spanDays));
    // Assigning .value programmatically does not fire "input", so this
    // cannot loop back through applyRange into setState.
    scrubStart.value = String(startOffset);

    // A preset is only "the" preset when the window also starts today —
    // otherwise it's a 30-day span someone dragged, which is Custom.
    const startsToday = startOffset === Math.round((today - horizonStart) / 86400000);
    const presetIdx = startsToday ? PRESETS.findIndex((p) => p.days === spanDays) : -1;
    presetRow.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
    const activeChip =
      presetIdx >= 0
        ? presetRow.querySelector(`[data-preset="${presetIdx}"]`)
        : presetRow.querySelector('[data-preset="custom"]');
    activeChip?.classList.add("active");

    drawDensity(start, end);
  }

  return { redraw };
}
