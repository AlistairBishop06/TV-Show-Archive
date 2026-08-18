import crypto from "node:crypto";
import { promisify } from "node:util";
import express from "express";
import { neon } from "@neondatabase/serverless";
import * as cheerio from "cheerio";

const DATABASE_URL = process.env.DATABASE_URL;
const PORT = 3000; // Local development only; Vercel supplies its own runtime.
const SESSION_DAYS = 30;
const MAX_WATCH_HISTORY = 40;
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_ATTEMPTS = 20;

if (!DATABASE_URL) {
  throw new Error("Missing DATABASE_URL. Add DATABASE_URL in Vercel Project Settings → Environment Variables.");
}

const sql = neon(DATABASE_URL);
const scryptAsync = promisify(crypto.scrypt);
const app = express();
const authAttempts = new Map();
const liveSportsScheduleCache = new Map();
const LIVE_SPORTS_SCHEDULE_CACHE_MS = 10 * 60 * 1000;
const DLSTREAMS_PUBLIC_SCHEDULE_URLS = [
  "https://dlstreams.com/",
  "https://dlhd.st/",
  "https://dlstreams.st/",
  "https://dlhd.dad/"
];

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

// IMPORTANT: for a project Pages URL such as
// https://YOUR_GITHUB_USERNAME.github.io/TV-Show-Archive/
// the browser Origin is only https://YOUR_GITHUB_USERNAME.github.io (no repo path).
const GITHUB_PAGES_ORIGIN = "https://alistairbishop06.github.io";

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (origin === GITHUB_PAGES_ORIGIN) return true;
  try {
    const url = new URL(origin);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

app.use((req, res, next) => {
  const origin = req.get("origin");

  if (origin && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  }

  if (req.method === "OPTIONS") {
    if (!isAllowedOrigin(origin)) return res.status(403).end();
    return res.status(204).end();
  }

  if (origin && !isAllowedOrigin(origin)) {
    return res.status(403).json({ error: "Origin not allowed." });
  }

  next();
});

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normaliseUsername(value) {
  return cleanText(value, 30).toLowerCase();
}

function validUsername(username) {
  return /^[a-z0-9][a-z0-9._-]{2,29}$/.test(username);
}

function sessionHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(password, salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
  });
  return `scrypt$16384$8$1$${salt.toString("base64")}$${Buffer.from(derived).toString("base64")}`;
}

