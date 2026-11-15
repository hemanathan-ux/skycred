/**
 * SkyCred serverless function · GET /api/weather?q=<city>
 *
 * The ONLY place that knows WEATHER_API_KEY. The browser never sees it.
 *
 * Response contract (mirrors the PRD):
 *   200        → WeatherAPI JSON, returned unchanged
 *   400        → q missing or empty (WeatherAPI code 1003)
 *   404        → no matching location (WeatherAPI code 1006)
 *   429        → quota exceeded / rate limited (WeatherAPI codes 2008/2009)
 *   500 / 502  → missing key, invalid key, or upstream failure
 */

const WEATHER_API_BASE = "https://api.weatherapi.com/v1/current.json";
const MAX_QUERY_LENGTH = 100;
const UPSTREAM_TIMEOUT_MS = 8000;

module.exports = async (req, res) => {
  // Light edge/browser caching keeps repeat lookups of popular cities off the quota.
  res.setHeader("Cache-Control", "public, max-age=600, s-maxage=600");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      error: { code: 405, message: "Method not allowed. Use GET." },
    });
  }

  // The key lives only in the Vercel environment — never shipped, never logged.
  const apiKey = process.env.WEATHER_API_KEY;
  if (!apiKey) {
    console.error("[api/weather] WEATHER_API_KEY is not configured in the environment");
    return res.status(500).json({
      error: { code: "SERVER_CONFIG", message: "Something went wrong" },
    });
  }

  // Validate, trim and cap the city query before it reaches the upstream API.
  const rawQ = Array.isArray(req.query.q) ? req.query.q[0] : req.query.q;
  const q = (rawQ ?? "").toString().trim().slice(0, MAX_QUERY_LENGTH);
  if (!q) {
    return res.status(400).json({
      error: { code: 1003, message: 'Query parameter "q" is required' },
    });
  }

  const url =
    `${WEATHER_API_BASE}` +
    `?key=${encodeURIComponent(apiKey)}` +
    `&q=${encodeURIComponent(q)}` +
    `&aqi=no`;

  let upstream;
  try {
    upstream = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  } catch (err) {
    console.error(`[api/weather] upstream fetch failed for q="${q}":`, err);
    return res.status(502).json({
      error: { code: "UPSTREAM_FAILURE", message: "Weather service unavailable" },
    });
  }

  const bodyText = await upstream.text();

  // Success → hand WeatherAPI's JSON through unchanged.
  if (upstream.ok) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(200).send(bodyText);
  }

  // Translate WeatherAPI errors into the PRD's status contract.
  let apiCode;
  let apiMessage;
  try {
    const parsed = JSON.parse(bodyText);
    apiCode = parsed && parsed.error && parsed.error.code;
    apiMessage = parsed && parsed.error && parsed.error.message;
  } catch {
    // Non-JSON upstream body — fall through to the generic mapping.
  }

  console.error(
    `[api/weather] upstream error for q="${q}": HTTP ${upstream.status}, code ${apiCode ?? "unknown"}${apiMessage ? ` — ${apiMessage}` : ""}`
  );

  if (apiCode === 1003) {
    return res
      .status(400)
      .json({ error: { code: 1003, message: "City query is required" } });
  }
  if (apiCode === 1006) {
    return res
      .status(404)
      .json({ error: { code: 1006, message: "City not found" } });
  }
  if (upstream.status === 429 || apiCode === 2008 || apiCode === 2009) {
    return res.status(429).json({
      error: { code: "RATE_LIMITED", message: "Too many requests right now" },
    });
  }
  // Invalid/disabled key (2006/2007) and anything else → generic failure.
  // The real cause stays in the Vercel logs; the user gets a safe message.
  return res.status(502).json({
    error: { code: "UPSTREAM_FAILURE", message: "Something went wrong" },
  });
};
