#!/usr/bin/env node
// 16-day outlook per place via Open-Meteo (free, no API key). Written to
// data/generated/weather.json, keyed by placeId. Used for the seasonal-risk
// note on Nov-Dec legs (icing, winter conditions) — advisory only, never a
// substitute for a real briefing.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fetchJsonWithRetry, createRateLimiter } from "./lib/http.js";

const CURATED_DIR = path.resolve("data/curated");
const GENERATED_DIR = path.resolve("data/generated");
const limiter = createRateLimiter(5);

async function fetchForecast(place) {
  await limiter();
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode` +
    `&temperature_unit=fahrenheit&forecast_days=16&timezone=auto`;
  try {
    const data = await fetchJsonWithRetry(url);
    return {
      updatedAt: new Date().toISOString(),
      dates: data.daily?.time || [],
      tempMax: data.daily?.temperature_2m_max || [],
      tempMin: data.daily?.temperature_2m_min || [],
      precipProbability: data.daily?.precipitation_probability_max || [],
      weatherCode: data.daily?.weathercode || [],
    };
  } catch (err) {
    console.warn(`Weather fetch failed for ${place.id}: ${err.message}`);
    return null;
  }
}

async function main() {
  const places = JSON.parse(await readFile(path.join(CURATED_DIR, "places.json"), "utf-8"));
  const result = {};

  for (const place of places) {
    const forecast = await fetchForecast(place);
    if (forecast) result[place.id] = forecast;
  }

  await mkdir(GENERATED_DIR, { recursive: true });
  await writeFile(path.join(GENERATED_DIR, "weather.json"), JSON.stringify(result, null, 2));
  console.log(`Wrote weather for ${Object.keys(result).length}/${places.length} places.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
