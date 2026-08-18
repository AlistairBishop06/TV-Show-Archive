import crypto from "node:crypto";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
const PORT = 3000;
const SESSION_COOKIE = "showhub_session";
const SESSION_DAYS = 30;
const MAX_WATCH_HISTORY = 40;
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_ATTEMPTS = 20;

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL. Copy .env.example to .env and paste your Neon connection string.");
  process.exit(1);
}

const sql = neon(DATABASE_URL);
const scryptAsync = promisify(crypto.scrypt);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const app = express();
const authAttempts = new Map();

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

app.use((req, res, next) => {
  const origin = req.get("origin");
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const requestUrl = new URL(`${req.protocol}://${req.get("host")}`);

      // Allow credentialed requests between loopback development origins only.
      // Production requests remain same-origin and need no CORS configuration.
      if (isLoopbackHostname(originUrl.hostname) && isLoopbackHostname(requestUrl.hostname)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader("Vary", "Origin");
        if (req.method === "OPTIONS") {
          res.setHeader("Access-Control-Allow-Headers", "Content-Type");
          res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
          return res.status(204).end();
        }
      }
    } catch {
      // Ignore malformed Origin headers here; sameOriginOnly handles mutations.
    }
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

function isLoopbackHostname(hostname) {
  return ["localhost", "127.0.0.1", "::1"].includes(String(hostname || "").toLowerCase());
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const result = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
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

function sessionCookieOptions(req) {
  return {
    httpOnly: true,
    secure: req.secure,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000
  };
}

async function createSession(userId, req, res) {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = sessionHash(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  await sql`DELETE FROM sessions WHERE expires_at <= now()`;
  await sql`
    INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (${tokenHash}, ${userId}, ${expiresAt})
  `;

  res.cookie(SESSION_COOKIE, rawToken, sessionCookieOptions(req));
}

function clearSessionCookie(req, res) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: req.secure,
    sameSite: "lax",
    path: "/"
  });
}

function sameOriginOnly(req, res, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  const origin = req.get("origin");
  if (!origin) return next();

  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(`${req.protocol}://${req.get("host")}`);

    if (originUrl.origin === requestUrl.origin) return next();

    // Permit localhost/127.0.0.1 development across local ports only.
    if (isLoopbackHostname(originUrl.hostname) && isLoopbackHostname(requestUrl.hostname)) {
      return next();
    }

    return res.status(403).json({ error: "Cross-site request blocked." });
  } catch {
    return res.status(403).json({ error: "Cross-site request blocked." });
  }
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
    const token = parseCookies(req)[SESSION_COOKIE];
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
    if (!row) {
      clearSessionCookie(req, res);
      return res.status(401).json({ error: "Session expired." });
    }

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

app.use("/api", sameOriginOnly);

app.get("/api/health", async (_req, res, next) => {
  try {
    const rows = await sql`SELECT now() AS now`;
    res.json({ ok: true, database: true, now: rows[0]?.now });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/register", authRateLimit, async (req, res, next) => {
  try {
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

    await createSession(userId, req, res);
    res.status(201).json({ user: { id: userId, username } });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/login", authRateLimit, async (req, res, next) => {
  try {
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

    await createSession(user.id, req, res);
    res.json({ user: serialiseUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", async (req, res, next) => {
  try {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token) {
      await sql`DELETE FROM sessions WHERE token_hash = ${sessionHash(token)}`;
    }
    clearSessionCookie(req, res);
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

app.use(express.static(publicDir, {
  extensions: ["html"],
  maxAge: 0
}));

app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "API route not found." });
  }
  if (req.method !== "GET") return next();
  res.sendFile(path.join(publicDir, "index.html"));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = Number(error?.status) || 500;
  res.status(status).json({
    error: status >= 500 ? "Something went wrong on the server." : error.message
  });
});

await ensureSchema();
app.listen(PORT, () => {
  console.log(`ShowHub running on http://localhost:${PORT}`);
});
