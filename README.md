# SkyCred ⛅

Clean, current weather for any city in one search or one tap — wrapped in a premium, CRED-inspired interface. Plain HTML/CSS/JS frontend + one Vercel serverless function. No database, no login, no frameworks.

## Features (v1.0)

- **City search** — type a city, hit Enter or the button (input trimmed, empty input shows a hint)
- **10 popular city chips** — Delhi, Mumbai, Bengaluru, Chennai, Kolkata, London, New York, Tokyo, Dubai, Singapore; tapping loads weather and highlights the chip
- **Weather card** — condition icon (day/night aware), city + region + country, local time + time zone, temperature, feels-like, humidity / wind / UV stat tiles with UV level word
- **Quirky summary** — one fun, priority-ordered line (thunder → rain → snow → fog → heat → freeze → UV → wind → clear → clouds → default)
- **API response panel** — Formatted (indented + syntax highlighted) and Raw JSON views with a toggle, plus a Copy button with a 2-second "Copied" state and a fallback
- **States** — friendly empty state, skeleton loading (controls disabled), clear error messages for not-found / rate-limit / network / server failures
- **Responsive** — two-column on desktop, single column on mobile, from 320 px up
- **Nice extras** — remembers your last city via `localStorage`, shareable `?city=` links, `prefers-reduced-motion` support, keyboard-friendly with visible focus rings and `aria-live` messages

On first launch the app fetches **Mumbai** automatically (per the WeatherAPI integration requirement). After that, `?city=` beats the saved city, which beats Mumbai.

## Project structure

```
skycred/
├── index.html        # single page (markup, a11y, no JS-inlined content)
├── style.css         # dark, tactile, CRED-inspired styling
├── app.js            # search, rendering, quirky summary, JSON panel
├── api/
│   └── weather.js    # Vercel serverless function (holds the API key)
├── .env              # local env vars (gitignored — never commit real keys)
├── .env.example      # template
└── vercel.json       # deploy config
```

## Setup (local)

1. Get a free API key at [weatherapi.com](https://www.weatherapi.com/).
2. Copy `.env.example` to `.env` and fill in your key:

   ```
   WEATHER_API_KEY=your_key_here
   ```

3. Serve the folder with a static server that supports the function locally, e.g. the Vercel CLI:

   ```
   npx vercel dev
   ```

   Then open the printed localhost URL.

> Note: opening `index.html` directly from disk (file://) won't work — the page needs to reach `/api/weather` over HTTP.

## Deployment (Vercel)

1. Push this repo to GitHub.
2. Import it on [vercel.com](https://vercel.com) (framework preset: **Other** — no build step).
3. Add the environment variable:

   | Name | Value | Environments |
   |---|---|---|
   | `WEATHER_API_KEY` | your WeatherAPI.com key | Production, Preview, Development |

4. Deploy. The function is auto-detected from `api/weather.js`.

## API contract

```
GET /api/weather?q=<CityName>
   → 200  WeatherAPI JSON, unchanged
   → 400  q missing or empty        (WeatherAPI code 1003)
   → 404  no matching location      (WeatherAPI code 1006)
   → 429  quota / rate limited      (WeatherAPI codes 2008 / 2009)
   → 500 / 502  key problems or upstream failure
```

The browser only ever talks to `/api/weather` (same-origin, no CORS needed). The key lives solely in the Vercel environment variable and never reaches the client. Responses are cached for 10 minutes to protect the free-tier quota.

## Data source

[WeatherAPI.com](https://www.weatherapi.com/) — `/v1/current.json` endpoint. Fields used: `location.name/region/country/localtime/tz_id`, `current.temp_c`, `feelslike_c`, `condition.text/code`, `is_day`, `humidity`, `wind_kph`, `uv`.
