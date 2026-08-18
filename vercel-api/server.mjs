import crypto from "node:crypto";
import { promisify } from "node:util";
import express from "express";
import { neon } from "@neondatabase/serverless";

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
const SKY_SPORTS_GUIDE_SIDS = new Map([
  [35, 3096],  // Sky Sports Football
  [36, 3097],  // Sky Sports+
  [37, 1703],  // Sky Sports Action
  [38, 1701],  // Sky Sports Main Event
  [46, 1705],  // Sky Sports Tennis
  [130, 1010], // Sky Sports Premier League
  [60, 3835],  // Sky Sports F1
  [65, 1702],  // Sky Sports Cricket
  [70, 1094],  // Sky Sports Golf
  [366, 1340], // Sky Sports News
  [449, 4090], // Sky Sports Mix
  [554, 4032]  // Sky Sports Racing
]);

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

function findSkyScheduleEvents(payload) {
  if (!payload) return [];
  if (Array.isArray(payload?.events)) return payload.events;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const events = findSkyScheduleEvents(item);
      if (events.length) return events;
    }
    return [];
  }
  if (typeof payload === "object") {
    const preferredKeys = ["schedule", "schedules", "services", "channels", "data"];
    for (const key of preferredKeys) {
      if (!(key in payload)) continue;
      const events = findSkyScheduleEvents(payload[key]);
      if (events.length) return events;
    }
    for (const value of Object.values(payload)) {
      if (!value || typeof value !== "object") continue;
      const events = findSkyScheduleEvents(value);
      if (events.length) return events;
    }
  }
  return [];
}

function skyTimestampMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return NaN;
  return numeric > 1e12 ? numeric : numeric * 1000;
}

function normaliseSkyScheduleEvent(raw) {
  const startMs = skyTimestampMs(raw?.st ?? raw?.start ?? raw?.startTime ?? raw?.starttime);
  if (!Number.isFinite(startMs)) return null;

  let endMs = skyTimestampMs(raw?.end ?? raw?.et ?? raw?.endTime ?? raw?.endtime);
  if (!Number.isFinite(endMs)) {
    const duration = Number(raw?.d ?? raw?.duration ?? 0);
    if (Number.isFinite(duration) && duration > 0) {
      // Sky's HAWK guide exposes duration in seconds.
      endMs = startMs + duration * 1000;
    }
  }
  if (!Number.isFinite(endMs) || endMs <= startMs) return null;

  const title = cleanText(raw?.t ?? raw?.title ?? raw?.name, 300) || "Untitled";
  const synopsis = cleanText(raw?.sy ?? raw?.synopsis ?? raw?.description ?? raw?.desc, 2000);
  return {
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    title,
    synopsis
  };
}

function validGuideDate(value) {
  const text = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

async function fetchSkySportsSchedule(streamId, guideSid, date) {
  const cacheKey = `${streamId}:${date}`;
  const cached = liveSportsScheduleCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < LIVE_SPORTS_SCHEDULE_CACHE_MS) {
    return cached.events;
  }

  const skyDate = date.replaceAll("-", "");
  const url = `https://awk.epgsky.com/hawk/linear/schedule/${skyDate}/${guideSid}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json, text/javascript, */*",
      "User-Agent": "ShowHub/1.0"
    },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) {
    const error = new Error(`Programme guide returned HTTP ${response.status}.`);
    error.status = 502;
    throw error;
  }

  const payload = await response.json();
  const events = findSkyScheduleEvents(payload)
    .map(normaliseSkyScheduleEvent)
    .filter(Boolean)
    .sort((a, b) => new Date(a.start) - new Date(b.start));

  liveSportsScheduleCache.set(cacheKey, { savedAt: Date.now(), events });
  return events;
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

app.get("/api/live-sports/schedule/:streamId", async (req, res, next) => {
  try {
    const streamId = Number(req.params.streamId);
    const guideSid = SKY_SPORTS_GUIDE_SIDS.get(streamId);
    if (!guideSid) {
      return res.status(404).json({ error: "A programme guide is not available for this channel." });
    }

    const requestedDate = validGuideDate(req.query.date);
    if (!requestedDate) {
      return res.status(400).json({ error: "Use a date in YYYY-MM-DD format." });
    }

    const events = await fetchSkySportsSchedule(streamId, guideSid, requestedDate);
    res.setHeader("Cache-Control", "public, max-age=120, s-maxage=600, stale-while-revalidate=300");
    res.json({ streamId, date: requestedDate, timezone: "Europe/London", events });
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
