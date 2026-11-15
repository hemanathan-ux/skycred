/* ============================================================
   SkyCred · app.js
   Search → /api/weather → render card + JSON panel.
   No frameworks, no build step, no API key in the browser.
   ============================================================ */

"use strict";

/* ---------------- Constants ---------------- */

const POPULAR_CITIES = [
  "Delhi",
  "Mumbai",
  "Bengaluru",
  "Chennai",
  "Kolkata",
  "London",
  "New York",
  "Tokyo",
  "Dubai",
  "Singapore",
];

const DEFAULT_CITY = "Mumbai"; // FR-10: Mumbai loads automatically on launch
const REQUEST_TIMEOUT_MS = 10000;
const STORAGE_KEY = "skycred:lastCity";

/* WeatherAPI condition code sets (from the official conditions list) */
const THUNDER_CODES = new Set([1087, 1273, 1276, 1279, 1282]);
const RAIN_CODES = new Set([
  1063, 1150, 1153, 1168, 1171, 1180, 1183, 1186, 1189, 1192, 1195, 1198,
  1201, 1240, 1243, 1246,
]);
const SNOW_CODES = new Set([
  1066, 1069, 1072, 1114, 1117, 1204, 1207, 1210, 1213, 1216, 1219, 1222,
  1225, 1237, 1249, 1252, 1255, 1258, 1261, 1264,
]);
/* Fog, mist, haze, smoke, dust and sand storms all reduce visibility */
const FOG_CODES = new Set([
  1012, 1015, 1018, 1021, 1024, 1027, 1030, 1033, 1036, 1039, 1042, 1045,
  1048, 1135, 1147,
]);
const CLOUD_CODES = new Set([1006, 1009]);
const PARTLY_CLOUDY_CODE = 1003;
const CLEAR_CODE = 1000;

/* ---------------- DOM handles ---------------- */

const el = {
  form: document.getElementById("search-form"),
  input: document.getElementById("city-input"),
  searchBtn: document.getElementById("search-btn"),
  searchMessage: document.getElementById("search-message"),
  chips: document.getElementById("chips"),
  emptyState: document.getElementById("empty-state"),
  skeleton: document.getElementById("skeleton"),
  errorState: document.getElementById("error-state"),
  errorTitle: document.getElementById("error-title"),
  errorDetail: document.getElementById("error-detail"),
  weatherCard: document.getElementById("weather-card"),
  weatherIcon: document.getElementById("weather-icon"),
  conditionText: document.getElementById("condition-text"),
  cityName: document.getElementById("city-name"),
  regionLine: document.getElementById("region-line"),
  localTime: document.getElementById("local-time"),
  tempValue: document.getElementById("temp-value"),
  feelsValue: document.getElementById("feels-value"),
  quirkySummary: document.getElementById("quirky-summary"),
  humidityValue: document.getElementById("humidity-value"),
  windValue: document.getElementById("wind-value"),
  uvValue: document.getElementById("uv-value"),
  uvLevel: document.getElementById("uv-level"),
  jsonPlaceholder: document.getElementById("json-placeholder"),
  jsonOutput: document.getElementById("json-output"),
  toggleFormatted: document.getElementById("toggle-formatted"),
  toggleRaw: document.getElementById("toggle-raw"),
  copyBtn: document.getElementById("copy-btn"),
};

/* ---------------- App state ---------------- */

let currentCity = null;      // city whose weather is on screen
let currentRawText = "";     // unmodified response text (Raw view)
let currentJsonText = "";    // pretty-printed text (Formatted view)
let activeView = "formatted";
let controller = null;       // AbortController for the in-flight request
let copyTimer = null;

/* ============================================================
   Boot
   ============================================================ */

buildChips();
bindEvents();

// Priority: ?city= URL param → last saved city → default (Mumbai).
const urlCity = new URLSearchParams(location.search).get("city");
const savedCity = readSavedCity();
const initialCity = (urlCity || "").trim().slice(0, 100) || savedCity || DEFAULT_CITY;
el.input.value = initialCity;
fetchWeather(initialCity);

/* ============================================================
   Events
   ============================================================ */

