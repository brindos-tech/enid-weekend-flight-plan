#!/usr/bin/env node
// LOCAL, MANUAL, ONE-SHOT helper. Never run in CI.
//
// Spotify refresh tokens now expire 6 months after the original
// authorization (effective 2026-07-20) and refreshing the access token does
// NOT extend that clock. Budget for running this roughly every 6 months —
// put a reminder on your calendar, because nothing in CI can do this step
// for you: it requires a real browser login.
//
// Usage:
//   SPOTIFY_CLIENT_ID=... SPOTIFY_CLIENT_SECRET=... node scripts/spotify-auth.js
//
// This opens (or prints) an authorization URL, spins up a localhost
// listener to catch the redirect, exchanges the code for tokens, and prints
// the refresh token to paste into the SPOTIFY_REFRESH_TOKEN repo secret at
// https://github.com/<owner>/<repo>/settings/secrets/actions

import http from "node:http";
import { randomBytes } from "node:crypto";

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const PORT = 8734;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = "user-top-read";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in your environment first.");
  process.exit(1);
}

const state = randomBytes(16).toString("hex");
const authUrl =
  `https://accounts.spotify.com/authorize?` +
  new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
  });

console.log("\nOpen this URL in a browser you're logged into Spotify with:\n");
console.log(authUrl);
console.log(`\nWaiting for the redirect on ${REDIRECT_URI} ...\n`);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname !== "/callback") {
    res.writeHead(404);
    res.end();
    return;
  }

  const returnedState = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error || returnedState !== state || !code) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Auth failed or state mismatch. Check the terminal and try again.");
    server.close();
    process.exit(1);
  }

  try {
    const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });
    const tokens = await tokenRes.json();

    if (!tokenRes.ok) {
      throw new Error(`Token exchange failed: ${JSON.stringify(tokens)}`);
    }

    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Done — check your terminal. You can close this tab.");

    console.log("\nSuccess. New refresh token (valid ~6 months from now):\n");
    console.log(tokens.refresh_token);
    console.log("\nUpdate the SPOTIFY_REFRESH_TOKEN repo secret with this value, then re-run the failed workflow.\n");
  } catch (err) {
    console.error(err);
  } finally {
    server.close();
    process.exit(0);
  }
});

server.listen(PORT);
