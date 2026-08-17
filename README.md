# ShowHub

A lightweight, browser-based movie and TV catalogue with search, filtering, episode browsing, embedded playback and local watch-progress tracking.

ShowHub is built entirely with **HTML, CSS and vanilla JavaScript**. There is no framework, package manager, database or build step — open the page and the app loads its catalogue dynamically from public metadata services.

## Features

- **Movies and TV shows in one catalogue**
- **Live search** across both media types
- **Detailed filtering** by:
  - media type
  - genre
  - runtime
  - episode count
  - season count
  - release year
  - minimum rating
  - TV status
- **Multiple sorting options**, including rating, release year, title, runtime and episode count
- **TV season and episode browser**
- **Embedded movie and episode playback**
- **Continue Watching** section with saved playback position
- **Automatic resume** from the previous watch position
- **Local watch history** stored entirely in the browser
- **Metadata caching** to reduce unnecessary API requests
- **Background metadata preloading** for faster filtering
- **Responsive interface** for desktop and mobile
- **Keyboard-accessible cards and controls**
- **Lazy-loaded poster artwork**
- **No account or backend required**

## How It Works

ShowHub combines multiple services to build the catalogue and playback experience:

| Service | Purpose |
| --- | --- |
| [TVMaze](https://www.tvmaze.com/api) | TV catalogue, search, show metadata and episode information |
| [Cinemeta](https://v3-cinemeta.strem.io/) | Movie catalogue, movie search and additional movie/series metadata |
| [VidFast](https://vidfast.vc/) | Embedded movie and TV playback |
| Browser `localStorage` | Watch history, playback progress and cached metadata |

The application loads TV shows and films independently, normalises them into a shared catalogue format, then renders them through the same search, filter and sorting interface.

## Getting Started

### 1. Clone the repository

```bash
git clone <your-repository-url>
cd <your-repository-folder>
```

### 2. Open the app

Because ShowHub has no build process, you can open the HTML file directly in a browser.

For the most reliable behaviour, serve it through a small local HTTP server:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

You can also use any static hosting service such as GitHub Pages, Netlify or Vercel.

## Project Structure

The current version is intentionally self-contained:

```text
.
├── index.html
└── README.md
```

`index.html` contains the complete application:

- page structure
- responsive styling
- catalogue state
- API integration
- search and filters
- metadata caching
- watch history
- episode selection
- player integration

This makes the project easy to deploy as a static site and simple to experiment with.

## Catalogue

On startup, ShowHub fetches:

- paginated TV shows from TVMaze
- top movies from Cinemeta

The two sources are combined into a single catalogue.

Additional pages can be fetched using the **Load more titles** button.

Only titles with the identifiers required for playback are added to the playable catalogue.

## Search

Search requests are sent to both the TV and movie sources and the results are merged into one list.

The search input is debounced so requests are not sent on every individual keystroke.

Clearing the search returns the user to the currently loaded catalogue.

## Filters

ShowHub supports the following filters:

| Filter | Options |
| --- | --- |
| Type | Movies & TV, TV only, movies only |
| Genre | Dynamically generated from loaded titles |
| Length | Under 30 min, 30–60 min, 1–2 hours, 2+ hours |
| Episodes | 1–10, 11–25, 26–50, 51–100, 100+ |
| Seasons | 1, 2–3, 4–6, 7+ |
| Release year | 2020s, 2010s, 2000s, 1990s, before 1990 |
| Minimum rating | 6+, 7+, 8+, 9+ |
| TV status | Running or ended |
| Order | Rating, year, title, runtime or episode count |

Episode, season and TV-status filters are automatically disabled when browsing movies only.

Some filters require richer metadata than the initial catalogue response provides. ShowHub fetches and caches that information in the background so the catalogue can remain responsive.

## TV Shows

Selecting a TV series opens a modal containing:

- show artwork
- show description
- season selector
- numbered episode list
- episode titles
- quick play button

Episode data is loaded from TVMaze when the show is opened.

Selecting an episode launches it inside ShowHub's full-screen player.

## Movies

Selecting a movie launches it directly in the player.

If the movie has already been watched, ShowHub can resume playback from the previously saved position.

## Continue Watching

Playback progress is stored in the browser using `localStorage`.

Each saved entry can include:

- media type
- IMDb ID
- show ID
- title
- poster and backdrop
- season and episode
- episode name
- current playback time
- duration
- last watched time

The **Currently Watching** row displays recent titles with a progress bar and resume button.

Entries can also be removed directly from the row.

Because this data is local, there is:

- no account system
- no remote database
- no cross-device synchronisation

Clearing browser storage will also clear saved watch progress.

## Metadata Caching

ShowHub maintains separate browser caches for TV and movie metadata.

This is used to avoid repeatedly requesting information such as:

- episode counts
- season counts
- runtime
- genres
- ratings
- descriptions
- backdrop artwork

TV metadata uses different cache lifetimes depending on whether a series is still running or has ended.

The app also preloads useful metadata during browser idle time where supported.

## Player Integration

Movies and episodes are opened in an embedded iframe.

For supported player messages, ShowHub listens for playback events and records:

- current playback position
- duration
- pause events
- seek events
- completion

Progress writes are throttled during normal playback to avoid repeatedly writing to browser storage.

Messages are only accepted from the expected player origin and iframe window.

## Responsive Design

The interface adapts across screen sizes.

On smaller displays:

- the top navigation stacks vertically
- catalogue filters rearrange into fewer columns
- the catalogue moves to a two-column layout
- modal padding is reduced
- Continue Watching becomes horizontally scrollable

## Technology

```text
HTML5
CSS3
Vanilla JavaScript
Fetch API
Browser History API
localStorage
TVMaze API
Cinemeta API
VidFast embed
```

There are **no npm dependencies**.

## Deployment

Because the project is fully static, deployment only requires hosting the HTML file.

Suitable options include:

- GitHub Pages
- Netlify
- Vercel
- Cloudflare Pages
- any standard web server

No server-side runtime or environment variables are currently required.

## Privacy

ShowHub does not require an account.

Watch history and metadata caches are stored in the user's own browser through `localStorage`. The app does, however, communicate with external catalogue, metadata and playback services when loading content.

## Content Notice

ShowHub is a catalogue and player interface; it does not itself contain or host movie or television files.

Playback depends on the configured third-party provider. Anyone deploying or modifying the project should ensure that their use of external services and media complies with the applicable licences, terms and laws in their jurisdiction.

## Possible Future Improvements

- user accounts and cross-device watch history
- favourites and custom watchlists
- recently added and trending sections
- dedicated movie detail modal
- cast and crew information
- recommendations based on viewing history
- automatic next-episode playback
- subtitle and audio controls
- URL-based deep links for individual titles
- PWA/offline shell support
- backend proxy and API caching
- automated tests

## Contributing

Contributions, bug reports and feature ideas are welcome.

If you want to make a larger change, open an issue first to describe what you plan to add or modify.

---

Built as a simple, fast alternative to heavier media catalogue front ends — one page, no framework and no build step.
