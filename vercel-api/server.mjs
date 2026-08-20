import crypto from "node:crypto";
import { promisify } from "node:util";
import { Readable } from "node:stream";
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
const vidFastResolveCache = new Map();
const VIDFAST_RESOLVE_CACHE_MS = 10 * 60 * 1000;
const VIDFAST_ORIGIN = "https://vidfast.vc";
const VIDFAST_REFERER = `${VIDFAST_ORIGIN}/`;
const VIDFAST_ENCDEC_API = "https://enc-dec.app/api";
const VIDFAST_VERSION = "1";
const VIDFAST_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
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
app.use(express.json({ limit: "512kb" }));
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
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
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
      SELECT u.id, u.username, u.created_at, u.profile_picture, s.token_hash
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
      username: row.username,
      created_at: row.created_at,
      profile_picture: row.profile_picture || ""
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
    username: user.username,
    createdAt: user.created_at || user.createdAt || null,
    profilePicture: user.profile_picture || user.profilePicture || ""
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

function normaliseLibraryItem(body) {
  const imdbId = cleanText(body?.imdbId, 64);
  if (!/^tt\d+$/i.test(imdbId)) {
    const error = new Error("Invalid IMDb identifier.");
    error.status = 400;
    throw error;
  }
  const mediaType = body?.mediaType === "movie" ? "movie" : "tv";
  return {
    imdbId,
    mediaType,
    showId: mediaType === "tv" ? nullableInteger(body?.showId) : null,
    name: cleanText(body?.name, 250) || "Untitled",
    poster: cleanText(body?.poster, 2000),
    backdrop: cleanText(body?.backdrop, 2000),
    summary: cleanText(body?.summary, 8000),
    year: cleanText(body?.year, 32)
  };
}

function libraryRowToClient(row) {
  return {
    imdbId: row.imdb_id,
    mediaType: row.media_type,
    showId: row.show_id,
    name: row.name,
    poster: row.poster || "",
    backdrop: row.backdrop || "",
    summary: row.summary || "",
    year: row.year || "",
    addedAt: row.added_at ? new Date(row.added_at).getTime() : null
  };
}

