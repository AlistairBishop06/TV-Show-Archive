# ShowHub + Neon username accounts and cross-device watch history

This version turns the ShowHub template into a small full-stack Node app. The browser UI still contains the streaming catalogue/player experience, while username/password credentials and watch progress go through a server API that talks to Neon Postgres. Playback URLs are only returned to authenticated sessions.

## What was added

- Create account with username and password
- Sign in / sign out with username + password
- 30-day server-side sessions using an HttpOnly cookie
- Password hashing with Node's `scrypt`
- Session tokens are random and only their SHA-256 hashes are stored in Postgres
- Account menu and sync status in the ShowHub header
- `Currently Watching` stored per user in Neon
- Progress updates sync while playback is running
- Playback is blocked until the user signs in
- The playable embed URL is returned only by an authenticated server API
- Removing a title from `Currently Watching` removes it from the account database
- Existing localStorage watch history is merged into the user's account on first sign-in
- Returning on another device downloads that account's watch history and resume position
- Database tables/indexes are created automatically when the server starts

## Project structure

```text
showhub-neon-account-sync/
├── public/
│   └── index.html
├── server.mjs
├── schema.sql
├── package.json
├── .env.example
└── README.md
```

## 1. Create a Neon database

Create a Neon project/database and copy its **pooled connection string** from the Neon dashboard. It looks similar to:

```text
postgresql://USER:PASSWORD@YOUR-ENDPOINT-pooler.REGION.aws.neon.tech/DBNAME?sslmode=require
```

Do not put this value in `public/index.html` or any browser JavaScript.

## 2. Configure the app

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env
```

Edit `.env` and set only your Neon connection string:

```env
DATABASE_URL=your_neon_connection_string
```

No other environment variables are required. ShowHub always runs on port `3000`, derives same-origin checks from the incoming request, and automatically marks session cookies `Secure` when served over HTTPS.

## 3. Run it

Development (reads `.env` automatically):

```bash
npm run dev
```

Then open:

```text
http://localhost:3000
```

For a production host where environment variables are configured by the platform:

```bash
npm start
```

## Database schema

The server automatically creates `users`, `sessions`, and `watch_history` tables. `schema.sql` is included so you can inspect or apply the schema manually if you prefer.

`watch_history` uses `(user_id, imdb_id)` as its primary key. Newer playback updates replace older ones, which prevents an older device/local migration from overwriting more recent progress.

## How cross-device progress works

1. While logged out, ShowHub continues to use the existing localStorage history.
2. When a user registers/signs in with a username and password, ShowHub downloads their Neon watch history.
3. Any existing local history is merged by `imdbId` and `lastWatched`, uploaded to Neon, then removed from the generic local history store.
4. Before playback, the browser requests `/api/playback-url`; the server returns a player URL only for a valid signed-in session.
5. Playback progress is written to `/api/watch-history/:imdbId` and upserted for the signed-in user.
6. On another device, signing into the same account loads those rows and rebuilds `Currently Watching` with the saved season, episode, timestamp, poster, and metadata.

## API endpoints

```text
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me

GET    /api/playback-url        # requires sign-in
GET    /api/watch-history
PUT    /api/watch-history/:imdbId
POST   /api/watch-history/sync
DELETE /api/watch-history/:imdbId

GET    /api/health
```

## Production notes

- Serve the app over HTTPS in production; ShowHub automatically marks the session cookie `Secure` on HTTPS requests.
- Keep `DATABASE_URL` only in your hosting provider's server-side environment variables.
- The included auth throttling is in-memory and is suitable as a basic safeguard for one app process. At larger scale, use a shared rate limiter (for example Redis/provider rate limiting).
- This username/password version intentionally has no email address, so there is no email-based password recovery. Add an account recovery mechanism and MFA before treating the identity system as production-complete.

## Quick database check

Once the app is running, opening `/api/health` should return JSON similar to:

```json
{
  "ok": true,
  "database": true,
  "now": "..."
}
```

If it fails, check `DATABASE_URL` and that your Neon project is active.


## Upgrading from the earlier email build

`ensureSchema()` upgrades the old `users` table automatically. It adds `username`, gives any pre-existing row a generated `user_<id>` username, then removes the old `email` and `display_name` columns. New accounts use only username + password. For test accounts created with the old email build, it is usually simplest to create a fresh username account after this upgrade.

## Local development origin note

Use `http://localhost:3000` (or consistently use `127.0.0.1`) to avoid cookie/origin confusion. Development mode now accepts loopback origins on local ports, but keeping the same hostname is still the most reliable setup.
