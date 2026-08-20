# TV Archive — GitHub Pages frontend + Vercel API + Neon

## Architecture

- `public/` is published by GitHub Pages.
- `vercel-api/` is deployed as a Vercel Express project.
- Neon stores users, hashed session tokens, and watch history.
- The only user-defined Vercel environment variable is `DATABASE_URL`.

## 1. Set your GitHub Pages origin

Open `vercel-api/server.mjs` and replace:

```js
const GITHUB_PAGES_ORIGIN = "https://YOUR_GITHUB_USERNAME.github.io";
```

If the Pages site is:

```text
https://YOUR_GITHUB_USERNAME.github.io/TV-Show-Archive/
```

then the origin is only:

```text
https://YOUR_GITHUB_USERNAME.github.io
```

Do not include the repository path.

## 2. Deploy the API to Vercel

1. Push this project to GitHub.
2. In Vercel, create a new project and import the GitHub repository.
3. Set the Vercel project **Root Directory** to `vercel-api`.
4. Leave the normal Express/Node build settings at their defaults. There is no frontend output directory for the API.
5. In Project Settings → Environment Variables, add only:

```text
DATABASE_URL=<your Neon connection string>
```

6. Deploy.
7. Test:

```text
https://YOUR-VERCEL-PROJECT.vercel.app/api/health
```

It should return JSON with `"ok": true` and `"database": true`.

## 3. Connect GitHub Pages to Vercel

After Vercel gives you the production domain, edit `public/config.js`:

```js
window.SHOWHUB_API_BASE = "https://YOUR-VERCEL-PROJECT.vercel.app";
```

Do not add a trailing slash.

Commit and push. The included `.github/workflows/pages.yml` publishes `public/` to GitHub Pages.

## Authentication

The Pages build does not use cross-site cookies. Register/login returns a random bearer session token. The browser sends it in the `Authorization` header. Neon stores only a SHA-256 hash of the session token.

The session token is stored in the browser's localStorage so sign-in survives a refresh/browser restart. Passwords remain scrypt-hashed in the database.

## Local API development

Create `vercel-api/.env` containing only:

```text
DATABASE_URL=postgresql://...
```

Then:

```bash
cd vercel-api
npm install
npm run dev
```

For local frontend testing, temporarily point `public/config.js` at `http://localhost:3000`.

## Live Sports programme guide

The Live Sports tab includes an on-demand programme guide for the UK Sky Sports channels. Opening **Schedule** fetches today's or tomorrow's listings through the Vercel API and caches the result briefly. The guide route does not query Neon, and the database schema is initialised lazily so opening a sports schedule on its own does not wake the Neon compute.

International Sky Sport streams remain watchable, but a Schedule button is only shown where a reliable guide source has been mapped.