function normaliseListName(value) {
  const name = cleanText(value, 60);
  if (!name) {
    const error = new Error("List name is required.");
    error.status = 400;
    throw error;
  }
  return name;
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
      "User-Agent": "TVArchive/1.0"
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
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture text NOT NULL DEFAULT ''`;

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

  await sql`
    CREATE TABLE IF NOT EXISTS watch_later (
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      imdb_id text NOT NULL,
      media_type text NOT NULL CHECK (media_type IN ('tv', 'movie')),
      show_id integer,
      name text NOT NULL,
      poster text NOT NULL DEFAULT '',
      backdrop text NOT NULL DEFAULT '',
      summary text NOT NULL DEFAULT '',
      year text NOT NULL DEFAULT '',
      added_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, imdb_id)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS watch_later_user_added_idx ON watch_later(user_id, added_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS user_lists (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name text NOT NULL,
      is_public boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS user_lists_user_name_unique ON user_lists(user_id, lower(name))`;
  await sql`CREATE INDEX IF NOT EXISTS user_lists_public_idx ON user_lists(is_public, updated_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS list_items (
      list_id uuid NOT NULL REFERENCES user_lists(id) ON DELETE CASCADE,
      imdb_id text NOT NULL,
      media_type text NOT NULL CHECK (media_type IN ('tv', 'movie')),
      show_id integer,
      name text NOT NULL,
      poster text NOT NULL DEFAULT '',
      backdrop text NOT NULL DEFAULT '',
      summary text NOT NULL DEFAULT '',
      year text NOT NULL DEFAULT '',
      added_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (list_id, imdb_id)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS list_items_list_added_idx ON list_items(list_id, added_at DESC)`;
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

    let createdUser;
    try {
      const createdRows = await sql`
        INSERT INTO users (id, username, password_hash)
        VALUES (${userId}, ${username}, ${passwordHash})
        RETURNING id, username, created_at, profile_picture
      `;
      createdUser = createdRows[0];
    } catch (error) {
      if (error?.code === "23505") {
        return res.status(409).json({ error: "That username is already taken." });
      }
      throw error;
    }

    const token = await createSession(userId);
    res.status(201).json({ user: serialiseUser(createdUser || { id: userId, username }), token });
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
      SELECT id, username, password_hash, created_at, profile_picture
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

app.patch("/api/account/username", authRateLimit, requireAuth, async (req, res, next) => {
  try {
    const username = normaliseUsername(req.body?.username);
    const currentPassword = String(req.body?.currentPassword ?? "");

    if (!validUsername(username)) {
      return res.status(400).json({
        error: "Username must be 3–30 characters using letters, numbers, dots, underscores, or hyphens."
      });
    }
    if (!currentPassword) {
      return res.status(400).json({ error: "Enter your current password." });
    }

    const rows = await sql`
      SELECT password_hash
      FROM users
      WHERE id = ${req.user.id}
      LIMIT 1
    `;
    const passwordOk = rows[0] ? await verifyPassword(currentPassword, rows[0].password_hash) : false;
    if (!passwordOk) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }

    try {
      const updated = await sql`
        UPDATE users
        SET username = ${username}, updated_at = now()
        WHERE id = ${req.user.id}
        RETURNING id, username, created_at, profile_picture
      `;
      res.json({ user: serialiseUser(updated[0]) });
    } catch (error) {
      if (error?.code === "23505") {
        return res.status(409).json({ error: "That username is already taken." });
      }
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

app.patch("/api/account/password", authRateLimit, requireAuth, async (req, res, next) => {
  try {
    const currentPassword = String(req.body?.currentPassword ?? "");
    const newPassword = String(req.body?.newPassword ?? "");

    if (!currentPassword) {
      return res.status(400).json({ error: "Enter your current password." });
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      return res.status(400).json({ error: "New password must be between 8 and 128 characters." });
    }

    const rows = await sql`
      SELECT password_hash
      FROM users
      WHERE id = ${req.user.id}
      LIMIT 1
    `;
    const passwordOk = rows[0] ? await verifyPassword(currentPassword, rows[0].password_hash) : false;
    if (!passwordOk) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }

    const passwordHash = await hashPassword(newPassword);
    await sql`
      UPDATE users
      SET password_hash = ${passwordHash}, updated_at = now()
      WHERE id = ${req.user.id}
    `;

    // Keep the current device signed in, but invalidate older sessions elsewhere.
    await sql`
      DELETE FROM sessions
      WHERE user_id = ${req.user.id}
        AND token_hash <> ${req.sessionTokenHash}
    `;

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/account/profile-picture", requireAuth, async (req, res, next) => {
  try {
    const imageData = String(req.body?.imageData || "");
    if (imageData) {
      if (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(imageData)) {
        return res.status(400).json({ error: "Upload a JPEG, PNG, or WebP image." });
      }
      if (Buffer.byteLength(imageData, "utf8") > 400000) {
        return res.status(413).json({ error: "Profile picture is too large." });
      }
    }
    const rows = await sql`
      UPDATE users
      SET profile_picture = ${imageData}, updated_at = now()
      WHERE id = ${req.user.id}
      RETURNING id, username, created_at, profile_picture
    `;
    res.json({ user: serialiseUser(rows[0]) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/watch-later", requireAuth, async (req, res, next) => {
  try {
    const rows = await sql`SELECT * FROM watch_later WHERE user_id = ${req.user.id} ORDER BY added_at DESC`;
    res.json({ entries: rows.map(libraryRowToClient) });
  } catch (error) { next(error); }
});

app.put("/api/watch-later/:imdbId", requireAuth, async (req, res, next) => {
  try {
    const item = normaliseLibraryItem({ ...req.body, imdbId: req.params.imdbId });
    await sql`
      INSERT INTO watch_later (user_id, imdb_id, media_type, show_id, name, poster, backdrop, summary, year)
      VALUES (${req.user.id}, ${item.imdbId}, ${item.mediaType}, ${item.showId}, ${item.name}, ${item.poster}, ${item.backdrop}, ${item.summary}, ${item.year})
      ON CONFLICT (user_id, imdb_id) DO UPDATE SET
        media_type = EXCLUDED.media_type, show_id = EXCLUDED.show_id, name = EXCLUDED.name,
        poster = EXCLUDED.poster, backdrop = EXCLUDED.backdrop, summary = EXCLUDED.summary,
        year = EXCLUDED.year, added_at = now()
    `;
    res.json({ entry: { ...item, addedAt: Date.now() } });
  } catch (error) { next(error); }
});

app.delete("/api/watch-later/:imdbId", requireAuth, async (req, res, next) => {
  try {
    const imdbId = cleanText(req.params.imdbId, 64);
    await sql`DELETE FROM watch_later WHERE user_id = ${req.user.id} AND imdb_id = ${imdbId}`;
    res.status(204).end();
  } catch (error) { next(error); }
});

app.get("/api/lists/discover", requireAuth, async (req, res, next) => {
  try {
    const rows = await sql`
      SELECT l.id, l.name, l.is_public, l.created_at, l.updated_at, u.username,
             COUNT(i.imdb_id)::int AS item_count
      FROM user_lists l
      JOIN users u ON u.id = l.user_id
      LEFT JOIN list_items i ON i.list_id = l.id
      WHERE l.is_public = true
      GROUP BY l.id, u.username
      ORDER BY l.updated_at DESC
      LIMIT 60
    `;
    res.json({ lists: rows.map(row => ({
      id: row.id, name: row.name, isPublic: true, owner: row.username,
      itemCount: Number(row.item_count || 0), createdAt: row.created_at, updatedAt: row.updated_at
    })) });
  } catch (error) { next(error); }
});

app.get("/api/lists/:listId/browse", requireAuth, async (req, res, next) => {
  try {
    const rows = await sql`
      SELECT l.id, l.name, l.is_public, l.user_id, l.created_at, l.updated_at, u.username
      FROM user_lists l JOIN users u ON u.id = l.user_id
      WHERE l.id::text = ${cleanText(req.params.listId, 64)}
      LIMIT 1
    `;
    const list = rows[0];
    if (!list || (!list.is_public && String(list.user_id) !== String(req.user.id))) {
      return res.status(404).json({ error: "List not found." });
    }
    const items = await sql`SELECT * FROM list_items WHERE list_id = ${list.id} ORDER BY added_at DESC`;
    res.json({
      list: { id: list.id, name: list.name, isPublic: Boolean(list.is_public), owner: list.username, createdAt: list.created_at, updatedAt: list.updated_at },
      items: items.map(libraryRowToClient)
    });
  } catch (error) { next(error); }
});

app.get("/api/lists", requireAuth, async (req, res, next) => {
  try {
    const lists = await sql`
      SELECT id, name, is_public, created_at, updated_at
      FROM user_lists WHERE user_id = ${req.user.id} ORDER BY updated_at DESC
    `;
    const items = await sql`
      SELECT i.* FROM list_items i JOIN user_lists l ON l.id = i.list_id
      WHERE l.user_id = ${req.user.id} ORDER BY i.added_at DESC
    `;
    res.json({ lists: lists.map(list => ({
      id: list.id, name: list.name, isPublic: Boolean(list.is_public),
      createdAt: list.created_at, updatedAt: list.updated_at,
      items: items.filter(item => String(item.list_id) === String(list.id)).map(libraryRowToClient)
    })) });
  } catch (error) { next(error); }
});

app.post("/api/lists", requireAuth, async (req, res, next) => {
  try {
    const name = normaliseListName(req.body?.name);
    const isPublic = req.body?.isPublic !== false;
    try {
      const rows = await sql`
        INSERT INTO user_lists (id, user_id, name, is_public)
        VALUES (${crypto.randomUUID()}, ${req.user.id}, ${name}, ${isPublic})
        RETURNING id, name, is_public, created_at, updated_at
      `;
      const list = rows[0];
      res.status(201).json({ list: { id: list.id, name: list.name, isPublic: Boolean(list.is_public), createdAt: list.created_at, updatedAt: list.updated_at, items: [] } });
    } catch (error) {
      if (error?.code === "23505") return res.status(409).json({ error: "You already have a list with that name." });
      throw error;
    }
  } catch (error) { next(error); }
});

app.patch("/api/lists/:listId", requireAuth, async (req, res, next) => {
  try {
    const name = normaliseListName(req.body?.name);
    const isPublic = req.body?.isPublic !== false;
    try {
      const rows = await sql`
        UPDATE user_lists SET name = ${name}, is_public = ${isPublic}, updated_at = now()
        WHERE id::text = ${cleanText(req.params.listId, 64)} AND user_id = ${req.user.id}
        RETURNING id, name, is_public, created_at, updated_at
      `;
      if (!rows[0]) return res.status(404).json({ error: "List not found." });
      const list = rows[0];
      res.json({ list: { id: list.id, name: list.name, isPublic: Boolean(list.is_public), createdAt: list.created_at, updatedAt: list.updated_at } });
    } catch (error) {
      if (error?.code === "23505") return res.status(409).json({ error: "You already have a list with that name." });
      throw error;
    }
  } catch (error) { next(error); }
});

app.delete("/api/lists/:listId", requireAuth, async (req, res, next) => {
  try {
    await sql`DELETE FROM user_lists WHERE id::text = ${cleanText(req.params.listId, 64)} AND user_id = ${req.user.id}`;
    res.status(204).end();
  } catch (error) { next(error); }
});

app.put("/api/lists/:listId/items/:imdbId", requireAuth, async (req, res, next) => {
  try {
    const listRows = await sql`SELECT id FROM user_lists WHERE id::text = ${cleanText(req.params.listId, 64)} AND user_id = ${req.user.id} LIMIT 1`;
    if (!listRows[0]) return res.status(404).json({ error: "List not found." });
    const item = normaliseLibraryItem({ ...req.body, imdbId: req.params.imdbId });
    await sql`
      INSERT INTO list_items (list_id, imdb_id, media_type, show_id, name, poster, backdrop, summary, year)
      VALUES (${listRows[0].id}, ${item.imdbId}, ${item.mediaType}, ${item.showId}, ${item.name}, ${item.poster}, ${item.backdrop}, ${item.summary}, ${item.year})
      ON CONFLICT (list_id, imdb_id) DO UPDATE SET
        media_type = EXCLUDED.media_type, show_id = EXCLUDED.show_id, name = EXCLUDED.name,
        poster = EXCLUDED.poster, backdrop = EXCLUDED.backdrop, summary = EXCLUDED.summary,
        year = EXCLUDED.year, added_at = now()
    `;
    await sql`UPDATE user_lists SET updated_at = now() WHERE id = ${listRows[0].id}`;
    res.json({ item: { ...item, addedAt: Date.now() } });
  } catch (error) { next(error); }
});

app.delete("/api/lists/:listId/items/:imdbId", requireAuth, async (req, res, next) => {
  try {
    const listId = cleanText(req.params.listId, 64);
    const imdbId = cleanText(req.params.imdbId, 64);
    await sql`
      DELETE FROM list_items i USING user_lists l
      WHERE i.list_id = l.id AND l.id::text = ${listId} AND l.user_id = ${req.user.id} AND i.imdb_id = ${imdbId}
    `;
    await sql`UPDATE user_lists SET updated_at = now() WHERE id::text = ${listId} AND user_id = ${req.user.id}`;
    res.status(204).end();
  } catch (error) { next(error); }
});


function vidFastHeaders(token = "") {
  const headers = {
    "User-Agent": VIDFAST_USER_AGENT,
    "Referer": VIDFAST_REFERER,
    "X-Requested-With": "XMLHttpRequest"
  };
  if (token) headers["X-CSRF-Token"] = token;
  return headers;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs)
  });
}

async function readResponseText(response, label) {
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}.`);
  }
  return response.text();
}

async function readResponseJson(response, label) {
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}.`);
  }
  const data = await response.json();
  if (!data || typeof data !== "object") throw new Error(`${label} returned invalid JSON.`);
  return data;
}

function normaliseCandidateUrl(value) {
  let text = String(value || "").trim();
  if (!text) return "";
  text = text.replace(/\\u0026/gi, "&").replace(/\\\//g, "/");
  if (!/^https?:\/\//i.test(text)) return "";
  try {
    const url = new URL(text);
    if (!/^https?:$/.test(url.protocol)) return "";
    return url.href;
  } catch {
    return "";
  }
}

function collectPlayableUrls(value, output = [], seen = new Set(), keyHint = "") {
  if (value === null || value === undefined || output.length > 80) return output;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        collectPlayableUrls(JSON.parse(trimmed), output, seen, keyHint);
      } catch {}
    }
    const url = normaliseCandidateUrl(value);
    if (!url || seen.has(url)) return output;
    const lower = url.toLowerCase();
    const hint = String(keyHint || "").toLowerCase();
    const looksSubtitle = /\.(vtt|srt|ass)(?:$|\?)/i.test(lower) || /subtitle|caption|track/.test(hint);
    if (!looksSubtitle) {
      seen.add(url);
      output.push({
        url,
        score: /\.m3u8(?:$|\?)/i.test(lower) ? 100
          : /\.mp4(?:$|\?)/i.test(lower) ? 90
          : /stream|source|file|url|src/.test(hint) ? 55
          : 20
      });
    }
    return output;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectPlayableUrls(item, output, seen, keyHint);
    return output;
  }

  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      collectPlayableUrls(item, output, seen, key);
    }
  }
  return output;
}

function bestPlayableUrl(value) {
  const candidates = collectPlayableUrls(value)
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.url || "";
}

function extractVidFastEncryptedText(html) {
  const patterns = [
    /\\"en\\":\\"(.*?)\\"/s,
    /"en"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/s
  ];
  for (const pattern of patterns) {
    const match = String(html || "").match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}

async function decryptVidFastPayload(text) {
  const response = await fetchWithTimeout(`${VIDFAST_ENCDEC_API}/dec-vidfast`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, version: VIDFAST_VERSION })
  });
  return readResponseJson(response, "VidFast decrypt service");
}

async function resolveVidFastStream({ mediaType, imdbId, season, episode }) {
  const cacheKey = mediaType === "movie"
    ? `movie:${imdbId}`
    : `tv:${imdbId}:${season}:${episode}`;
  const cached = vidFastResolveCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const pageUrl = mediaType === "movie"
    ? `${VIDFAST_ORIGIN}/movie/${encodeURIComponent(imdbId)}`
    : `${VIDFAST_ORIGIN}/tv/${encodeURIComponent(imdbId)}/${season}/${episode}`;

  const pageResponse = await fetchWithTimeout(pageUrl, { headers: vidFastHeaders() });
  const html = await readResponseText(pageResponse, "VidFast player page");
  const encryptedText = extractVidFastEncryptedText(html);
  if (!encryptedText) throw new Error("VidFast server metadata could not be located.");

  const encUrl = new URL(`${VIDFAST_ENCDEC_API}/enc-vidfast`);
  encUrl.searchParams.set("text", encryptedText);
  encUrl.searchParams.set("version", VIDFAST_VERSION);
  const partsResponse = await fetchWithTimeout(encUrl, { headers: { "User-Agent": VIDFAST_USER_AGENT } });
  const partsJson = await readResponseJson(partsResponse, "VidFast metadata service");
  const parts = partsJson.result;
  if (!parts?.servers || !parts?.stream || !parts?.token) {
    throw new Error("VidFast metadata response was incomplete.");
  }

  const headers = vidFastHeaders(parts.token);
  const serverResponse = await fetchWithTimeout(parts.servers, { method: "POST", headers });
  const encryptedServers = await readResponseText(serverResponse, "VidFast server list");
  const decryptedServersJson = await decryptVidFastPayload(encryptedServers);
  const servers = Array.isArray(decryptedServersJson.result)
    ? decryptedServersJson.result
    : Array.isArray(decryptedServersJson)
      ? decryptedServersJson
      : [];
  if (!servers.length) throw new Error("VidFast returned no streaming servers.");

  let lastError = null;
  for (const server of servers.slice(0, 8)) {
    const data = server?.data;
    if (!data) continue;
    try {
      const streamUrl = `${String(parts.stream).replace(/\/$/, "")}/${String(data)}`;
      const streamResponse = await fetchWithTimeout(streamUrl, { method: "POST", headers });
      const encryptedStream = await readResponseText(streamResponse, "VidFast stream endpoint");
      const decryptedStream = await decryptVidFastPayload(encryptedStream);
      const playableUrl = bestPlayableUrl(decryptedStream.result ?? decryptedStream);
      if (!playableUrl) continue;

      const value = {
        url: playableUrl,
        referer: VIDFAST_REFERER,
        kind: /\.mp4(?:$|\?)/i.test(playableUrl) ? "file" : "hls"
      };
      vidFastResolveCache.set(cacheKey, {
        value,
        expiresAt: Date.now() + VIDFAST_RESOLVE_CACHE_MS
      });
      return value;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("VidFast returned no playable stream URL.");
}

function mediaProxySignature(payload) {
  return crypto.createHmac("sha256", DATABASE_URL).update(payload).digest("base64url");
}

function makeMediaProxyUrl(req, upstreamUrl, referer = VIDFAST_REFERER) {
  const payload = Buffer.from(JSON.stringify({ url: upstreamUrl, referer }), "utf8").toString("base64url");
  const signature = mediaProxySignature(payload);
  return `${req.protocol}://${req.get("host")}/api/vidfast/media?p=${encodeURIComponent(payload)}&s=${encodeURIComponent(signature)}`;
}

function decodeMediaProxyPayload(payload, signature) {
  if (!payload || !signature) return null;
  const expected = mediaProxySignature(payload);
  const actualBuffer = Buffer.from(String(signature));
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const url = new URL(decoded.url);
    if (!/^https?:$/.test(url.protocol)) return null;
    return { url: url.href, referer: cleanText(decoded.referer, 2000) || VIDFAST_REFERER };
  } catch {
    return null;
  }
}