async function verifyPassword(password, encoded) {
  try {
    const [scheme, n, r, p, saltB64, hashB64] = String(encoded).split("$");
    if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
    const expected = Buffer.from(hashB64, "base64");
    const derived = await scryptAsync(password, Buffer.from(saltB64, "base64"), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024
    });
    const actual = Buffer.from(derived);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

async function createSession(userId) {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = sessionHash(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  await sql`DELETE FROM sessions WHERE expires_at <= now()`;
  await sql`
    INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (${tokenHash}, ${userId}, ${expiresAt})
  `;

  return rawToken;
}

function readBearerToken(req) {
  const value = String(req.get("authorization") || "");
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function authRateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const current = authAttempts.get(key);

  if (!current || now - current.startedAt > AUTH_WINDOW_MS) {
    authAttempts.set(key, { startedAt: now, count: 1 });
    return next();
  }

  if (current.count >= AUTH_MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((AUTH_WINDOW_MS - (now - current.startedAt)) / 1000);
    res.setHeader("Retry-After", String(Math.max(1, retryAfter)));
    return res.status(429).json({ error: "Too many sign-in attempts. Try again shortly." });
  }

  current.count += 1;
  next();
}

async function requireAuth(req, res, next) {
  try {
    await ensureSchemaReady();
    const token = readBearerToken(req);
    if (!token) return res.status(401).json({ error: "Sign in required." });

    const tokenHash = sessionHash(token);
    const rows = await sql`
      SELECT u.id, u.username, s.token_hash
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ${tokenHash}
        AND s.expires_at > now()
      LIMIT 1
    `;

    const row = rows[0];
    if (!row) return res.status(401).json({ error: "Session expired." });

    req.user = {
      id: row.id,
      username: row.username
    };
    req.sessionTokenHash = row.token_hash;
    next();
  } catch (error) {
    next(error);
  }
}

function serialiseUser(user) {
  return {
    id: user.id,
    username: user.username
  };
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nullableInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function normaliseWatchEntry(body) {
  const imdbId = cleanText(body?.imdbId, 64);
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(imdbId)) {
    const error = new Error("Invalid media identifier.");
    error.status = 400;
    throw error;
  }

  const mediaType = body?.mediaType === "movie" ? "movie" : "tv";
  const name = cleanText(body?.name, 250) || "Untitled";
  const lastWatchedMs = finiteNumber(body?.lastWatched, Date.now());
  const lastWatched = new Date(lastWatchedMs > 0 ? lastWatchedMs : Date.now());

  return {
    imdbId,
    mediaType,
    showId: mediaType === "tv" ? nullableInteger(body?.showId) : null,
    name,
    poster: cleanText(body?.poster, 2000),
    backdrop: cleanText(body?.backdrop, 2000),
    summary: cleanText(body?.summary, 8000),
    year: cleanText(body?.year, 32),
    season: mediaType === "tv" ? nullableInteger(body?.season) : null,
    episode: mediaType === "tv" ? nullableInteger(body?.episode) : null,
    episodeName: mediaType === "tv" ? cleanText(body?.episodeName, 300) : "",
    currentTime: Math.max(0, finiteNumber(body?.currentTime, 0)),
    duration: Math.max(0, finiteNumber(body?.duration, 0)),
    lastWatched: Number.isNaN(lastWatched.getTime()) ? new Date().toISOString() : lastWatched.toISOString()
  };
}

async function upsertWatchEntry(userId, entry) {
  await sql`
    INSERT INTO watch_history (
      user_id, imdb_id, media_type, show_id, name, poster, backdrop, summary,
      year, season, episode, episode_name, position_seconds, duration, last_watched
    )
    VALUES (
      ${userId}, ${entry.imdbId}, ${entry.mediaType}, ${entry.showId}, ${entry.name},
      ${entry.poster}, ${entry.backdrop}, ${entry.summary}, ${entry.year}, ${entry.season},
      ${entry.episode}, ${entry.episodeName}, ${entry.currentTime}, ${entry.duration}, ${entry.lastWatched}
    )
    ON CONFLICT (user_id, imdb_id) DO UPDATE SET
      media_type = EXCLUDED.media_type,
      show_id = EXCLUDED.show_id,
      name = EXCLUDED.name,
      poster = EXCLUDED.poster,
      backdrop = EXCLUDED.backdrop,
      summary = EXCLUDED.summary,
      year = EXCLUDED.year,
      season = EXCLUDED.season,
      episode = EXCLUDED.episode,
      episode_name = EXCLUDED.episode_name,
      position_seconds = EXCLUDED.position_seconds,
      duration = EXCLUDED.duration,
      last_watched = EXCLUDED.last_watched,
      updated_at = now()
    WHERE watch_history.last_watched <= EXCLUDED.last_watched
  `;

  await sql`
    DELETE FROM watch_history
    WHERE user_id = ${userId}
      AND imdb_id IN (
        SELECT imdb_id
        FROM watch_history
        WHERE user_id = ${userId}
        ORDER BY last_watched DESC
        OFFSET ${MAX_WATCH_HISTORY}
      )
  `;
}

function watchRowToClient(row) {
  return {
    mediaType: row.media_type,
    imdbId: row.imdb_id,
    showId: row.show_id,
    name: row.name,
    poster: row.poster || "",
    backdrop: row.backdrop || "",
    summary: row.summary || "",
    year: row.year || "",
    season: row.season,
    episode: row.episode,
    episodeName: row.episode_name || "",
    currentTime: finiteNumber(row.position_seconds, 0),
    duration: finiteNumber(row.duration, 0),
    lastWatched: new Date(row.last_watched).getTime()
  };
}

function validGuideDate(value) {
  const text = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function normaliseScheduleChannelId(href) {
  const text = String(href || "");
  if (!text) return "";
  try {
    const url = new URL(text, "https://dlstreams.st");
    const id = url.searchParams.get("id") || url.searchParams.get("channel");
    if (id && /^\d+$/.test(id)) return id;
  } catch {}

  const streamMatch = text.match(/stream-(\d+)\.php/i);
  if (streamMatch) return streamMatch[1];
  return text.match(/(?:^|\D)(\d{1,5})(?:\D|$)/)?.[1] || "";
}

function scheduleDateKey(dayLabel) {
  const match = String(dayLabel || "").match(
    /(\d{1,2})\s*(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i
  );
  if (!match) return "";
  const months = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
  };
  const month = months[match[2].toLowerCase()];
  return `${match[3]}-${String(month).padStart(2, "0")}-${String(Number(match[1])).padStart(2, "0")}`;
}

function scheduleClockValue(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text) continue;
    const match = text.match(/(?:^|\D)([01]?\d|2[0-3]):([0-5]\d)(?:\D|$)/);
    if (match) return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`;
  }
  return "";
}

function addScheduleEvent(days, date, event) {
  if (!date || !event?.time || !event?.title || !Array.isArray(event.channels) || !event.channels.length) return;
  const events = days.get(date) || [];
  events.push(event);
  days.set(date, events);
}

function parseDlstreamsScheduleHtml(html) {
  const $ = cheerio.load(String(html || ""));
  const scheduleRoot = $("div.schedule").first();
  const dayNodes = scheduleRoot.length
    ? scheduleRoot.find("div.schedule__day")
    : $("div.schedule__day");

  if (!dayNodes.length) throw new Error("DLStreams schedule days were not found in the HTML response.");

  const days = new Map();
  dayNodes.each((_dayIndex, dayElement) => {
    const day = $(dayElement);
    const dayLabel = cleanText(
      day.find("div.schedule__dayTitle, .schedule__day-title, [data-schedule-day]").first().text() ||
      day.attr("data-date"),
      180
    );
    const date = scheduleDateKey(dayLabel);
    if (!date) return;

    const categories = day.find("div.schedule__category");
    const categoryNodes = categories.length ? categories.toArray() : [dayElement];

    categoryNodes.forEach(categoryElement => {
      const category = $(categoryElement);
      const categoryName = cleanText(
        category.find(".schedule__catHeader .card__meta, .schedule__catHeader, .schedule__categoryTitle").first().text(),
        160
      ) || "Other";

      category.find("div.schedule__event").each((_eventIndex, eventElement) => {
        const event = $(eventElement);
        const header = event.find(".schedule__eventHeader").first();
        const timeNode = event.find(".schedule__time").first();
        const time = scheduleClockValue(
          timeNode.attr("data-time"),
          timeNode.text(),
          header.attr("data-time"),
          header.text(),
          event.attr("data-time")
        );
        if (!time) return;

        const titleNode = event.find(".schedule__eventTitle").first();
        let title = cleanText(
          titleNode.text() ||
          header.attr("data-title") ||
          event.attr("data-title"),
          500
        );
        if (!title) {
          const headerText = cleanText(header.text(), 700);
          title = cleanText(headerText.replace(time, "").replace(/^\s*[-–—|:]\s*/, ""), 500);
        }
        if (!title) return;

        const channels = [];
        const addLinks = links => {
          links.each((_linkIndex, linkElement) => {
            const link = $(linkElement);
            const channelId = normaliseScheduleChannelId(link.attr("href"));
            const channelName = cleanText(link.attr("title") || link.text(), 200);
            if (!channelId || !channelName) return;
            if (!channels.some(channel => channel.id === channelId)) {
              channels.push({ id: channelId, name: channelName });
            }
          });
        };

        addLinks(event.find("a[href*='id='], a[href*='stream-']"));
        if (!channels.length) return;

        addScheduleEvent(days, date, {
          time,
          title,
          category: categoryName,
          channels
        });
      });
    });
  });

  if (!days.size) throw new Error("No playable DLStreams schedule data was found in the HTML response.");
  return days;
}

function decodeScheduleText(value) {
  const raw = String(value || "");
  if (!raw.includes("&")) return raw;
  return cheerio.load(`<span>${raw}</span>`)("span").text();
}

function readerLineLinks(line) {
  const channels = [];
  const text = String(line || "");
  const markdownLink = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let match;
  while ((match = markdownLink.exec(text))) {
    const id = normaliseScheduleChannelId(match[2]);
    const name = cleanText(decodeScheduleText(match[1]).replace(/\\([\[\]_*])/g, "$1"), 200);
    if (!id || !name) continue;
    if (!channels.some(channel => channel.id === id)) channels.push({ id, name });
  }
  return channels;
}

function cleanReaderLine(line) {
  return decodeScheduleText(String(line || ""))
    .replace(/^\s{0,3}#{1,6}\s*/, "")
    .replace(/^[-*]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isReaderNoiseLine(line) {
  const lower = String(line || "").toLowerCase();
  if (!lower) return true;
  return lower === "schedule" ||
    lower.startsWith("title:") ||
    lower.startsWith("url source:") ||
    lower.startsWith("published time:") ||
    lower.startsWith("markdown content:") ||
    lower.startsWith("search events or channels") ||
    lower === "select" ||
    lower === "all" ||
    lower === "preparing schedule…" ||
    lower === "preparing schedule..." ||
    lower.startsWith("extra schedule") ||
    lower.startsWith("extra ppv") ||
    lower.startsWith("extra backup") ||
    lower.startsWith("extra sd stream");
}

function parseDlstreamsReaderText(payload) {
  const lines = String(payload || "").replace(/\r/g, "").split("\n");
  const days = new Map();
  let currentDate = "";
  let currentCategory = "Other";
  let pendingEvent = null;

  const flushEvent = () => {
    if (pendingEvent && pendingEvent.channels.length) {
      addScheduleEvent(days, currentDate, pendingEvent);
    }
    pendingEvent = null;
  };

  for (const rawLine of lines) {
    const visible = cleanReaderLine(rawLine);
    if (!visible) continue;

    const date = scheduleDateKey(visible);
    if (date && /schedule\s*time|schedule/i.test(visible)) {
      flushEvent();
      currentDate = date;
      currentCategory = "Other";
      continue;
    }
    if (!currentDate) continue;

    const time = scheduleClockValue(visible);
    const eventMatch = visible.match(/^([01]?\d|2[0-3]):([0-5]\d)\s+(.+)$/);
    if (time && eventMatch) {
      flushEvent();
      const title = cleanText(eventMatch[3], 500);
      if (!title) continue;
      pendingEvent = {
        time,
        title,
        category: currentCategory || "Other",
        channels: []
      };
      const sameLineChannels = readerLineLinks(rawLine);
      sameLineChannels.forEach(channel => {
        if (!pendingEvent.channels.some(existing => existing.id === channel.id)) pendingEvent.channels.push(channel);
      });
      continue;
    }

    const links = readerLineLinks(rawLine);
    if (pendingEvent && links.length) {
      links.forEach(channel => {
        if (!pendingEvent.channels.some(existing => existing.id === channel.id)) pendingEvent.channels.push(channel);
      });
      continue;
    }

    if (isReaderNoiseLine(visible)) continue;

    // Category labels on the public page sit between groups of events. Once
    // an event has received its channel links, the next plain line is the next
    // category heading.
    if (pendingEvent?.channels?.length) {
      flushEvent();
    }

    if (!pendingEvent && visible.length <= 120 && !/^https?:\/\//i.test(visible)) {
      currentCategory = cleanText(visible, 160) || "Other";
    }
  }

  flushEvent();
  if (!days.size) throw new Error("No playable schedule entries were found in the public reader response.");
  return days;
}

async function fetchScheduleResponse(url, options = {}) {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(options.timeout || 15000),
    headers: options.headers || {}
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
  return response.text();
}

async function fetchDlstreamsPublicSchedule() {
  const cacheKey = "dlstreams:public-schedule-v3";
  const cached = liveSportsScheduleCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < LIVE_SPORTS_SCHEDULE_CACHE_MS) {
    return cached.days;
  }

  const errors = [];
  const directAttempts = DLSTREAMS_PUBLIC_SCHEDULE_URLS.map(async url => {
    try {
      const payload = await fetchScheduleResponse(url, {
        timeout: 5500,
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-GB,en;q=0.9",
          Referer: url,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
        }
      });
      return parseDlstreamsScheduleHtml(payload);
    } catch (error) {
      errors.push(`direct ${url}: ${error?.message || error}`);
      throw error;
    }
  });

  // Reader is kept as one parallel fallback, never as a long sequential chain.
  // This means a blocked upstream can no longer hold a Vercel function open for
  // tens of seconds. The first parseable response wins.
  const readerAttempt = (async () => {
    const target = "https://dlstreams.com/";
    try {
      const payload = await fetchScheduleResponse(`https://r.jina.ai/${target}`, {
        timeout: 6500,
        headers: {
          Accept: "text/plain,text/markdown;q=0.9,*/*;q=0.8",
          "X-No-Cache": "true",
          "X-Timeout": "4"
        }
      });
      return parseDlstreamsReaderText(payload);
    } catch (error) {
      errors.push(`reader ${target}: ${error?.message || error}`);
      throw error;
    }
  })();

  try {
    const days = await Promise.any([...directAttempts, readerAttempt]);
    liveSportsScheduleCache.set(cacheKey, { savedAt: Date.now(), days });
    return days;
  } catch {
    // If a warm Vercel instance has an older successful copy, use it rather than
    // showing an empty sports page during a temporary upstream outage.
    if (cached?.days?.size) return cached.days;
    console.error("Live sports schedule sources failed", errors);
    const error = new Error("The live sports schedule source did not respond in time.");
    error.status = 504;
    throw error;
  }
}

