// Fetch wrapper with retry/backoff and a simple rate limiter. Node 20+ has
// global fetch — no dependency needed.

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a rate limiter that allows at most `maxPerSecond` calls/sec.
 * Call `await limiter()` before each request.
 */
export function createRateLimiter(maxPerSecond) {
  const intervalMs = 1000 / maxPerSecond;
  let lastCall = 0;
  return async function limiter() {
    const now = Date.now();
    const wait = lastCall + intervalMs - now;
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
  };
}

/**
 * Fetch JSON with retry + exponential backoff on 429/5xx. Throws on
 * exhausted retries or non-retryable errors (4xx other than 429).
 */
export async function fetchJsonWithRetry(url, options = {}, { retries = 3, baseDelayMs = 1000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res.json();

      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`HTTP ${res.status} from ${url}`);
        const delay = baseDelayMs * Math.pow(2, attempt);
        await sleep(delay);
        continue;
      }

      // non-retryable 4xx
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} from ${url}: ${body.slice(0, 300)}`);
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await sleep(baseDelayMs * Math.pow(2, attempt));
      }
    }
  }
  throw lastError;
}