function rewriteHlsManifest(text, upstreamUrl, req, referer) {
  const rewrite = value => {
    try {
      const absolute = new URL(value, upstreamUrl).href;
      return makeMediaProxyUrl(req, absolute, referer);
    } catch {
      return value;
    }
  };

  return String(text || "").split(/\r?\n/).map(line => {
    if (!line.trim()) return line;
    if (line.startsWith("#")) {
      return line.replace(/URI="([^"]+)"/g, (_match, uri) => `URI="${rewrite(uri)}"`);
    }
    return rewrite(line.trim());
  }).join("\n");
}

app.get("/api/vidfast/media", async (req, res, next) => {
  try {
    const decoded = decodeMediaProxyPayload(String(req.query.p || ""), String(req.query.s || ""));
    if (!decoded) return res.status(403).json({ error: "Invalid media proxy token." });

    const headers = {
      "User-Agent": VIDFAST_USER_AGENT,
      "Referer": decoded.referer,
      "Origin": VIDFAST_ORIGIN,
      "Accept": req.get("accept") || "*/*"
    };
    const range = req.get("range");
    if (range) headers.Range = range;

    const upstream = await fetchWithTimeout(decoded.url, { headers }, 20000);
    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status).end();
    }

    const contentType = String(upstream.headers.get("content-type") || "");
    const isManifest = /mpegurl|m3u8/i.test(contentType) || /\.m3u8(?:$|\?)/i.test(decoded.url);

    if (isManifest) {
      const manifest = await upstream.text();
      res.status(upstream.status);
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Cache-Control", "private, max-age=5");
      return res.send(rewriteHlsManifest(manifest, decoded.url, req, decoded.referer));
    }

    res.status(upstream.status);
    for (const headerName of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
      const value = upstream.headers.get(headerName);
      if (value) res.setHeader(headerName, value);
    }
    res.setHeader("Cache-Control", "private, max-age=300");
    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (error) {
    next(error);
  }
});

