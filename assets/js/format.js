// Formatting helpers: dates, flight time, entity decode.

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Parse a "YYYY-MM-DD" string into a local Date at midnight (no TZ drift). */
export function parseDate(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function formatDateShort(date) {
  return `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`;
}

export function formatDateRange(startStr, endStr) {
  const start = parseDate(startStr);
  const end = parseDate(endStr || startStr);
  if (startStr === endStr || !endStr) return formatDateShort(start);
  if (start.getMonth() === end.getMonth()) {
    return `${MONTH_NAMES[start.getMonth()]} ${start.getDate()}–${end.getDate()}`;
  }
  return `${formatDateShort(start)} – ${formatDateShort(end)}`;
}

/** Format minutes as "1h19m" / "45m" style string. */
export function formatFlightTime(minutes) {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return `${h}h${String(m).padStart(2, "0")}m`;
}

export function formatWeekdayDate(date) {
  return `${DOW_NAMES[date.getDay()]} ${formatDateShort(date)}`;
}

/** Friday of the week containing `date` (assumes weekends run Fri-Sun). */
export function fridayOf(date) {
  const dow = date.getDay(); // 0=Sun..6=Sat
  const diff = dow === 0 ? -2 : 5 - dow; // move to Friday
  return addDays(date, diff);
}

export function daysBetween(a, b) {
  const MS_PER_DAY = 86400000;
  return Math.round((b.setHours(0, 0, 0, 0) - a.setHours(0, 0, 0, 0)) / MS_PER_DAY);
}

export function relativeDayLabel(dateStr, today) {
  const d = parseDate(dateStr);
  const diff = daysBetween(new Date(today), new Date(d));
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff > 1 && diff <= 7) return `In ${diff} days`;
  if (diff < 0) return "Past";
  return formatDateShort(d);
}

export function formatUpdatedAgo(isoString, now = new Date()) {
  if (!isoString) return "never";
  const then = new Date(isoString);
  const diffMs = now - then;
  const hours = Math.floor(diffMs / 3600000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// WMO weather codes (Open-Meteo), collapsed to the ranges that matter for
// a quick glance — not a full aviation weather product.
const WMO_LABELS = [
  [[0], "Clear"], [[1, 2, 3], "Partly cloudy"], [[45, 48], "Fog"],
  [[51, 53, 55, 56, 57], "Drizzle"], [[61, 63, 65, 66, 67], "Rain"],
  [[71, 73, 75, 77], "Snow"], [[80, 81, 82], "Rain showers"],
  [[85, 86], "Snow showers"], [[95, 96, 99], "Thunderstorm"],
];

export function weatherCodeLabel(code) {
  const match = WMO_LABELS.find(([codes]) => codes.includes(code));
  return match ? match[1] : "—";
}

export function dowShort(dateStr) {
  return parseDate(dateStr).toLocaleDateString("en-US", { weekday: "short" });
}

const ENTITY_MAP = {
  "&mdash;": "—", "&ndash;": "–", "&amp;": "&", "&hellip;": "…",
  "&middot;": "·", "&Uuml;": "Ü", "&minus;": "−", "&#9992;": "✈",
  "&quot;": '"', "&#39;": "'", "&lt;": "<", "&gt;": ">",
};

export function decodeEntities(str) {
  if (!str) return str;
  return str.replace(/&[a-zA-Z#0-9]+;/g, (m) => ENTITY_MAP[m] || m);
}