function bindEvents() {
  el.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const city = el.input.value.trim().slice(0, 100);
    if (!city) {
      showSearchMessage("Enter a city name");
      return;
    }
    fetchWeather(city);
  });

  el.toggleFormatted.addEventListener("click", () => setJsonView("formatted"));
  el.toggleRaw.addEventListener("click", () => setJsonView("raw"));
  el.copyBtn.addEventListener("click", copyVisibleJson);
}

/* ============================================================
   Popular city chips (FR-3)
   ============================================================ */

function buildChips() {
  POPULAR_CITIES.forEach((city) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = city;
    chip.dataset.city = city;
    chip.setAttribute("aria-pressed", "false");
    chip.addEventListener("click", () => {
      el.input.value = city;
      fetchWeather(city);
    });
    el.chips.appendChild(chip);
  });
}

function updateChipSelection(city) {
  const normalized = (city || "").toLowerCase();
  el.chips.querySelectorAll(".chip").forEach((chip) => {
    const selected = chip.dataset.city.toLowerCase() === normalized;
    chip.setAttribute("aria-pressed", selected ? "true" : "false");
  });
}

/* ============================================================
   Fetch + state machine (FR-2, FR-13, FR-14)
   ============================================================ */

async function fetchWeather(city) {
  // Cancel any in-flight request so only the latest result wins.
  if (controller) controller.abort();
  controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  setLoading(true);
  showSearchMessage("", false);

  try {
    const response = await fetch(`/api/weather?q=${encodeURIComponent(city)}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    const rawText = await response.text();

    if (!response.ok) {
      throw buildApiError(response.status, rawText);
    }

    const data = JSON.parse(rawText);
    renderSuccess(city, data, rawText);
  } catch (err) {
    if (err && err.name === "AbortError" && controller && controller.signal.aborted) {
      // Superseded by a newer search, or the 10 s timeout fired.
      if (!currentCity) showError("Still trying…", "The weather service is slow to respond. Check your connection and retry.");
      return;
    }
    renderError(err);
  } finally {
    clearTimeout(timeoutId);
    setLoading(false);
  }
}

function buildApiError(status, rawText) {
  const error = new Error(`API error ${status}`);
  error.status = status;
  try {
    const parsed = JSON.parse(rawText);
    if (parsed && parsed.error) error.apiCode = parsed.error.code;
  } catch {
    /* body wasn't JSON — status mapping below still applies */
  }
  return error;
}

function renderSuccess(city, data, rawText) {
  currentCity = city;
  currentRawText = rawText;
  currentJsonText = JSON.stringify(data, null, 2);

  renderCard(data);
  renderJsonPanel();
  updateChipSelection(data && data.location ? data.location.name : city);
  saveLastCity(city);

  // Shareable link (FR-17): update the URL without reloading.
  const url = new URL(location.href);
  url.searchParams.set("city", city);
  history.replaceState(null, "", url);
}

function renderError(err) {
  const status = err && err.status;

  if (status === 404 || err.apiCode === 1006) {
    showSearchMessage("City not found. Try another one.");
    showError(
      "City not found",
      "We couldn't find that city. Check the spelling or try a larger city nearby."
    );
  } else if (status === 429) {
    showSearchMessage("Too many requests right now. Please try again shortly.");
    showError(
      "Too many requests",
      "The weather service is rate-limiting us right now. Please try again shortly."
    );
  } else if (status === 400) {
    showSearchMessage("Enter a city name");
    showError("Enter a city name", "Type a city into the search bar and try again.");
  } else if (err && err.name === "AbortError") {
    showSearchMessage("Can't reach the weather service. Check your connection and retry.");
    showError(
      "Request timed out",
      "Can't reach the weather service. Check your connection and retry."
    );
  } else {
    showSearchMessage("Something went wrong. Please try again.");
    showError(
      "Something went wrong",
      "We couldn't load the weather right now. Please try again in a moment."
    );
  }
}

/* ============================================================
   UI state helpers
   ============================================================ */

function setLoading(loading) {
  el.searchBtn.disabled = loading;
  el.input.disabled = loading;
  el.chips.querySelectorAll(".chip").forEach((chip) => (chip.disabled = loading));

  if (loading) {
    show(el.skeleton);
    hide(el.weatherCard, el.errorState, el.emptyState);
  }
}

function showError(title, detail) {
  el.errorTitle.textContent = title;
  el.errorDetail.textContent = detail;
  show(el.errorState);
  hide(el.weatherCard, el.emptyState, el.skeleton);
}

function showSearchMessage(text, isError = true) {
  el.searchMessage.textContent = text;
  el.searchMessage.classList.toggle("ok", !!text && !isError);
}

/* ============================================================
   Weather card rendering (FR-4 to FR-9)
   ============================================================ */

function renderCard(data) {
  const loc = data.location || {};
  const cur = data.current || {};
  const condition = cur.condition || {};

  const city = loc.name || currentCity || "—";
  el.cityName.textContent = city;
  el.cityName.title = city;

  const regionBits = [loc.region, loc.country].filter(Boolean);
  el.regionLine.textContent = regionBits.length ? regionBits.join(", ") : "--";

  el.localTime.textContent =
    `${formatLocalTime(loc.localtime) || "--"} · ${loc.tz_id || "--"}`;

  const conditionText = condition.text || "--";
  el.conditionText.textContent = conditionText;

  const icon = pickIcon(condition.code, cur.is_day);
  el.weatherIcon.textContent = icon;
  const iconAlt = `${conditionText}${cur.is_day === 0 ? ", night" : ""}`;
  el.weatherIcon.setAttribute("aria-label", iconAlt);
  el.weatherIcon.title = iconAlt;

  el.tempValue.textContent = round(cur.temp_c);
  el.feelsValue.textContent = round(cur.feelslike_c);

  el.quirkySummary.textContent = buildQuirkySummary(cur);

  el.humidityValue.textContent = round(cur.humidity);
  el.windValue.textContent = round(cur.wind_kph);
  el.uvValue.textContent = cur.uv === undefined || cur.uv === null ? "--" : cur.uv;
  el.uvLevel.textContent = cur.uv === undefined || cur.uv === null ? "—" : uvLevelWord(cur.uv);

  hide(el.emptyState, el.errorState, el.skeleton);
  show(el.weatherCard);
  el.jsonPlaceholder.hidden = true;
  el.jsonOutput.hidden = false;
}

/* Display values exactly as returned, with rounding for display only. */
function round(value) {
  if (value === undefined || value === null || value === "" || Number.isNaN(value)) return "--";
  const num = Number(value);
  return Number.isNaN(num) ? "--" : String(Math.round(num));
}

function formatLocalTime(localtime) {
  if (!localtime || typeof localtime !== "string") return "";
  // WeatherAPI localtime looks like "2026-11-15 15:42"
  const timePart = localtime.split(" ")[1];
  if (!timePart) return localtime;
  const [hh, mm] = timePart.split(":");
  const hours = Number(hh);
  if (Number.isNaN(hours)) return timePart;
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHour}:${mm || "00"} ${suffix}`;
}

function uvLevelWord(uv) {
  const value = Number(uv);
  if (Number.isNaN(value)) return "—";
  if (value < 3) return "Low";
  if (value < 6) return "Moderate";
  if (value < 8) return "High";
  if (value < 11) return "Very High";
  return "Extreme";
}

/* Condition code + is_day → emoji icon, with a safe fallback (FR-4). */
function pickIcon(code, isDay) {
  if (THUNDER_CODES.has(code)) return "⛈️";
  if (RAIN_CODES.has(code)) return "🌧️";
  if (SNOW_CODES.has(code)) return "❄️";
  if (FOG_CODES.has(code)) return "🌫️";
  if (code === CLEAR_CODE) return isDay === 0 ? "🌙" : "☀️";
  if (code === PARTLY_CLOUDY_CODE) return isDay === 0 ? "☁️" : "🌤️";
  if (CLOUD_CODES.has(code)) return "☁️";
  return "🌤️"; // default icon if the code is unmapped
}

/* ============================================================
   Quirky summary (FR-8) — first match wins, top to bottom
   ============================================================ */

function buildQuirkySummary(cur) {
  const text = String((cur.condition && cur.condition.text) || "").toLowerCase();
  const temp = Number(cur.temp_c);
  const wind = Number(cur.wind_kph);
  const uv = Number(cur.uv);
  const isNight = cur.is_day === 0;
  const has = (...words) => words.some((w) => text.includes(w));

  if (has("thunder")) return "⛈️ Thunder's showing off. Stay indoors.";
  if (has("rain", "drizzle", "shower")) return "☂️ Time to carry an umbrella";
  if (has("snow", "sleet", "blizzard")) return "❄️ Freeze Frame. Layer up, snow day vibes.";
  if (has("fog", "mist", "haze")) return "🌫️ Visibility: mysterious. Drive slow.";
  if (!Number.isNaN(temp) && temp >= 38) return "🔥 Hot enough to fry an egg. Hydrate.";
  if (!Number.isNaN(temp) && temp <= 0) return "🥶 Freeze Frame. Even your breath is frosty.";
  if (!isNight && !Number.isNaN(uv) && uv >= 6) return "😎 Don't forget sunglasses and sunscreen";
  if (!Number.isNaN(wind) && wind >= 30) return "💨 Hold onto your hat. It's breezy out there.";
  if (has("clear", "sunny") && !isNight) return "🌞 Perfect day to be outside";
  if (has("clear", "sunny") && isNight) return "🌙 Clear skies. Great night for a walk.";
  if (has("cloud", "overcast")) return "☁️ Cloud cover on. Mood: mellow.";
  return "🌤️ Weather's doing its thing.";
}

/* ============================================================
   API response panel (FR-10, FR-11)
   ============================================================ */

function renderJsonPanel() {
  setJsonView(activeView);
}

function setJsonView(view) {
  activeView = view;

  const isFormatted = view === "formatted";
  el.toggleFormatted.classList.toggle("is-active", isFormatted);
  el.toggleRaw.classList.toggle("is-active", !isFormatted);
  el.toggleFormatted.setAttribute("aria-pressed", String(isFormatted));
  el.toggleRaw.setAttribute("aria-pressed", String(!isFormatted));

  if (!currentCity) return;

  el.jsonPlaceholder.hidden = true;
  el.jsonOutput.hidden = false;

  if (isFormatted) {
    // Indented + syntax highlighted.
    el.jsonOutput.innerHTML = highlightJson(currentJsonText);
  } else {
    // Unmodified response text, inserted as text (never HTML).
    el.jsonOutput.textContent = currentRawText;
  }
}

/* Tiny JSON syntax highlighter — escapes first, then decorates tokens. */
function highlightJson(json) {
  const escaped = json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return escaped.replace(
    /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let cls = "tok-num";
      if (match.startsWith('"')) {
        cls = match.trimEnd().endsWith(":") ? "tok-key" : "tok-str";
      } else if (match === "true" || match === "false") {
        cls = "tok-bool";
      } else if (match === "null") {
        cls = "tok-null";
      }
      return `<span class="${cls}">${match}</span>`;
    }
  );
}

/* Copy the visible view; "Copied" state for 2 s; graceful fallback. */
async function copyVisibleJson() {
  if (!currentCity) return;

  const text = activeView === "formatted" ? currentJsonText : currentRawText;
  let copied = false;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch {
    copied = false; // permission denied or unsupported — fall through
  }

  if (!copied) {
    // Fallback: select the text in the <pre> so the user can copy manually.
    copied = legacyCopy(text);
  }

  const button = el.copyBtn;
  if (copied) {
    button.textContent = "Copied";
    button.classList.add("is-copied");
  } else {
    button.textContent = "Copy";
    button.classList.remove("is-copied");
    el.jsonOutput.focus();
    showSearchMessage("Couldn't copy. Select the text and copy manually.");
    return;
  }

  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    button.textContent = "Copy";
    button.classList.remove("is-copied");
  }, 2000);
}

function legacyCopy(text) {
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/* ============================================================
   Last-city memory (FR-16) — failures are ignored silently
   ============================================================ */

function saveLastCity(city) {
  try {
    localStorage.setItem(STORAGE_KEY, city);
  } catch {
    /* storage blocked or unavailable — silently ignore */
  }
}

function readSavedCity() {
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

/* ---------------- Tiny visibility helpers ---------------- */

function show(...nodes) {
  nodes.forEach((node) => (node.hidden = false));
}

function hide(...nodes) {
  nodes.forEach((node) => (node.hidden = true));
}