app.get("/api/playback-url", requireAuth, async (req, res) => {
  const mediaType = req.query.type === "movie" ? "movie" : "tv";
  const imdbId = cleanText(req.query.imdbId, 64);
  const startAt = Math.max(0, Math.floor(finiteNumber(req.query.startAt, 0)));

  if (!/^tt\d+$/i.test(imdbId)) {
    return res.status(400).json({ error: "Invalid IMDb identifier." });
  }

  const season = mediaType === "tv" ? nullableInteger(req.query.season) : null;
  const episode = mediaType === "tv" ? nullableInteger(req.query.episode) : null;
  if (mediaType === "tv" && (!season || season < 1 || !episode || episode < 1)) {
    return res.status(400).json({ error: "A valid season and episode are required." });
  }

  const params = new URLSearchParams({ autoPlay: "true" });
  if (startAt >= 5) params.set("startAt", String(startAt));
  const fallbackUrl = mediaType === "movie"
    ? `${VIDFAST_ORIGIN}/movie/${encodeURIComponent(imdbId)}?${params.toString()}`
    : `${VIDFAST_ORIGIN}/tv/${encodeURIComponent(imdbId)}/${season}/${episode}?${params.toString()}`;

  try {
    const resolved = await resolveVidFastStream({ mediaType, imdbId, season, episode });
    return res.json({
      mode: "direct",
      kind: resolved.kind,
      url: makeMediaProxyUrl(req, resolved.url, resolved.referer),
      fallbackUrl,
      startAt
    });
  } catch (error) {
    console.warn("VidFast direct resolver failed; using embed fallback:", error?.message || error);
    return res.json({ mode: "embed", url: fallbackUrl, startAt });
  }
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

app.delete("/api/watch-history", requireAuth, async (req, res, next) => {
  try {
    await sql`DELETE FROM watch_history WHERE user_id = ${req.user.id}`;
    res.status(204).end();
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
    console.log(`TV Archive API running on http://localhost:${PORT}`);
  });
}