function liveScheduleEventsForDate(days, date, allowedIds = null) {
  const requested = days.get(date) || [];
  const allowed = allowedIds?.size ? allowedIds : null;
  const seen = new Set();

  return requested
    .map(event => {
      const channels = (event.channels || []).filter(channel => !allowed || allowed.has(String(channel.id)));
      if (!channels.length) return null;
      return {
        time: event.time,
        title: event.title,
        category: event.category || "Other",
        channels
      };
    })
    .filter(Boolean)
    .filter(event => {
      const key = `${event.time}|${event.title}|${event.channels.map(channel => channel.id).join(",")}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.time.localeCompare(b.time) || a.title.localeCompare(b.title));
}

function eventsForLiveChannel(days, streamId, date) {
  return liveScheduleEventsForDate(days, date, new Set([String(streamId)]))
    .map(event => ({
      time: event.time,
      title: event.title,
      category: event.category || ""
    }));
}

async function ensureSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY,
      username text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  // Migration path for the previous email/display-name schema. Existing rows
  // receive a deterministic username so the table can be upgraded in place.
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS username text`;
  await sql`
    UPDATE users
    SET username = 'user_' || substring(replace(id::text, '-', '') from 1 for 12)
    WHERE username IS NULL OR btrim(username) = ''
  `;
  await sql`ALTER TABLE users ALTER COLUMN username SET NOT NULL`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique ON users (lower(username))`;
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS email`;
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS display_name`;

  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash text PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at)`;

  await sql`
    CREATE TABLE IF NOT EXISTS watch_history (
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      imdb_id text NOT NULL,
      media_type text NOT NULL CHECK (media_type IN ('tv', 'movie')),
      show_id integer,
      name text NOT NULL,
      poster text NOT NULL DEFAULT '',
      backdrop text NOT NULL DEFAULT '',
      summary text NOT NULL DEFAULT '',
      year text NOT NULL DEFAULT '',
      season integer,
      episode integer,
      episode_name text NOT NULL DEFAULT '',
      position_seconds double precision NOT NULL DEFAULT 0,
      duration double precision NOT NULL DEFAULT 0,
      last_watched timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, imdb_id)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS watch_history_user_last_watched_idx
    ON watch_history(user_id, last_watched DESC)
  `;
}

let schemaReadyPromise = null;

function ensureSchemaReady() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = ensureSchema().catch(error => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
}

app.get("/api/health", async (_req, res, next) => {
  try {
    await ensureSchemaReady();
    const rows = await sql`SELECT now() AS now`;
    res.json({ ok: true, database: true, now: rows[0]?.now });
  } catch (error) {
    next(error);
  }
});

app.get("/api/live-sports/schedule", async (req, res, next) => {
  try {
    const requestedDate = validGuideDate(req.query.date);
    const days = await fetchDlstreamsPublicSchedule();
    const availableDates = [...days.keys()].sort();

    const dates = requestedDate ? [requestedDate] : availableDates;
    const events = dates.flatMap(date =>
      liveScheduleEventsForDate(days, date).map(event => ({ ...event, date }))
    );

    res.setHeader("Cache-Control", "public, max-age=120, s-maxage=600, stale-while-revalidate=600");
    res.json({
      date: requestedDate || null,
      availableDates,
      timezone: "Europe/London",
      source: "DLStreams public schedule",
      events
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/live-sports/schedule/:streamId", async (req, res, next) => {
  try {
    const streamId = String(req.params.streamId || "");
    if (!/^\d+$/.test(streamId)) {
      return res.status(400).json({ error: "Invalid live channel ID." });
    }

    const requestedDate = validGuideDate(req.query.date);
    if (!requestedDate) {
      return res.status(400).json({ error: "Use a date in YYYY-MM-DD format." });
    }

    const days = await fetchDlstreamsPublicSchedule();
    const events = eventsForLiveChannel(days, streamId, requestedDate);
    res.setHeader("Cache-Control", "public, max-age=120, s-maxage=600, stale-while-revalidate=300");
    res.json({
      streamId,
      date: requestedDate,
      timezone: "Europe/London",
      source: "DLStreams public schedule",
      events
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/register", authRateLimit, async (req, res, next) => {
  try {
    await ensureSchemaReady();
    const username = normaliseUsername(req.body?.username);
    const password = String(req.body?.password ?? "");

    if (!validUsername(username)) {
      return res.status(400).json({
        error: "Username must be 3–30 characters using letters, numbers, dots, underscores, or hyphens."
      });
    }
    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: "Password must be between 8 and 128 characters." });
    }

    const userId = crypto.randomUUID();
    const passwordHash = await hashPassword(password);

    try {
      await sql`
        INSERT INTO users (id, username, password_hash)
        VALUES (${userId}, ${username}, ${passwordHash})
      `;
    } catch (error) {
      if (error?.code === "23505") {
        return res.status(409).json({ error: "That username is already taken." });
      }
      throw error;
    }

    const token = await createSession(userId);
    res.status(201).json({ user: { id: userId, username }, token });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/login", authRateLimit, async (req, res, next) => {
  try {
    await ensureSchemaReady();
    const username = normaliseUsername(req.body?.username);
    const password = String(req.body?.password ?? "");

    const rows = await sql`
      SELECT id, username, password_hash
      FROM users
      WHERE lower(username) = ${username}
      LIMIT 1
    `;

    const user = rows[0];
    const passwordOk = user ? await verifyPassword(password, user.password_hash) : false;
    if (!user || !passwordOk) {
      return res.status(401).json({ error: "Incorrect username or password." });
    }

    const token = await createSession(user.id);
    res.json({ user: serialiseUser(user), token });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", requireAuth, async (req, res, next) => {
  try {
    await sql`DELETE FROM sessions WHERE token_hash = ${req.sessionTokenHash}`;
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: serialiseUser(req.user) });
});

app.get("/api/playback-url", requireAuth, (req, res) => {
  const mediaType = req.query.type === "movie" ? "movie" : "tv";
  const imdbId = cleanText(req.query.imdbId, 64);
  const startAt = Math.max(0, Math.floor(finiteNumber(req.query.startAt, 0)));

  if (!/^tt\d+$/i.test(imdbId)) {
    return res.status(400).json({ error: "Invalid IMDb identifier." });
  }

  const params = new URLSearchParams({ autoPlay: "true" });
  if (startAt >= 5) params.set("startAt", String(startAt));

  if (mediaType === "movie") {
    return res.json({
      url: `https://vidfast.vc/movie/${encodeURIComponent(imdbId)}?${params.toString()}`
    });
  }

  const season = nullableInteger(req.query.season);
  const episode = nullableInteger(req.query.episode);
  if (!season || season < 1 || !episode || episode < 1) {
    return res.status(400).json({ error: "A valid season and episode are required." });
  }

  res.json({
    url: `https://vidfast.vc/tv/${encodeURIComponent(imdbId)}/${season}/${episode}?${params.toString()}`
  });
});

app.get("/api/watch-history", requireAuth, async (req, res, next) => {
  try {
    const rows = await sql`
      SELECT *
      FROM watch_history
      WHERE user_id = ${req.user.id}
      ORDER BY last_watched DESC
      LIMIT ${MAX_WATCH_HISTORY}
    `;
    res.json({ entries: rows.map(watchRowToClient) });
  } catch (error) {
    next(error);
  }
});

app.put("/api/watch-history/:imdbId", requireAuth, async (req, res, next) => {
  try {
    const entry = normaliseWatchEntry({ ...req.body, imdbId: req.params.imdbId });
    await upsertWatchEntry(req.user.id, entry);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/watch-history/sync", requireAuth, async (req, res, next) => {
  try {
    const incoming = Array.isArray(req.body?.entries) ? req.body.entries.slice(0, MAX_WATCH_HISTORY) : [];
    for (const rawEntry of incoming) {
      const entry = normaliseWatchEntry(rawEntry);
      await upsertWatchEntry(req.user.id, entry);
    }
    res.json({ ok: true, synced: incoming.length });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/watch-history/:imdbId", requireAuth, async (req, res, next) => {
  try {
    const imdbId = cleanText(req.params.imdbId, 64);
    await sql`
      DELETE FROM watch_history
      WHERE user_id = ${req.user.id} AND imdb_id = ${imdbId}
    `;
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "API route not found." });
  }
  next();
});

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = Number(error?.status) || 500;
  res.status(status).json({
    error: status >= 500 ? "Something went wrong on the server." : error.message
  });
});

// Database schema creation is lazy so public schedule requests do not wake Neon.
// Vercel's Express runtime uses the default export.
export default app;

// Keeps `npm run dev` useful locally. VERCEL is provided by Vercel automatically;
// it is not something you add to .env.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`ShowHub API running on http://localhost:${PORT}`);
  });
}
