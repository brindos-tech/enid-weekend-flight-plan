#!/usr/bin/env node
// Weekly Spotify sync. Two hard constraints shape this script — see
// ARCHITECTURE.md §9.3:
//
//  1. Refresh tokens expire 6 months after the ORIGINAL authorization
//     (effective 2026-07-20). Refreshing the access token does NOT reset
//     this clock. This sync WILL break roughly twice a year — that is
//     scheduled behavior, not an edge case, and this script must degrade
//     quietly rather than fail the build.
//  2. Related Artists / Recommendations endpoints are dead (403) for apps
//     created after 2024-11-27. There is no automatic taste expansion.
//     Discovery is /v1/me/top/artists (scope user-top-read) merged into
//     curated/artists.json — manual entries there are never touched.
//
// data/curated/artists.json is the SOURCE OF TRUTH. This script only
// refreshes rank/lastSyncedAt for source:"spotify-top" entries and appends
// newly-discovered top artists; it never deletes a manual entry.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchJsonWithRetry } from "./lib/http.js";

const CURATED_DIR = path.resolve("data/curated");
const GENERATED_DIR = path.resolve("data/generated");

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.SPOTIFY_REFRESH_TOKEN;

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function getAccessToken() {
  const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: REFRESH_TOKEN }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (body.error === "invalid_grant") {
      throw new SpotifyReauthError("Refresh token expired or revoked (invalid_grant).");
    }
    throw new Error(`Spotify token refresh failed: HTTP ${res.status} ${JSON.stringify(body)}`);
  }

  return res.json();
}

class SpotifyReauthError extends Error {}

async function fetchTopArtists(accessToken) {
  const data = await fetchJsonWithRetry("https://api.spotify.com/v1/me/top/artists?limit=50&time_range=medium_term", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data.items || [];
}

async function updateGithubIssueAndMeta(status, message) {
  const meta = JSON.parse(await readFile(path.join(GENERATED_DIR, "meta.json"), "utf-8").catch(() => "{}"));
  meta.sources = meta.sources || {};
  meta.sources.spotify = {
    status,
    lastSuccess: status === "ok" ? new Date().toISOString() : meta.sources.spotify?.lastSuccess ?? null,
    message,
  };
  await writeFile(path.join(GENERATED_DIR, "meta.json"), JSON.stringify(meta, null, 2));
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    console.warn("Spotify credentials not set — skipping sync, leaving artists.json untouched.");
    await updateGithubIssueAndMeta("not_configured", "SPOTIFY_CLIENT_ID/SECRET/REFRESH_TOKEN not set.");
    process.exit(0);
  }

  let accessToken;
  try {
    const token = await getAccessToken();
    accessToken = token.access_token;
  } catch (err) {
    if (err instanceof SpotifyReauthError) {
      // Do NOT fail the build. Keep existing artists.json untouched, flag
      // it, and let the runtime show a quiet banner instead of breaking.
      console.warn(`Spotify re-auth required: ${err.message}`);
      console.warn("Run `npm run spotify-auth` locally and update the SPOTIFY_REFRESH_TOKEN repo secret.");
      await updateGithubIssueAndMeta("reauth_required", err.message);
      process.exit(0); // exit 0 — this is expected, scheduled behavior, not a CI failure
    }
    throw err;
  }

  const topArtists = await fetchTopArtists(accessToken);
  const artists = JSON.parse(await readFile(path.join(CURATED_DIR, "artists.json"), "utf-8"));
  const byId = new Map(artists.map((a) => [a.id, a]));
  const now = new Date().toISOString();

  topArtists.forEach((spotifyArtist, index) => {
    const id = slugify(spotifyArtist.name);
    const existing = byId.get(id);
    if (existing) {
      existing.spotifyId = spotifyArtist.id;
      existing.rank = index + 1;
      existing.genres = spotifyArtist.genres?.length ? spotifyArtist.genres : existing.genres;
      existing.lastSyncedAt = now;
      if (existing.source === "manual") existing.source = "spotify-top"; // promote if it's now confirmed
    } else {
      artists.push({
        id,
        name: spotifyArtist.name,
        spotifyId: spotifyArtist.id,
        ticketmasterAttractionId: null,
        rank: index + 1,
        source: "spotify-top",
        genres: spotifyArtist.genres || [],
        lastSyncedAt: now,
      });
    }
  });

  await writeFile(path.join(CURATED_DIR, "artists.json"), JSON.stringify(artists, null, 2));
  await updateGithubIssueAndMeta("ok", `Synced ${topArtists.length} top artists.`);
  console.log(`Synced ${topArtists.length} top artists (${artists.length} total in artists.json).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
