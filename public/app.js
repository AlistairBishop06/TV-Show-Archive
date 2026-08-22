const TVMAZE_API = "https://api.tvmaze.com";
const CINEMETA_API = "https://v3-cinemeta.strem.io";
const APP_PAGE = document.body.dataset.page || "home";
const PAGE_TRANSITION_MS = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 160;
let pageNavigationPending = false;
const pageSkeleton = document.createElement("div");
const skeletonPageType = APP_PAGE === "auth"
  ? "auth"
  : APP_PAGE === "live"
    ? "live"
  : APP_PAGE === "discover"
      ? "discover"
      : APP_PAGE === "profile"
        ? "profile"
        : (["search", "collection"].includes(APP_PAGE) ? "utility" : "catalogue");
pageSkeleton.className = `page-skeleton ${skeletonPageType}`;
pageSkeleton.setAttribute("aria-hidden", "true");
const skeletonBlocks = (count, className) => Array.from(
  { length: count },
  () => `<div class="skeleton-block ${className}"></div>`
).join("");

if (skeletonPageType === "live") {
  pageSkeleton.innerHTML = `
    <div class="skeleton-main skeleton-live-main">
      <div class="skeleton-live-intro">
        <div class="skeleton-block skeleton-eyebrow"></div>
        <div class="skeleton-block skeleton-live-title"></div>
        <div class="skeleton-block skeleton-copy-line"></div>
      </div>
      <div class="skeleton-block skeleton-group-title"></div>
      <div class="skeleton-live-grid">
        ${skeletonBlocks(6, "skeleton-live-card")}
      </div>
      <div class="skeleton-block skeleton-group-title skeleton-group-title-secondary"></div>
      <div class="skeleton-live-grid">
        ${skeletonBlocks(4, "skeleton-live-card")}
      </div>
    </div>`;
} else if (skeletonPageType === "discover") {
  const discoverRows = Array.from({ length: 5 }, () => `
    <div class="skeleton-discover-row">
      <div class="skeleton-discover-copy">
        <div class="skeleton-block skeleton-discover-name"></div>
        <div class="skeleton-block skeleton-discover-meta"></div>
      </div>
      <div class="skeleton-block skeleton-discover-count"></div>
    </div>`).join("");
  pageSkeleton.innerHTML = `
    <div class="skeleton-main skeleton-discover-main">
      <div class="skeleton-block skeleton-eyebrow"></div>
      <div class="skeleton-block skeleton-discover-title"></div>
      <div class="skeleton-block skeleton-copy-line"></div>
      <div class="skeleton-discover-panel">
        <div class="skeleton-discover-panel-head">
          <div class="skeleton-block skeleton-discover-panel-title"></div>
          <div class="skeleton-block skeleton-discover-button"></div>
        </div>
        <div class="skeleton-discover-list">${discoverRows}</div>
      </div>
    </div>`;
} else if (skeletonPageType === "profile") {
  const profileStats = Array.from({ length: 4 }, () => `
    <div class="skeleton-profile-stat">
      <div class="skeleton-block skeleton-profile-stat-value"></div>
      <div class="skeleton-block skeleton-profile-stat-label"></div>
    </div>`).join("");
  const profileHistoryRows = Array.from({ length: 3 }, () => `
    <div class="skeleton-profile-history-row">
      <div class="skeleton-block skeleton-profile-poster"></div>
      <div class="skeleton-profile-history-copy">
        <div class="skeleton-block skeleton-profile-history-title"></div>
        <div class="skeleton-block skeleton-profile-history-meta"></div>
      </div>
    </div>`).join("");
  pageSkeleton.innerHTML = `
    <div class="skeleton-main skeleton-profile-main">
      <div class="skeleton-block skeleton-profile-back"></div>
      <div class="skeleton-eyebrow skeleton-block"></div>
      <div class="skeleton-block skeleton-profile-title"></div>
      <div class="skeleton-block skeleton-copy-line"></div>
      <div class="skeleton-profile-tabs">
        ${[82, 105, 88, 78].map(width => `<div class="skeleton-block skeleton-profile-tab" style="width:${width}px"></div>`).join("")}
      </div>
      <div class="skeleton-profile-identity">
        <div class="skeleton-block skeleton-profile-avatar"></div>
        <div class="skeleton-profile-identity-copy">
          <div class="skeleton-block skeleton-profile-kicker"></div>
          <div class="skeleton-block skeleton-profile-name"></div>
          <div class="skeleton-block skeleton-profile-email"></div>
        </div>
      </div>
      <div class="skeleton-profile-stats">${profileStats}</div>
      <div class="skeleton-profile-history">
        <div class="skeleton-profile-history-head">
          <div>
            <div class="skeleton-block skeleton-profile-section-title"></div>
            <div class="skeleton-block skeleton-profile-section-copy"></div>
          </div>
          <div class="skeleton-block skeleton-profile-action"></div>
        </div>
        <div class="skeleton-profile-history-list">${profileHistoryRows}</div>
      </div>
    </div>`;
} else {
  pageSkeleton.innerHTML = `
    <div class="skeleton-main">
      <div class="skeleton-block skeleton-hero"></div>
      <div class="skeleton-block skeleton-heading"></div>
      <div class="skeleton-block skeleton-panel"></div>
      <div class="skeleton-cards">
        ${skeletonBlocks(7, "skeleton-card")}
      </div>
    </div>`;
}
document.body.appendChild(pageSkeleton);
function syncSkeletonTop() {
  const headerHeight = document.querySelector("header")?.getBoundingClientRect().height || 69;
  document.documentElement.style.setProperty("--skeleton-top", `${Math.ceil(headerHeight)}px`);
}
syncSkeletonTop();
window.addEventListener("resize", syncSkeletonTop);
document.body.setAttribute("aria-busy", "true");
const HERO_TRAILER_CACHE = new Map();
let heroTrailerRequestId = 0;
let modalTrailerRequestId = 0;
let trailersMuted = true;
let hoverTrailerCard = null;
let hoverTrailerTimer = 0;
let hoverTrailerRequestId = 0;
const HOVER_TRAILER_DELAY_MS = 100;
const CARD_TRAILERS_ENABLED = window.matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)").matches;
const hoverTrailerPreview = document.createElement("div");
hoverTrailerPreview.className = "hover-trailer-preview";
hoverTrailerPreview.setAttribute("aria-hidden", "true");
document.body.appendChild(hoverTrailerPreview);
const HOME_PAGE_BATCH = 1;
const WATCH_HISTORY_KEY = "showhub-watch-history-v2";
const PENDING_WATCH_HISTORY_KEY_PREFIX = "showhub-pending-watch-progress-v1";
const AUTH_TOKEN_KEY = "showhub-auth-token-v1";
const AUTH_USER_CACHE_KEY = "showhub-auth-user-v1";
const LEGACY_WATCH_HISTORY_KEY = "showhub-watch-history-v1";
const MAX_WATCH_HISTORY = 40;
const MIN_ITEMS_PER_GENRE_ROW = 5;
const MAX_GENRE_ROWS = 12;
const MAX_ITEMS_PER_ROW = 20;
const LIVE_STREAM_BASE = "https://dlstreams.st/stream/stream-";
const LIVE_SPORTS_CHANNELS = [
  { name: "Sky Sports Football UK", id: 35, region: "United Kingdom", guideSid: 3096 },
  { name: "Sky Sports+ Plus", id: 36, region: "United Kingdom", guideSid: 3097 },
  { name: "Sky Sports Action UK", id: 37, region: "United Kingdom", guideSid: 1703 },
  { name: "Sky Sports Main Event", id: 38, region: "United Kingdom", guideSid: 1701 },
  { name: "Sky Sports Tennis UK", id: 46, region: "United Kingdom", guideSid: 1705 },
  { name: "Sky Sports Premier League", id: 130, region: "United Kingdom", guideSid: 1010 },
  { name: "Sky Sports F1 UK", id: 60, region: "United Kingdom", guideSid: 3835 },
  { name: "Sky Sports Cricket", id: 65, region: "United Kingdom", guideSid: 1702 },
  { name: "Sky Sports Golf UK", id: 70, region: "United Kingdom", guideSid: 1094 },
  { name: "Sky Sports News UK", id: 366, region: "United Kingdom", guideSid: 1340 },
  { name: "Sky Sports Mix UK", id: 449, region: "United Kingdom", guideSid: 4090 },
  { name: "Sky Sports Racing UK", id: 554, region: "United Kingdom", guideSid: 4032 },

  { name: "Sky Sports 1 DE", id: 240, region: "Germany & Austria" },
  { name: "Sky Sports 2 DE", id: 241, region: "Germany & Austria" },
  { name: "Sky Sport Top Event DE", id: 556, region: "Germany & Austria" },
  { name: "Sky Sport Mix DE", id: 557, region: "Germany & Austria" },
  { name: "Sky Sport Bundesliga 1 HD", id: 558, region: "Germany & Austria" },
  { name: "Sky Sport Austria 1 HD", id: 559, region: "Germany & Austria" },
  { name: "Sky Sport Bundesliga 2", id: 946, region: "Germany & Austria" },
  { name: "Sky Sport Bundesliga 3", id: 947, region: "Germany & Austria" },
  { name: "Sky Sport Bundesliga 4", id: 948, region: "Germany & Austria" },
  { name: "Sky Sport Bundesliga 5", id: 949, region: "Germany & Austria" },

  { name: "Sky Sports Golf Italy", id: 574, region: "Italy" },
  { name: "Sky Sport MotoGP Italy", id: 575, region: "Italy" },
  { name: "Sky Sport Tennis Italy", id: 576, region: "Italy" },
  { name: "Sky Sport F1 Italy", id: 577, region: "Italy" },
  { name: "Sky Sport Max Italy", id: 460, region: "Italy" },
  { name: "Sky Sport Uno Italy", id: 461, region: "Italy" },
  { name: "Sky Sport Arena Italy", id: 462, region: "Italy" },

  { name: "Sky Sport Select NZ", id: 587, region: "New Zealand" },
  { name: "Sky Sport 1 NZ", id: 588, region: "New Zealand" },
  { name: "Sky Sport 2 NZ", id: 589, region: "New Zealand" },
  { name: "Sky Sport 3 NZ", id: 590, region: "New Zealand" },
  { name: "Sky Sport 4 NZ", id: 591, region: "New Zealand" },
  { name: "Sky Sport 5 NZ", id: 592, region: "New Zealand" },
  { name: "Sky Sport 6 NZ", id: 593, region: "New Zealand" },
  { name: "Sky Sport 7 NZ", id: 594, region: "New Zealand" },
  { name: "Sky Sport 8 NZ", id: 595, region: "New Zealand" },
  { name: "Sky Sport 9 NZ", id: 596, region: "New Zealand" }
];

// Every icon in the app is rendered from this shared set so glyphs are
// always the same 18x18 size, instead of relying on font-dependent
// Unicode characters (×, ←, ▶, ⌕) that render at inconsistent sizes.
const ICONS = {
  close: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>',
  chevronLeft: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
  chevronRight: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
  play: '<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  volumeOn: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18 6a8.5 8.5 0 0 1 0 12"/></svg>',
  volumeOff: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>'
};

const state = {
  homeShows: [],
  homeMovies: [],
  searchResults: null,
  searchTerm: "",
  nextHomePage: 0,
  nextMovieSkip: 0,
  tvHasMore: true,
  movieHasMore: true,
  currentShow: null,
  currentSeason: 1,
  currentEpisodes: [],
  searchTimer: null,
  loadingTV: false,
  loadingMovies: false,
  activePlayback: null,
  liveScheduleChannel: null,
  liveScheduleOffset: 0,
  liveSportsView: "featured",
  dlstreamsSchedule: null,
  dlstreamsScheduleLoading: false,
  dlstreamsScheduleQuery: "",
  dlstreamsScheduleCategory: "all",
  lastProgressWrite: 0,
  pendingEpisodeAdvance: false,
  episodeAdvanceInFlight: false,
  initialCatalogueLoading: true,
  initialCatalogueLoaded: false,
  typeScope: "all",
  heroMedia: null,
  activeCollection: null,
  user: null,
  watchHistory: [],
  authMode: "signin",
  accountSyncState: "idle",
  profileOpen: false,
  discoverOpen: false,
  profileTab: "overview",
  watchLater: [],
  userLists: [],
  discoverLists: [],
  discoverListItems: new Map(),
  expandedDiscoverLists: new Set(),
  modalMedia: null,
  personalLibraryLoaded: false
};

// Episode metadata is cached per TVMaze show ID. Keeping it keyed by show
// prevents season/episode names from leaking between titles that happen to
// share the same S/E numbers.
const episodeMetadataCache = new Map();

const el = id => document.getElementById(id);

const searchInput = el("searchInput");
const typeNav = el("typeNav");
const discoverListsTopButton = el("discoverListsTopButton");
const discoverSection = el("discoverSection");
const discoverPageBack = el("discoverPageBack");
const heroSection = el("heroSection");
const heroEyebrow = el("heroEyebrow");
const heroTitle = el("heroTitle");
const heroDescription = el("heroDescription");
const heroBg = el("heroBg");
const heroTrailer = el("heroTrailer");
const heroSoundToggle = el("heroSoundToggle");
const heroBrowse = el("heroBrowse");
const rowsContainer = el("rowsContainer");
const searchResultsSection = el("searchResultsSection");
const searchResultsTitle = el("searchResultsTitle");
const searchResultsCount = el("searchResultsCount");
const searchGrid = el("searchGrid");
const collectionSection = el("collectionSection");
const collectionBack = el("collectionBack");
const collectionTitle = el("collectionTitle");
const collectionCount = el("collectionCount");
const collectionGrid = el("collectionGrid");
const collectionActions = el("collectionActions");
const collectionLoadMoreButton = el("collectionLoadMoreButton");
const modalWrap = el("modalWrap");
const modalTitle = el("modalTitle");
const modalEyebrow = el("modalEyebrow");
const modalDescription = el("modalDescription");
const modalBanner = el("modalBanner");
const modalTrailer = el("modalTrailer");
const modalSoundToggle = el("modalSoundToggle");
const modalSelectorBar = el("modalSelectorBar");
const seasonLabel = el("seasonLabel");
const seasonSelect = el("seasonSelect");
const episodeGrid = el("episodeGrid");
const continueButton = el("continueButton");
const playerScreen = el("playerScreen");
const playerFrame = el("playerFrame");
const playerTitle = el("playerTitle");
const playerSubtitle = el("playerSubtitle");
const loadMoreButton = el("loadMoreButton");
const catalogueActions = el("catalogueActions");
const continueSection = el("continueSection");
const continueRow = el("continueRow");
const liveSportsSection = el("liveSportsSection");
const liveSportsContent = el("liveSportsContent");
const liveSportsFeaturedTab = el("liveSportsFeaturedTab");
const liveSportsAllTab = el("liveSportsAllTab");
const liveSportsFeaturedPanel = el("liveSportsFeaturedPanel");
const liveSportsAllPanel = el("liveSportsAllPanel");
const liveSportsAllReload = el("liveSportsAllReload");
const liveSportsAllMeta = el("liveSportsAllMeta");
const liveSportsAllSearch = el("liveSportsAllSearch");
const liveSportsAllCategories = el("liveSportsAllCategories");
const liveSportsAllStatus = el("liveSportsAllStatus");
const liveSportsAllContent = el("liveSportsAllContent");
const liveScheduleWrap = el("liveScheduleWrap");
const liveScheduleTitle = el("liveScheduleTitle");
const liveScheduleSubtitle = el("liveScheduleSubtitle");
const liveScheduleList = el("liveScheduleList");
const liveScheduleClose = el("liveScheduleClose");
const liveScheduleToday = el("liveScheduleToday");
const liveScheduleTomorrow = el("liveScheduleTomorrow");
const accountButton = el("accountButton");
const accountAvatar = el("accountAvatar");
const accountLabel = el("accountLabel");
const accountMenu = el("accountMenu");
const accountMenuName = el("accountMenuName");
const profileButton = el("profileButton");
const logoutButton = el("logoutButton");
const profileSection = el("profileSection");
const profileBack = el("profileBack");
const profileTabs = el("profileTabs");
const profileAvatar = el("profileAvatar");
const profileUsername = el("profileUsername");
const profileMemberSince = el("profileMemberSince");
const profilePictureInput = el("profilePictureInput");
const profilePictureRemove = el("profilePictureRemove");
const profilePictureMessage = el("profilePictureMessage");
const profileStatTitles = el("profileStatTitles");
const profileStatWatchLater = el("profileStatWatchLater");
const profileStatLists = el("profileStatLists");
const profileStatLatest = el("profileStatLatest");
const profileHistoryList = el("profileHistoryList");
const profileClearHistory = el("profileClearHistory");
const watchLaterGrid = el("watchLaterGrid");
const createListForm = el("createListForm");
const createListName = el("createListName");
const createListPublic = el("createListPublic");
const createListMessage = el("createListMessage");
const myListsContainer = el("myListsContainer");
const discoverListsContainer = el("discoverListsContainer");
const discoverListsRefresh = el("discoverListsRefresh");
const discoverListIndex = el("discoverListIndex");
const discoverListDetail = el("discoverListDetail");
const discoverListBack = el("discoverListBack");
const discoverListTitle = el("discoverListTitle");
const discoverListOwner = el("discoverListOwner");
const discoverListItems = el("discoverListItems");
const profileUsernameForm = el("profileUsernameForm");
const profileNewUsername = el("profileNewUsername");
const profileUsernamePassword = el("profileUsernamePassword");
const profileUsernameMessage = el("profileUsernameMessage");
const profilePasswordForm = el("profilePasswordForm");
const profileCurrentPassword = el("profileCurrentPassword");
const profileNewPassword = el("profileNewPassword");
const profileConfirmPassword = el("profileConfirmPassword");
const profilePasswordMessage = el("profilePasswordMessage");
const profileLogoutButton = el("profileLogoutButton");
const watchLaterButton = el("watchLaterButton");
const addToListButton = el("addToListButton");
const modalListPicker = el("modalListPicker");
const modalListPickerOptions = el("modalListPickerOptions");
const authModalWrap = el("authModalWrap");
const authClose = el("authClose");
const authTitle = el("authTitle");
const authSubtitle = el("authSubtitle");
const authSignInTab = el("authSignInTab");
const authRegisterTab = el("authRegisterTab");
const authForm = el("authForm");
const authUsername = el("authUsername");
const authPassword = el("authPassword");
const authError = el("authError");
const authSubmit = el("authSubmit");

const cachedAccountUser = getAuthToken() ? readCachedAccountUser() : null;
if (cachedAccountUser) setAccountUser(cachedAccountUser, { persist: false });

function migrateWatchHistory() {
  if (localStorage.getItem(WATCH_HISTORY_KEY)) return;
  const legacy = localStorage.getItem(LEGACY_WATCH_HISTORY_KEY);
  if (!legacy) return;

  try {
    const entries = JSON.parse(legacy);
    if (!Array.isArray(entries)) return;
    const migrated = entries.map(entry => ({
      ...entry,
      mediaType: entry.mediaType || "tv"
    }));
    localStorage.setItem(WATCH_HISTORY_KEY, JSON.stringify(migrated));
  } catch {
    // Leave broken legacy data alone rather than preventing the app loading.
  }
}

function normaliseHistoryList(entries) {
  return [...(Array.isArray(entries) ? entries : [])]
    .filter(entry => entry?.imdbId)
    .sort((a, b) => (b.lastWatched || 0) - (a.lastWatched || 0))
    .slice(0, MAX_WATCH_HISTORY);
}

function readLocalWatchHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(WATCH_HISTORY_KEY) || "[]");
    return normaliseHistoryList(parsed);
  } catch {
    return [];
  }
}

function writeLocalWatchHistory(entries) {
  localStorage.setItem(WATCH_HISTORY_KEY, JSON.stringify(normaliseHistoryList(entries)));
}

function getPendingWatchHistoryKey() {
  return state.user?.id
    ? `${PENDING_WATCH_HISTORY_KEY_PREFIX}:${state.user.id}`
    : "";
}

function readPendingWatchHistory() {
  const key = getPendingWatchHistoryKey();
  if (!key) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return normaliseHistoryList(parsed);
  } catch {
    return [];
  }
}

function writePendingWatchHistory(entries) {
  const key = getPendingWatchHistoryKey();
  if (!key) return;
  const normalised = normaliseHistoryList(entries);
  if (normalised.length) {
    localStorage.setItem(key, JSON.stringify(normalised));
  } else {
    localStorage.removeItem(key);
  }
}

function cachePendingWatchEntry(entry) {
  if (!entry?.imdbId) return;
  const pending = readPendingWatchHistory();
  const withoutCurrent = pending.filter(item => item.imdbId !== entry.imdbId);
  writePendingWatchHistory([entry, ...withoutCurrent]);
}

function clearPendingWatchEntry(imdbId, syncedLastWatched = Infinity) {
  if (!imdbId) return;
  const pending = readPendingWatchHistory();
  const remaining = pending.filter(item =>
    item.imdbId !== imdbId || Number(item.lastWatched || 0) > Number(syncedLastWatched)
  );
  writePendingWatchHistory(remaining);
}

function getWatchHistory() {
  return state.user ? state.watchHistory : [];
}

function setWatchHistory(entries) {
  if (!state.user) return;
  state.watchHistory = normaliseHistoryList(entries);
}

function mergeHistoryLists(...lists) {
  const merged = new Map();
  lists.flat().forEach(entry => {
    if (!entry?.imdbId) return;
    const existing = merged.get(entry.imdbId);
    if (!existing || Number(entry.lastWatched || 0) >= Number(existing.lastWatched || 0)) {
      merged.set(entry.imdbId, entry);
    }
  });
  return normaliseHistoryList([...merged.values()]);
}

function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || "";
}

function saveAuthToken(token) {
  if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
  else localStorage.removeItem(AUTH_TOKEN_KEY);
}

function readCachedAccountUser() {
  try {
    const user = JSON.parse(localStorage.getItem(AUTH_USER_CACHE_KEY) || "null");
    return user?.id && user?.username ? user : null;
  } catch {
    return null;
  }
}

function cacheAccountUser(user) {
  try {
    if (user) localStorage.setItem(AUTH_USER_CACHE_KEY, JSON.stringify(user));
    else localStorage.removeItem(AUTH_USER_CACHE_KEY);
  } catch {
    // The authenticated session still works if local storage is unavailable.
  }
}

function clearAuthSession() {
  saveAuthToken("");
  const wasUtilityPageOpen = state.profileOpen || state.discoverOpen;
  if (state.profileOpen) {
    state.profileOpen = false;
    profileSection.style.display = "none";
    profileSection.setAttribute("aria-hidden", "true");
  }
  if (state.discoverOpen) {
    state.discoverOpen = false;
    discoverSection.style.display = "none";
    discoverSection.setAttribute("aria-hidden", "true");
    discoverListsTopButton.classList.remove("active");
  }
  setAccountUser(null);
  if (wasUtilityPageOpen) restoreBrowseAfterUtilityPage();
}

async function apiFetch(path, options = {}) {
  const apiBase = String(window.SHOWHUB_API_BASE || "").replace(/\/+$/, "");
  if (!apiBase || apiBase.includes("YOUR-VERCEL-PROJECT")) {
    const error = new Error("TV Archive API is not configured. Set SHOWHUB_API_BASE in public/config.js.");
    error.status = 0;
    throw error;
  }

  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function setAccountSyncState(mode, _message = "") {
  state.accountSyncState = mode;
}

function formatProfileDate(value, fallback = "—") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(date);
}

function formatProfileActivity(value) {
  const date = new Date(Number(value || 0));
  if (Number.isNaN(date.getTime()) || !Number(value)) return "—";
  const now = Date.now();
  const diffDays = Math.floor((now - date.getTime()) / 86400000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatProfileDate(date);
}

function profileEpisodeLabel(entry) {
  if (entry?.mediaType === "movie") return "Film";
  const bits = [];
  if (Number(entry?.season) > 0 && Number(entry?.episode) > 0) {
    bits.push(`S${entry.season} · E${entry.episode}`);
  }
  if (entry?.episodeName) bits.push(entry.episodeName);
  return bits.join(" · ") || "TV series";
}

function renderAvatar(target, user, alt = "Profile picture") {
  if (!target) return;
  const picture = String(user?.profilePicture || "");
  const username = String(user?.username || "Account");
  if (picture) {
    target.innerHTML = `<img src="${escapeHtml(picture)}" alt="${escapeHtml(alt)}" />`;
  } else {
    target.textContent = username.trim().charAt(0).toUpperCase() || "A";
  }
}

function libraryItemFromMedia(media) {
  return {
    imdbId: getImdbId(media),
    mediaType: getMediaType(media),
    showId: getMediaType(media) === "tv" ? Number(media?.id || 0) || null : null,
    name: getMediaName(media),
    poster: getMediaPoster(media),
    backdrop: getMediaBackdrop(media),
    summary: getMediaSummary(media),
    year: getMediaYear(media)
  };
}

function libraryItemToMedia(item) {
  if (item?.mediaType === "movie") {
    return {
      mediaType: "movie",
      imdbId: item.imdbId,
      id: item.imdbId,
      name: item.name,
      title: item.name,
      poster: item.poster || "",
      backdrop: item.backdrop || item.poster || "",
      summary: item.summary || "",
      year: item.year || ""
    };
  }
  return {
    mediaType: "tv",
    id: Number(item?.showId || 0) || null,
    name: item?.name || "Untitled",
    summary: item?.summary || "",
    premiered: item?.year ? `${item.year}-01-01` : "",
    externals: { imdb: item?.imdbId || "" },
    image: { medium: item?.poster || "", original: item?.backdrop || item?.poster || "" }
  };
}

async function openSavedLibraryItem(item) {
  if (!item) return;
  if (item.mediaType === "movie") {
    openMovieDetails(libraryItemToMedia(item));
    return;
  }
  let media = libraryItemToMedia(item);
  if (!media.id && item.imdbId) {
    try {
      const lookedUp = await fetchJson(`${TVMAZE_API}/lookup/shows?imdb=${encodeURIComponent(item.imdbId)}`);
      media = { ...lookedUp, mediaType: "tv" };
      item.showId = Number(lookedUp?.id || 0) || null;
    } catch (error) {
      console.error("Could not resolve saved TV title", error);
    }
  }
  if (validPlayableShow(media)) openShow(media);
}

function renderLibraryGrid(container, items, { removable = false, removeHandler = null } = {}) {
  if (!container) return;
  if (!items?.length) {
    container.innerHTML = '<div class="profile-empty">No titles here yet.</div>';
    return;
  }
  const mediaById = new Map(items.map(item => [String(item.imdbId), libraryItemToMedia(item)]));
  container.innerHTML = items.map(item => cardMarkup(
    mediaById.get(String(item.imdbId)),
    "card library-card",
    { libraryId: item.imdbId, removable }
  )).join("");

  container.querySelectorAll("[data-library-id]").forEach(card => {
    const libraryId = card.dataset.libraryId;
    const item = items.find(entry => String(entry.imdbId) === String(libraryId));
    const media = mediaById.get(String(libraryId));
    const open = () => {
      stopHoverTrailer(card);
      openSavedLibraryItem(item);
    };

    card.addEventListener("click", event => {
      if (event.target.closest("[data-library-remove]")) return;
      open();
    });
    card.addEventListener("keydown", event => {
      if (event.target.closest("[data-library-remove]")) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });

    if (media) bindHoverTrailer(card, media);
  });

  container.querySelectorAll("[data-library-remove]").forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();
      stopHoverTrailer(button.closest("[data-library-id]"));
      removeHandler?.(button.dataset.libraryRemove);
    });
    button.addEventListener("keydown", event => event.stopPropagation());
  });
}

function setProfileTab(tab) {
  const target = ["overview", "watch-later", "my-lists", "account"].includes(tab) ? tab : "overview";
  state.profileTab = target;
  profileTabs.querySelectorAll("[data-profile-tab]").forEach(button => {
    button.classList.toggle("active", button.dataset.profileTab === target);
  });
  profileSection.querySelectorAll("[data-profile-panel]").forEach(panel => {
    panel.classList.toggle("active", panel.dataset.profilePanel === target);
  });
}

async function loadPersonalLibraryData({ includeDiscover = true } = {}) {
  if (!state.user) return;
  const requests = [apiFetch("/api/watch-later"), apiFetch("/api/lists")];
  if (includeDiscover) requests.push(apiFetch("/api/lists/discover"));
  const results = await Promise.all(requests);
  state.watchLater = Array.isArray(results[0]?.entries) ? results[0].entries : [];
  state.userLists = Array.isArray(results[1]?.lists) ? results[1].lists : [];
  if (includeDiscover) state.discoverLists = Array.isArray(results[2]?.lists) ? results[2].lists : [];
}

async function ensurePersonalLibraryLoaded() {
  if (!state.user) return false;
  if (state.personalLibraryLoaded) return true;
  await loadPersonalLibraryData({ includeDiscover: false });
  state.personalLibraryLoaded = true;
  return true;
}

function renderProfilePage() {
  if (!state.user) return;
  const history = getWatchHistory();
  const latest = history.reduce((max, entry) => Math.max(max, Number(entry.lastWatched || 0)), 0);
  const username = state.user.username || "Account";

  renderAvatar(profileAvatar, state.user);
  profileUsername.textContent = username;
  profileMemberSince.textContent = state.user.createdAt
    ? `Account created ${formatProfileDate(state.user.createdAt)}`
    : "Account creation date unavailable";
  profilePictureRemove.disabled = !state.user.profilePicture;
  profileStatTitles.textContent = String(history.length);
  profileStatWatchLater.textContent = String(state.watchLater.length);
  profileStatLists.textContent = String(state.userLists.length);
  profileStatLatest.textContent = formatProfileActivity(latest);
  profileClearHistory.disabled = history.length === 0;

  if (!history.length) {
    profileHistoryList.innerHTML = '<div class="profile-history-empty">Nothing in Currently Watching yet.</div>';
  } else {
    profileHistoryList.innerHTML = history.map(entry => {
      const duration = Number(entry.duration || 0);
      const current = Number(entry.currentTime || 0);
      const progress = duration > 0 ? Math.max(0, Math.min(100, (current / duration) * 100)) : 0;
      return `
        <div class="profile-history-item" data-profile-history-id="${escapeHtml(entry.imdbId)}">
          ${entry.poster
            ? `<img class="profile-history-poster" src="${escapeHtml(entry.poster)}" alt="" loading="lazy" />`
            : '<div class="profile-history-poster"></div>'}
          <div class="profile-history-copy">
            <div class="profile-history-title">${escapeHtml(entry.name || "Untitled")}</div>
            <div class="profile-history-meta">${escapeHtml(profileEpisodeLabel(entry))} · ${formatProfileActivity(entry.lastWatched)}</div>
            <div class="profile-history-progress"><span style="width:${progress.toFixed(2)}%"></span></div>
          </div>
          <button class="profile-remove-button" type="button" data-profile-remove="${escapeHtml(entry.imdbId)}">Remove</button>
        </div>`;
    }).join("");
    profileHistoryList.querySelectorAll("[data-profile-remove]").forEach(button => {
      button.addEventListener("click", () => {
        const entry = getWatchHistory().find(item => item.imdbId === button.dataset.profileRemove);
        if (!entry) return;
        removeWatchEntry(entry);
        renderProfilePage();
      });
    });
  }
  renderWatchLater();
  renderMyLists();
  renderDiscoverLists();
}

function renderWatchLater() {
  renderLibraryGrid(watchLaterGrid, state.watchLater, {
    removable: true,
    removeHandler: removeWatchLaterItem
  });
}

async function removeWatchLaterItem(imdbId) {
  if (!state.user) return;
  try {
    await apiFetch(`/api/watch-later/${encodeURIComponent(imdbId)}`, { method: "DELETE" });
    state.watchLater = state.watchLater.filter(item => item.imdbId !== imdbId);
    renderProfilePage();
    if (state.modalMedia && getImdbId(state.modalMedia) === imdbId) updateModalLibraryActions(state.modalMedia);
  } catch (error) {
    window.alert(error.message || "Could not remove this title from Watch Later.");
  }
}

function renderMyLists() {
  if (!myListsContainer) return;
  if (!state.userLists.length) {
    myListsContainer.innerHTML = '<div class="profile-empty">You have not created any lists yet.</div>';
    return;
  }
  myListsContainer.innerHTML = state.userLists.map(list => `
    <article class="user-list-card" data-user-list="${escapeHtml(list.id)}">
      <div class="user-list-head">
        <div><strong>${escapeHtml(list.name)}</strong><div class="user-list-meta">${list.isPublic ? "Public" : "Private"} · ${(list.items || []).length} title${(list.items || []).length === 1 ? "" : "s"}</div></div>
        <div class="user-list-actions">
          <button type="button" data-list-rename>Rename</button>
          <button type="button" data-list-visibility>${list.isPublic ? "Make private" : "Make public"}</button>
          <button type="button" class="danger" data-list-delete>Delete</button>
        </div>
      </div>
      <div class="user-list-items"><div class="library-grid" data-list-items></div></div>
    </article>`).join("");
  myListsContainer.querySelectorAll("[data-user-list]").forEach(card => {
    const list = state.userLists.find(item => String(item.id) === String(card.dataset.userList));
    if (!list) return;
    renderLibraryGrid(card.querySelector("[data-list-items]"), list.items || [], {
      removable: true,
      removeHandler: imdbId => removeItemFromList(list.id, imdbId)
    });
    card.querySelector("[data-list-rename]").addEventListener("click", () => renameList(list));
    card.querySelector("[data-list-visibility]").addEventListener("click", () => updateListVisibility(list));
    card.querySelector("[data-list-delete]").addEventListener("click", () => deleteList(list));
  });
}

async function createUserList(event) {
  event.preventDefault();
  createListMessage.textContent = "";
  const submit = createListForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const data = await apiFetch("/api/lists", {
      method: "POST",
      body: JSON.stringify({ name: createListName.value.trim(), isPublic: createListPublic.checked })
    });
    state.userLists.unshift(data.list);
    createListForm.reset();
    createListPublic.checked = true;
    createListMessage.textContent = "List created.";
    createListMessage.classList.add("success");
    renderProfilePage();
  } catch (error) {
    createListMessage.textContent = error.message || "Could not create list.";
    createListMessage.classList.remove("success");
  } finally { submit.disabled = false; }
}

async function renameList(list) {
  const name = window.prompt("Rename list", list.name);
  if (name === null || !name.trim() || name.trim() === list.name) return;
  try {
    const data = await apiFetch(`/api/lists/${encodeURIComponent(list.id)}`, {
      method: "PATCH", body: JSON.stringify({ name: name.trim(), isPublic: list.isPublic })
    });
    Object.assign(list, data.list);
    renderProfilePage();
  } catch (error) { window.alert(error.message || "Could not rename list."); }
}

async function updateListVisibility(list) {
  try {
    const data = await apiFetch(`/api/lists/${encodeURIComponent(list.id)}`, {
      method: "PATCH", body: JSON.stringify({ name: list.name, isPublic: !list.isPublic })
    });
    Object.assign(list, data.list);
    renderProfilePage();
  } catch (error) { window.alert(error.message || "Could not change list visibility."); }
}

async function deleteList(list) {
  if (!window.confirm(`Delete “${list.name}”?`)) return;
  try {
    await apiFetch(`/api/lists/${encodeURIComponent(list.id)}`, { method: "DELETE" });
    state.userLists = state.userLists.filter(item => String(item.id) !== String(list.id));
    renderProfilePage();
  } catch (error) { window.alert(error.message || "Could not delete list."); }
}

async function removeItemFromList(listId, imdbId) {
  try {
    await apiFetch(`/api/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(imdbId)}`, { method: "DELETE" });
    const list = state.userLists.find(item => String(item.id) === String(listId));
    if (list) list.items = (list.items || []).filter(item => item.imdbId !== imdbId);
    renderProfilePage();
  } catch (error) { window.alert(error.message || "Could not remove this title from the list."); }
}

function renderDiscoverLists() {
  if (!discoverListsContainer || !discoverListIndex || !discoverListDetail) return;
  discoverListIndex.hidden = false;
  discoverListDetail.hidden = true;
  if (!state.discoverLists.length) {
    discoverListsContainer.innerHTML = '<div class="profile-empty">No public lists have been shared yet.</div>';
    return;
  }
  discoverListsContainer.innerHTML = state.discoverLists.map(list => `
    <section class="discover-list-entry${state.expandedDiscoverLists.has(String(list.id)) ? " open" : ""}" data-discover-entry="${escapeHtml(list.id)}">
      <button class="discover-list-card" type="button" data-discover-list="${escapeHtml(list.id)}"
        aria-expanded="${state.expandedDiscoverLists.has(String(list.id))}" aria-controls="discover-list-panel-${escapeHtml(list.id)}">
        <div><strong>${escapeHtml(list.name)}</strong><div class="discover-list-meta">by ${escapeHtml(list.owner || "TV Archive user")}</div></div>
        <div class="discover-list-summary">
          <span class="discover-list-meta">${Number(list.itemCount || 0)} title${Number(list.itemCount || 0) === 1 ? "" : "s"}</span>
          <svg class="discover-list-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </button>
      <div id="discover-list-panel-${escapeHtml(list.id)}" class="discover-list-expansion" aria-hidden="${!state.expandedDiscoverLists.has(String(list.id))}"${state.expandedDiscoverLists.has(String(list.id)) ? "" : " inert"}>
        <div class="discover-list-expansion-inner">
          <div class="discover-list-toolbar">
            <button class="discover-list-share" type="button" data-discover-share="${escapeHtml(list.id)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.5" x2="15.4" y2="6.5"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/></svg>
              <span>Share list</span>
            </button>
          </div>
          <div class="discover-inline-status">Loading titles...</div>
          <div class="library-grid discover-inline-grid"></div>
        </div>
      </div>
    </section>`).join("");
  discoverListsContainer.querySelectorAll("[data-discover-list]").forEach(button => {
    button.addEventListener("click", () => toggleDiscoverList(button.dataset.discoverList));
  });
  discoverListsContainer.querySelectorAll("[data-discover-share]").forEach(button => {
    button.addEventListener("click", () => shareDiscoverList(button.dataset.discoverShare, button));
  });
  state.expandedDiscoverLists.forEach(listId => renderExpandedDiscoverList(listId));
}

async function refreshDiscoverLists() {
  discoverListsRefresh.disabled = true;
  try {
    const data = await apiFetch("/api/lists/discover");
    state.discoverLists = Array.isArray(data?.lists) ? data.lists : [];
    state.discoverListItems.clear();
    state.expandedDiscoverLists.clear();
    syncDiscoverListUrl(null);
    renderDiscoverLists();
  } catch (error) { window.alert(error.message || "Could not load public lists."); }
  finally { discoverListsRefresh.disabled = false; }
}

function setDiscoverListExpanded(listId, expanded) {
  const normalizedId = String(listId);
  const entry = discoverListsContainer.querySelector(`[data-discover-entry="${CSS.escape(normalizedId)}"]`);
  if (!entry) return;
  const button = entry.querySelector("[data-discover-list]");
  const panel = entry.querySelector(".discover-list-expansion");
  entry.classList.toggle("open", expanded);
  button?.setAttribute("aria-expanded", String(expanded));
  panel?.setAttribute("aria-hidden", String(!expanded));
  if (expanded) panel?.removeAttribute("inert");
  else panel?.setAttribute("inert", "");
}

function renderExpandedDiscoverList(listId) {
  const normalizedId = String(listId);
  const entry = discoverListsContainer.querySelector(`[data-discover-entry="${CSS.escape(normalizedId)}"]`);
  const grid = entry?.querySelector(".discover-inline-grid");
  const status = entry?.querySelector(".discover-inline-status");
  if (!grid || !status || !state.discoverListItems.has(normalizedId)) return;
  status.hidden = true;
  renderLibraryGrid(grid, state.discoverListItems.get(normalizedId));
}

function syncDiscoverListUrl(listId) {
  if (APP_PAGE !== "discover") return;
  const url = new URL(window.location.href);
  if (listId) url.searchParams.set("list", String(listId));
  else url.searchParams.delete("list");
  window.history.replaceState(window.history.state, "", url);
}

async function copyTextToClipboard(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall through for browsers that block the Clipboard API.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Copy failed");
}

async function shareDiscoverList(listId, button) {
  const shareUrl = new URL("discover.html", window.location.href);
  shareUrl.search = "";
  shareUrl.hash = "";
  shareUrl.searchParams.set("list", String(listId));
  const label = button.querySelector("span");
  try {
    await copyTextToClipboard(shareUrl.href);
    if (label) label.textContent = "Link copied";
  } catch {
    if (label) label.textContent = "Could not copy";
  }
  window.setTimeout(() => {
    if (label?.isConnected) label.textContent = "Share list";
  }, 1800);
}

async function toggleDiscoverList(listId) {
  const normalizedId = String(listId);
  if (state.expandedDiscoverLists.has(normalizedId)) {
    state.expandedDiscoverLists.delete(normalizedId);
    setDiscoverListExpanded(normalizedId, false);
    syncDiscoverListUrl(null);
    return;
  }

  state.expandedDiscoverLists.forEach(openListId => setDiscoverListExpanded(openListId, false));
  state.expandedDiscoverLists.clear();
  state.expandedDiscoverLists.add(normalizedId);
  setDiscoverListExpanded(normalizedId, true);
  syncDiscoverListUrl(normalizedId);
  if (state.discoverListItems.has(normalizedId)) {
    renderExpandedDiscoverList(normalizedId);
    return;
  }

  try {
    const entry = discoverListsContainer.querySelector(`[data-discover-entry="${CSS.escape(normalizedId)}"]`);
    const status = entry?.querySelector(".discover-inline-status");
    if (status) {
      status.hidden = false;
      status.textContent = "Loading titles...";
    }
    const data = await apiFetch(`/api/lists/${encodeURIComponent(normalizedId)}/browse`);
    state.discoverListItems.set(normalizedId, Array.isArray(data?.items) ? data.items : []);
    renderExpandedDiscoverList(normalizedId);
  } catch (error) {
    const entry = discoverListsContainer.querySelector(`[data-discover-entry="${CSS.escape(normalizedId)}"]`);
    const status = entry?.querySelector(".discover-inline-status");
    if (status) status.textContent = error.message || "Could not load this list.";
  }
}

async function resizeProfilePicture(file) {
  if (!file || !/^image\/(jpeg|png|webp)$/i.test(file.type)) throw new Error("Choose a JPEG, PNG, or WebP image.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Choose an image smaller than 8 MB.");
  let source;
  let revokeUrl = "";
  if (typeof createImageBitmap === "function") {
    source = await createImageBitmap(file);
  } else {
    revokeUrl = URL.createObjectURL(file);
    source = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Could not read that image."));
      image.src = revokeUrl;
    });
  }
  const width = Number(source.width || source.naturalWidth || 0);
  const height = Number(source.height || source.naturalHeight || 0);
  const canvas = document.createElement("canvas");
  canvas.width = 320; canvas.height = 320;
  const ctx = canvas.getContext("2d");
  const sourceSize = Math.min(width, height);
  const sx = (width - sourceSize) / 2;
  const sy = (height - sourceSize) / 2;
  ctx.fillStyle = "#090a0d"; ctx.fillRect(0, 0, 320, 320);
  ctx.drawImage(source, sx, sy, sourceSize, sourceSize, 0, 0, 320, 320);
  source.close?.();
  if (revokeUrl) URL.revokeObjectURL(revokeUrl);
  return canvas.toDataURL("image/jpeg", .78);
}

async function changeProfilePicture(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  profilePictureMessage.textContent = "Preparing picture…";
  try {
    const imageData = await resizeProfilePicture(file);
    const data = await apiFetch("/api/account/profile-picture", { method: "PATCH", body: JSON.stringify({ imageData }) });
    setAccountUser(data.user);
    profilePictureMessage.textContent = "Profile picture updated.";
    renderProfilePage();
  } catch (error) { profilePictureMessage.textContent = error.message || "Could not update profile picture."; }
  finally { profilePictureInput.value = ""; }
}

async function removeProfilePicture() {
  if (!state.user?.profilePicture) return;
  try {
    const data = await apiFetch("/api/account/profile-picture", { method: "PATCH", body: JSON.stringify({ imageData: "" }) });
    setAccountUser(data.user);
    profilePictureMessage.textContent = "Profile picture removed.";
    renderProfilePage();
  } catch (error) { profilePictureMessage.textContent = error.message || "Could not remove profile picture."; }
}

function hideBrowseForProfile() {
  heroTrailerCommand("pauseVideo");
  heroSection.style.display = "none";
  continueSection.style.display = "none";
  liveSportsSection.style.display = "none";
  rowsContainer.style.display = "none";
  searchResultsSection.style.display = "none";
  collectionSection.style.display = "none";
  catalogueActions.style.display = "none";
  collectionActions.style.display = "none";
}

function restoreBrowseAfterUtilityPage() {
  if (state.typeScope === "live") {
    showLiveSportsView(searchInput.value);
    return;
  }

  hideLiveSportsView();
  if (state.activeCollection) {
    collectionSection.style.display = "block";
    renderActiveCollection();
  } else if (state.searchTerm) {
    searchResultsSection.style.display = "block";
  } else {
    rowsContainer.style.display = "";
    continueSection.style.display = "";
    renderCatalogue();
    populateHero(state.heroMedia);
  }
}

async function openDiscoverPage() {
  if (!state.user) {
    openAuthModal("signin");
    return;
  }
  closeAccountMenu();
  closeLiveSchedule();
  if (state.profileOpen) {
    state.profileOpen = false;
    profileSection.style.display = "none";
    profileSection.setAttribute("aria-hidden", "true");
  }
  state.discoverOpen = true;
  discoverListsTopButton.classList.add("active");
  hideBrowseForProfile();
  discoverSection.style.display = "block";
  discoverSection.setAttribute("aria-hidden", "false");
  renderDiscoverLists();
  window.scrollTo({ top: 0, behavior: "smooth" });
  try {
    const data = await apiFetch("/api/lists/discover");
    state.discoverLists = Array.isArray(data?.lists) ? data.lists : [];
    renderDiscoverLists();
    const requestedListId = APP_PAGE === "discover"
      ? new URLSearchParams(window.location.search).get("list")
      : "";
    if (requestedListId && state.discoverLists.some(list => String(list.id) === requestedListId)) {
      await toggleDiscoverList(requestedListId);
    }
  } catch (error) {
    console.error("Could not load public lists", error);
    discoverListsContainer.innerHTML = `<div class="profile-empty">${escapeHtml(error.message || "Could not load public lists.")}</div>`;
  }
}

function closeDiscoverPage({ restoreBrowse = true } = {}) {
  if (!state.discoverOpen) return;
  state.discoverOpen = false;
  discoverListsTopButton.classList.remove("active");
  discoverSection.style.display = "none";
  discoverSection.setAttribute("aria-hidden", "true");
  discoverListIndex.hidden = false;
  discoverListDetail.hidden = true;
  if (restoreBrowse) restoreBrowseAfterUtilityPage();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function openProfilePage() {
  if (!state.user) {
    openAuthModal("signin");
    return;
  }
  closeAccountMenu();
  closeLiveSchedule();
  if (state.discoverOpen) closeDiscoverPage({ restoreBrowse: false });
  state.profileOpen = true;
  hideBrowseForProfile();
  profileSection.style.display = "block";
  profileSection.setAttribute("aria-hidden", "false");
  profileUsernameMessage.textContent = "";
  profileUsernameMessage.classList.remove("success");
  profilePasswordMessage.textContent = "";
  profilePasswordMessage.classList.remove("success");
  profilePictureMessage.textContent = "";
  createListMessage.textContent = "";
  profileNewUsername.value = state.user.username || "";
  profileUsernamePassword.value = "";
  profilePasswordForm.reset();
  setProfileTab(state.profileTab || "overview");
  renderProfilePage();
  window.scrollTo({ top: 0, behavior: "smooth" });
  try {
    await loadPersonalLibraryData({ includeDiscover: false });
    state.personalLibraryLoaded = true;
    renderProfilePage();
  } catch (error) {
    console.error("Could not load profile collections", error);
  }
}

function closeProfilePage() {
  if (!state.profileOpen) return;
  state.profileOpen = false;
  profileSection.style.display = "none";
  profileSection.setAttribute("aria-hidden", "true");

  restoreBrowseAfterUtilityPage();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function clearProfileHistory() {
  if (!state.user || !getWatchHistory().length) return;
  if (!window.confirm("Clear all Currently Watching history for this account?")) return;
  profileClearHistory.disabled = true;
  try {
    await apiFetch("/api/watch-history", { method: "DELETE" });
    setWatchHistory([]);
    writePendingWatchHistory([]);
    renderContinueWatching();
    renderProfilePage();
  } catch (error) {
    window.alert(error.message || "Could not clear watch history.");
  } finally {
    profileClearHistory.disabled = getWatchHistory().length === 0;
  }
}

async function submitProfileUsername(event) {
  event.preventDefault();
  profileUsernameMessage.textContent = "";
  profileUsernameMessage.classList.remove("success");
  const submit = profileUsernameForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const data = await apiFetch("/api/account/username", {
      method: "PATCH",
      body: JSON.stringify({
        username: profileNewUsername.value.trim(),
        currentPassword: profileUsernamePassword.value
      })
    });
    setAccountUser(data?.user || state.user);
    profileNewUsername.value = state.user?.username || "";
    profileUsernamePassword.value = "";
    profileUsernameMessage.textContent = "Username updated.";
    profileUsernameMessage.classList.add("success");
    renderProfilePage();
  } catch (error) {
    profileUsernameMessage.textContent = error.message || "Could not update username.";
  } finally {
    submit.disabled = false;
  }
}

async function submitProfilePassword(event) {
  event.preventDefault();
  profilePasswordMessage.textContent = "";
  profilePasswordMessage.classList.remove("success");
  if (profileNewPassword.value !== profileConfirmPassword.value) {
    profilePasswordMessage.textContent = "New passwords do not match.";
    return;
  }
  const submit = profilePasswordForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    await apiFetch("/api/account/password", {
      method: "PATCH",
      body: JSON.stringify({
        currentPassword: profileCurrentPassword.value,
        newPassword: profileNewPassword.value
      })
    });
    profilePasswordForm.reset();
    profilePasswordMessage.textContent = "Password updated.";
    profilePasswordMessage.classList.add("success");
  } catch (error) {
    profilePasswordMessage.textContent = error.message || "Could not update password.";
  } finally {
    submit.disabled = false;
  }
}

function setAccountUser(user, { persist = true } = {}) {
  const previousUserId = state.user?.id || null;
  state.user = user || null;
  if (persist) cacheAccountUser(state.user);
  closeAccountMenu();

  if (!state.user) {
    state.watchHistory = [];
    state.watchLater = [];
    state.userLists = [];
    state.discoverLists = [];
    state.personalLibraryLoaded = false;
    accountAvatar.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/></svg>';
    accountLabel.textContent = "Sign in";
    accountButton.setAttribute("aria-label", "Sign in to TV Archive");
    renderContinueWatching();
    return;
  }

  if (previousUserId && String(previousUserId) !== String(state.user.id)) {
    state.watchLater = [];
    state.userLists = [];
    state.discoverLists = [];
    state.personalLibraryLoaded = false;
  }
  const label = state.user.username || "Account";
  renderAvatar(accountAvatar, state.user, `${label} profile picture`);
  accountLabel.textContent = label;
  accountMenuName.textContent = label;
  accountButton.setAttribute("aria-label", `Open account menu for ${label}`);
  setAccountSyncState("idle");
  if (state.profileOpen) renderProfilePage();
}

function setAuthMode(mode) {
  state.authMode = mode === "register" ? "register" : "signin";
  const registering = state.authMode === "register";
  authSignInTab.classList.toggle("active", !registering);
  authRegisterTab.classList.toggle("active", registering);
  authSignInTab.setAttribute("aria-selected", String(!registering));
  authRegisterTab.setAttribute("aria-selected", String(registering));
  authPassword.autocomplete = registering ? "new-password" : "current-password";
  authTitle.textContent = registering ? "Create your account" : "Welcome back";
  authSubtitle.textContent = registering
    ? "Choose a username and password to watch and continue on any device."
    : "Sign in with your username to access your saved TV Archive account.";
  authSubmit.textContent = registering ? "Create account" : "Sign in";
  authError.textContent = "";
}

function authReturnPath() {
  const value = new URLSearchParams(window.location.search).get("return") || "";
  return /^\.\/[a-z0-9_-]+\.html(?:[?#].*)?$/i.test(value) ? value : "./index.html";
}

function navigateToPage(destination, { replace = false, back = false } = {}) {
  if (pageNavigationPending) return;

  if (!back) {
    const target = new URL(destination, window.location.href);
    if (!replace && target.href === window.location.href) return;
  }

  pageNavigationPending = true;
  document.body.setAttribute("aria-busy", "true");
  document.body.classList.remove("page-ready");
  document.body.classList.add("page-leaving");

  window.setTimeout(() => {
    if (back) {
      window.history.back();
    } else if (replace) {
      window.location.replace(destination);
    } else {
      window.location.href = destination;
    }
  }, PAGE_TRANSITION_MS);
}

function openAuthModal(mode = "signin") {
  if (APP_PAGE !== "auth") {
    const currentFile = window.location.pathname.split("/").filter(Boolean).pop() || "index.html";
    const returnPath = `./${currentFile}${window.location.search}`;
    const params = new URLSearchParams({ mode, return: returnPath });
    navigateToPage(`./signin.html?${params.toString()}`);
    return;
  }

  setAuthMode(mode);
  authModalWrap.classList.add("open");
  authModalWrap.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  window.setTimeout(() => authUsername.focus(), 0);
}

function closeAuthModal({ navigateHome = true } = {}) {
  authModalWrap.classList.remove("open");
  authModalWrap.setAttribute("aria-hidden", "true");
  authError.textContent = "";
  if (!playerScreen.classList.contains("open") && !modalWrap.classList.contains("open")) {
    document.body.style.overflow = "";
  }
  if (APP_PAGE === "auth" && navigateHome) navigateToPage("./index.html");
}

function openAccountMenu() {
  accountMenu.hidden = false;
  accountButton.setAttribute("aria-expanded", "true");
}

function closeAccountMenu() {
  accountMenu.hidden = true;
  accountButton.setAttribute("aria-expanded", "false");
}

async function loadRemoteWatchHistory() {
  const data = await apiFetch("/api/watch-history");
  return normaliseHistoryList(data?.entries || []);
}

async function syncWatchHistoryFromAccount({ migrateLocal = true } = {}) {
  if (!state.user) return;
  setAccountSyncState("syncing");

  const legacyEntries = migrateLocal ? readLocalWatchHistory() : [];
  const pendingEntries = readPendingWatchHistory();
  try {
    const remoteEntries = await loadRemoteWatchHistory();
    state.watchHistory = mergeHistoryLists(remoteEntries, legacyEntries, pendingEntries);
    renderContinueWatching();

    // Only the one-time legacy migration is pushed during account loading.
    // Pending playback progress remains local until pause, seek, end or exit.
    if (legacyEntries.length) {
      await apiFetch("/api/watch-history/sync", {
        method: "POST",
        body: JSON.stringify({ entries: legacyEntries })
      });
      const refreshedRemoteEntries = await loadRemoteWatchHistory();
      state.watchHistory = mergeHistoryLists(refreshedRemoteEntries, pendingEntries);
      localStorage.removeItem(WATCH_HISTORY_KEY);
      localStorage.removeItem(LEGACY_WATCH_HISTORY_KEY);
      renderContinueWatching();
    }
    setAccountSyncState("idle");
  } catch (error) {
    console.error("Watch history sync failed", error);
    const localEntries = mergeHistoryLists(legacyEntries, pendingEntries);
    if (localEntries.length) {
      state.watchHistory = mergeHistoryLists(state.watchHistory, localEntries);
      renderContinueWatching();
    }
    setAccountSyncState("error");
  }
}

async function persistWatchEntryToAccount(entry, { keepalive = false } = {}) {
  if (!state.user || !entry?.imdbId) return;
  const syncedLastWatched = Number(entry.lastWatched || 0);
  setAccountSyncState("syncing");
  try {
    await apiFetch(`/api/watch-history/${encodeURIComponent(entry.imdbId)}`, {
      method: "PUT",
      body: JSON.stringify(entry),
      keepalive
    });
    clearPendingWatchEntry(entry.imdbId, syncedLastWatched);
    setAccountSyncState("idle");
  } catch (error) {
    console.error("Could not sync watch progress", error);
    setAccountSyncState("error");
  }
}

async function restoreAccountSession() {
  if (!getAuthToken()) {
    setAccountUser(null);
    return;
  }

  try {
    const data = await apiFetch("/api/auth/me");
    setAccountUser(data?.user || null);
    if (state.user) await syncWatchHistoryFromAccount();
  } catch (error) {
    if (error.status === 401) clearAuthSession();
    else {
      console.warn("Account session check failed", error);
      if (!state.user) setAccountUser(null);
    }
  }
}

async function submitAuthForm(event) {
  event.preventDefault();
  authError.textContent = "";
  authSubmit.disabled = true;

  const registering = state.authMode === "register";
  const payload = {
    username: authUsername.value.trim(),
    password: authPassword.value
  };

  try {
    const data = await apiFetch(registering ? "/api/auth/register" : "/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    if (!data?.token) throw new Error("The API did not return a session token.");
    saveAuthToken(data.token);
    setAccountUser(data?.user || null);
    closeAuthModal({ navigateHome: false });
    authForm.reset();
    await syncWatchHistoryFromAccount();
    if (APP_PAGE === "auth") {
      navigateToPage(authReturnPath(), { replace: true });
      return;
    }
    if (APP_PAGE === "profile") await openProfilePage();
    if (APP_PAGE === "discover") await openDiscoverPage();
  } catch (error) {
    authError.textContent = error.message || "Could not sign in.";
  } finally {
    authSubmit.disabled = false;
  }
}

async function logoutAccount() {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" });
  } catch (error) {
    console.warn("Logout request failed", error);
  } finally {
    clearAuthSession();
    if (APP_PAGE === "profile" || APP_PAGE === "discover") {
      navigateToPage("./index.html", { replace: true });
    }
  }
}

function stripHtml(value = "") {
  const div = document.createElement("div");
  div.innerHTML = value || "";
  return div.textContent || div.innerText || "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatWatchTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function getImdbId(media) {
  return media?.imdbId || media?.externals?.imdb || "";
}

function getMediaName(media) {
  return media?.name || media?.title || "Untitled";
}

function getMediaPoster(media) {
  return media?.poster || media?.image?.medium || media?.image?.original || "";
}

function getMediaBackdrop(media) {
  return media?.backdrop || media?.image?.original || media?.image?.medium || getMediaPoster(media);
}

function getMediaSummary(media) {
  return stripHtml(media?.summary || "");
}

function getMediaYear(media) {
  if (media?.year) return String(media.year);
  return media?.premiered ? media.premiered.slice(0, 4) : "";
}

function getMediaType(media) {
  return media?.mediaType === "movie" ? "movie" : "tv";
}

function getMediaRating(media) {
  const raw = getMediaType(media) === "movie"
    ? media.rating
    : media.rating?.average;

  const rating = Number(raw);
  return Number.isFinite(rating) ? rating : 0;
}

function isSameTvShow(a, b) {
  if (!a || !b) return false;

  const aId = Number(a.id || 0);
  const bId = Number(b.id || 0);
  if (aId && bId) return aId === bId;

  const aImdb = getImdbId(a);
  const bImdb = getImdbId(b);
  return Boolean(aImdb && bImdb && aImdb === bImdb);
}

function getKnownEpisodesForShow(show) {
  if (!show) return [];

  if (state.currentEpisodes.length && isSameTvShow(state.currentShow, show)) {
    return state.currentEpisodes;
  }

  const showId = Number(show.id || 0);
  const cached = showId ? episodeMetadataCache.get(showId) : null;
  return Array.isArray(cached) ? cached : [];
}

function findKnownEpisode(show, season, episode) {
  season = Number(season);
  episode = Number(episode);
  return getKnownEpisodesForShow(show).find(item =>
    Number(item.season) === season && Number(item.number) === episode
  ) || null;
}

async function fetchEpisodesForShow(show) {
  const showId = Number(show?.id || 0);
  if (!showId) return [];

  const known = getKnownEpisodesForShow(show);
  if (known.length) {
    episodeMetadataCache.set(showId, known);
    return known;
  }

  const cached = episodeMetadataCache.get(showId);
  if (cached && typeof cached.then === "function") return cached;
  if (Array.isArray(cached)) return cached;

  const request = fetchJson(`${TVMAZE_API}/shows/${showId}/episodes`)
    .then(items => {
      const episodes = (items || []).filter(item =>
        Number.isInteger(item.season) && Number.isInteger(item.number)
      );
      episodeMetadataCache.set(showId, episodes);
      return episodes;
    })
    .catch(error => {
      episodeMetadataCache.delete(showId);
      throw error;
    });

  episodeMetadataCache.set(showId, request);
  return request;
}

async function resolveEpisodeData(show, season, episode) {
  const known = findKnownEpisode(show, season, episode);
  if (known) return known;

  try {
    const episodes = await fetchEpisodesForShow(show);
    return episodes.find(item =>
      Number(item.season) === Number(season) &&
      Number(item.number) === Number(episode)
    ) || null;
  } catch (error) {
    console.warn("Could not resolve episode metadata.", error);
    return null;
  }
}

function getSavedPlayback(imdbId) {
  return getWatchHistory().find(entry => entry.imdbId === imdbId);
}

function makeWatchEntry(media, options = {}, existing = null) {
  const mediaType = options.mediaType || getMediaType(media);
  const season = mediaType === "tv" ? Number(options.season) : null;
  const episode = mediaType === "tv" ? Number(options.episode) : null;
  const episodeData = mediaType === "tv"
    ? findKnownEpisode(media, season, episode)
    : null;
  const existingMatchesEpisode = mediaType === "tv" &&
    existing?.mediaType !== "movie" &&
    Number(existing?.season) === season &&
    Number(existing?.episode) === episode;

  return {
    mediaType,
    imdbId: getImdbId(media),
    showId: mediaType === "tv" ? (media.id || existing?.showId || null) : null,
    name: getMediaName(media),
    poster: getMediaPoster(media) || existing?.poster || "",
    backdrop: getMediaBackdrop(media) || existing?.backdrop || "",
    summary: getMediaSummary(media) || existing?.summary || "",
    year: getMediaYear(media) || existing?.year || "",
    season,
    episode,
    episodeName: mediaType === "tv"
      ? (options.episodeName || episodeData?.name ||
          (existingMatchesEpisode ? existing?.episodeName : "") || "")
      : "",
    currentTime: Number(existing?.currentTime) || 0,
    duration: Number(existing?.duration) || 0,
    lastWatched: Date.now()
  };
}

function saveWatchEntry(entry, { syncRemote = false, keepalive = false } = {}) {
  const history = getWatchHistory();
  const withoutCurrentTitle = history.filter(item => item.imdbId !== entry.imdbId);
  setWatchHistory([entry, ...withoutCurrentTitle]);
  renderContinueWatching();
  if (state.profileOpen) renderProfilePage();

  // Playback progress is deliberately cached in the browser while watching.
  // Neon is only touched for explicit checkpoints: pause, seek, end or exit.
  if (state.user) {
    cachePendingWatchEntry(entry);
    if (syncRemote) persistWatchEntryToAccount(entry, { keepalive });
    else setAccountSyncState("idle", "Progress saved locally");
  }
}

function removeWatchEntry(entry) {
  setWatchHistory(getWatchHistory().filter(item => item.imdbId !== entry.imdbId));
  clearPendingWatchEntry(entry?.imdbId);
  renderContinueWatching();
  if (state.profileOpen) renderProfilePage();
  if (state.user && entry?.imdbId) {
    setAccountSyncState("syncing");
    apiFetch(`/api/watch-history/${encodeURIComponent(entry.imdbId)}`, { method: "DELETE" })
      .then(() => setAccountSyncState("idle"))
      .catch(error => {
        console.error("Could not remove synced watch history", error);
        setAccountSyncState("error");
      });
  }
}

function updatePlaybackProgress(currentTime, duration, eventName = "") {
  if (!state.activePlayback) return;

  const now = Date.now();
  const importantEvent = ["pause", "seeked", "ended"].includes(eventName);
  if (!importantEvent && now - state.lastProgressWrite < 3000) return;
  state.lastProgressWrite = now;

  const active = state.activePlayback;
  const media = active.media;
  const imdbId = getImdbId(media);
  const existing = getSavedPlayback(imdbId);
  const entry = makeWatchEntry(media, active, existing);

  if (Number.isFinite(Number(currentTime))) {
    entry.currentTime = Math.max(0, Number(currentTime));
  }
  if (Number.isFinite(Number(duration)) && Number(duration) > 0) {
    entry.duration = Number(duration);
  }
  if (eventName === "ended" && entry.duration > 0) {
    entry.currentTime = entry.duration;
  }

  entry.lastWatched = Date.now();
  saveWatchEntry(entry, { syncRemote: importantEvent });
}

function syncActivePlaybackOnExit({ keepalive = false } = {}) {
  if (!state.user || !state.activePlayback) return;

  const imdbId = getImdbId(state.activePlayback.media);
  const existing = getSavedPlayback(imdbId);
  if (!existing) return;

  const entry = { ...existing, lastWatched: Date.now() };
  saveWatchEntry(entry, { syncRemote: true, keepalive });
}

function isVidFastOrigin(origin) {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" &&
      (url.hostname === "vidfast.vc" || url.hostname.endsWith(".vidfast.vc"));
  } catch {
    return false;
  }
}

async function refreshContinueEpisodeNames(history) {
  const tvEntries = (history || []).filter(entry =>
    entry?.mediaType !== "movie" && Number(entry?.showId) &&
    Number(entry?.season) > 0 && Number(entry?.episode) > 0
  );
  if (!tvEntries.length || !state.user) return;

  const corrections = new Map();
  await Promise.all(tvEntries.map(async entry => {
    const show = {
      id: Number(entry.showId),
      externals: { imdb: entry.imdbId },
      name: entry.name
    };
    const episodeData = await resolveEpisodeData(show, entry.season, entry.episode);
    const correctName = String(episodeData?.name || "").trim();
    if (correctName && correctName !== String(entry.episodeName || "").trim()) {
      corrections.set(entry.imdbId, correctName);
    }
  }));

  if (!corrections.size || !state.user) return;

  let changed = false;
  state.watchHistory = state.watchHistory.map(entry => {
    const correctName = corrections.get(entry.imdbId);
    if (!correctName) return entry;
    changed = true;
    return { ...entry, episodeName: correctName };
  });

  // This is a display/data repair only. Do not wake Neon just to correct an
  // old label; the corrected name will sync at the next normal checkpoint.
  if (changed) renderContinueWatching();
}

function renderContinueWatching() {
  const history = getWatchHistory()
    .sort((a, b) => (b.lastWatched || 0) - (a.lastWatched || 0))
    .slice(0, 12);

  if (!history.length) {
    continueSection.classList.remove("visible");
    continueRow.innerHTML = "";
    return;
  }

  continueSection.classList.add("visible");
  continueRow.innerHTML = history.map((entry, index) => {
    const duration = Number(entry.duration) || 0;
    const current = Number(entry.currentTime) || 0;
    const percentage = duration > 0
      ? Math.max(0, Math.min(100, (current / duration) * 100))
      : 0;

    const timeLabel = duration > 0
      ? `${formatWatchTime(current)} / ${formatWatchTime(duration)} · ${Math.round(percentage)}%`
      : current > 0
        ? `${formatWatchTime(current)} watched`
        : "Started";

    const detailLabel = entry.mediaType === "movie"
      ? "Movie"
      : `S${entry.season} E${entry.episode}` +
        (entry.episodeName ? ` · ${entry.episodeName}` : "");

    const poster = entry.poster
      ? `<img src="${escapeHtml(entry.poster)}" alt="${escapeHtml(entry.name)} poster">`
      : `<div class="continue-fallback">${escapeHtml(entry.name)}</div>`;

    return `
      <article class="continue-card" data-history-index="${index}" tabindex="0" role="button"
        aria-label="Resume ${escapeHtml(entry.name)}">
        <button
          class="continue-remove icon-btn"
          type="button"
          data-remove-index="${index}"
          aria-label="Remove ${escapeHtml(entry.name)} from Currently Watching"
          title="Remove from Currently Watching"
        >${ICONS.close}</button>
        <div class="continue-poster">${poster}</div>
        <div class="continue-body">
          <div class="continue-title">${escapeHtml(entry.name)}</div>
          <div class="continue-episode">${escapeHtml(detailLabel)}</div>
          <div class="continue-time">${escapeHtml(timeLabel)}</div>
          <div class="progress-track" aria-hidden="true">
            <div class="progress-fill" style="width:${percentage}%"></div>
          </div>
          <div class="resume-label">${ICONS.play}Resume</div>
        </div>
      </article>
    `;
  }).join("");

  void refreshContinueEpisodeNames(history);

  continueRow.querySelectorAll(".continue-remove").forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();
      removeWatchEntry(history[Number(button.dataset.removeIndex)]);
    });
    button.addEventListener("keydown", event => event.stopPropagation());
  });

  continueRow.querySelectorAll(".continue-card").forEach(card => {
    const entry = history[Number(card.dataset.historyIndex)];
    const resume = () => {
      stopHoverTrailer(card);
      resumeHistoryEntry(entry);
    };
    card.addEventListener("click", resume);
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        resume();
      }
    });
    if (entry) bindHoverTrailer(card, entry);
  });
}

function resumeHistoryEntry(entry) {
  if (!entry?.imdbId) return;

  if (entry.mediaType === "movie") {
    const movie = {
      mediaType: "movie",
      imdbId: entry.imdbId,
      name: entry.name,
      year: entry.year || "",
      poster: entry.poster || "",
      backdrop: entry.backdrop || entry.poster || "",
      summary: entry.summary || ""
    };
    openMovie(movie, { startAt: Number(entry.currentTime) || 0 });
    return;
  }

  const show = {
    mediaType: "tv",
    id: entry.showId,
    name: entry.name,
    summary: entry.summary || "",
    externals: { imdb: entry.imdbId },
    image: {
      medium: entry.poster || "",
      original: entry.backdrop || entry.poster || ""
    }
  };

  openEpisode(show, entry.season, entry.episode, {
    startAt: Number(entry.currentTime) || 0
  });
}

function validPlayableShow(show) {
  return Boolean(show?.externals?.imdb);
}

function normaliseShows(shows) {
  const seen = new Set();

  return shows
    .filter(show => {
      if (!validPlayableShow(show) || seen.has(show.id)) return false;
      seen.add(show.id);
      return true;
    })
    .map(show => ({ ...show, mediaType: "tv" }));
}

function normaliseMovies(movies) {
  const seen = new Set();

  return (movies || []).reduce((result, movie) => {
    const imdbId = movie?.imdbId || movie?.id || "";
    const name = movie?.name || movie?.title || "";

    if (!imdbId.startsWith("tt") || !name || seen.has(imdbId)) {
      return result;
    }

    seen.add(imdbId);

    const releaseInfo = String(movie.releaseInfo || movie.year || "");
    const yearMatch = releaseInfo.match(/\b(18|19|20)\d{2}\b/);

    result.push({
      mediaType: "movie",
      imdbId,
      name,
      poster: movie.poster || "",
      backdrop: movie.background || movie.backdrop || "",
      summary: movie.description || movie.summary || "",
      year: yearMatch ? yearMatch[0] : releaseInfo,
      rating: movie.imdbRating || movie.rating || "",
      genres: Array.isArray(movie.genres) ? movie.genres : []
    });

    return result;
  }, []);
}

function getAllLoadedItems() {
  return [...state.homeShows, ...state.homeMovies];
}

function itemsInScope(items) {
  if (state.typeScope === "all") return items;
  return items.filter(media => getMediaType(media) === state.typeScope);
}

function posterMarkup(media) {
  const image = getMediaPoster(media);
  if (image) {
    return `<img src="${escapeHtml(image)}" alt="${escapeHtml(getMediaName(media))} poster" loading="lazy"
      onerror="this.style.display='none';this.nextElementSibling.style.display='grid'">
      <div class="poster-fallback" style="display:none">${escapeHtml(getMediaName(media))}</div>`;
  }
  return `<div class="poster-fallback">${escapeHtml(getMediaName(media))}</div>`;
}

function mediaMetaLine(media) {
  const bits = [];
  const year = getMediaYear(media);
  if (year) bits.push(year);
  if (media.genres?.length) bits.push(media.genres[0]);
  const rating = getMediaRating(media);
  if (rating) bits.push(`★ ${rating.toFixed(1).replace(/\.0$/, "")}`);
  return bits.join(" · ");
}

function cardMarkup(media, cardClass, { libraryId = "", removable = false } = {}) {
  const type = getMediaType(media);
  const libraryAttribute = libraryId
    ? ` data-library-id="${escapeHtml(libraryId)}"`
    : "";
  return `
    <article class="${cardClass}" data-key="${escapeHtml(mediaKey(media))}"${libraryAttribute} tabindex="0" role="button"
      aria-label="Open ${escapeHtml(getMediaName(media))}">
      <div class="poster">
        <div class="media-type-badge">${type === "movie" ? "MOVIE" : "TV"}</div>
        ${removable ? `<button class="library-card-remove icon-btn" type="button" data-library-remove="${escapeHtml(libraryId)}" aria-label="Remove ${escapeHtml(getMediaName(media))}" title="Remove from list">${ICONS.close}</button>` : ""}
        ${posterMarkup(media)}
      </div>
      <div class="card-body-inline">
        <div class="card-title">${escapeHtml(getMediaName(media))}</div>
        <div class="card-meta">${escapeHtml(mediaMetaLine(media))}</div>
      </div>
    </article>
  `;
}

function mediaKey(media) {
  return getMediaType(media) === "movie" ? getImdbId(media) : String(media.id);
}

function bindCardOpeners(container, items) {
  const map = new Map(items.map(media => [mediaKey(media), media]));
  container.querySelectorAll("[data-key]").forEach(card => {
    const media = map.get(card.dataset.key);
    const open = () => {
      if (!media) return;
      stopHoverTrailer(card);
      if (getMediaType(media) === "movie") openMovieDetails(media);
      else openShow(media);
    };
    card.addEventListener("click", open);
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
    if (media) bindHoverTrailer(card, media);
  });
}

async function fetchJson(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(
      data?.detail || data?.error || `Request failed: ${response.status}`
    );
    error.status = response.status;
    throw error;
  }

  return data;
}

// ---- Genre row rendering (the Netflix/Prime-style browsing surface) ----

function buildGenreBuckets(items) {
  const counts = new Map();
  items.forEach(media => {
    (media.genres || []).forEach(genre => {
      counts.set(genre, (counts.get(genre) || 0) + 1);
    });
  });

  return [...counts.entries()]
    .filter(([, count]) => count >= MIN_ITEMS_PER_GENRE_ROW)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_GENRE_ROWS)
    .map(([genre]) => genre);
}

// Returns ALL matching items sorted by rating (no cap). The row itself
// only displays the first MAX_ITEMS_PER_ROW, but the full list is what
// "See All" opens as a collection page.
function itemsForGenreFull(items, genre) {
  return items
    .filter(media => media.genres?.includes(genre))
    .sort((a, b) => getMediaRating(b) - getMediaRating(a));
}

function seeAllTileMarkup(label) {
  return `
    <button class="row-card see-all-tile" type="button" data-see-all="1" aria-label="See all ${escapeHtml(label)}">
      <div class="poster see-all-poster">
        <div class="see-all-inner">
          ${ICONS.chevronRight}
          <span>See All</span>
        </div>
      </div>
    </button>
  `;
}

// Rows get fully rebuilt whenever the catalogue re-renders (type toggle,
// load more). A single shared resize listener re-checks whichever row
// scrollers currently exist, instead of each row leaking its own
// window-level listener every time it's rebuilt.
function refreshAllRowArrows() {
  rowsContainer.querySelectorAll(".row-scroller").forEach(scroller => {
    const track = scroller.querySelector(".row-track");
    if (!track) return;
    const maxScroll = track.scrollWidth - track.clientWidth;
    scroller.classList.toggle("can-scroll-left", track.scrollLeft > 4);
    scroller.classList.toggle("can-scroll-right", track.scrollLeft < maxScroll - 4);
  });
}

window.addEventListener("resize", refreshAllRowArrows);

function wireRowScrolling(section) {
  const scroller = section.querySelector(".row-scroller");
  const track = section.querySelector(".row-track");
  const leftArrow = section.querySelector(".row-arrow-left");
  const rightArrow = section.querySelector(".row-arrow-right");
  if (!scroller || !track) return;

  const updateArrows = () => {
    const maxScroll = track.scrollWidth - track.clientWidth;
    scroller.classList.toggle("can-scroll-left", track.scrollLeft > 4);
    scroller.classList.toggle("can-scroll-right", track.scrollLeft < maxScroll - 4);
  };

  leftArrow?.addEventListener("click", () =>
    track.scrollBy({ left: -track.clientWidth * 0.85, behavior: "smooth" })
  );
  rightArrow?.addEventListener("click", () =>
    track.scrollBy({ left: track.clientWidth * 0.85, behavior: "smooth" })
  );

  track.addEventListener("scroll", updateArrows, { passive: true });
  updateArrows();
}

// title: row heading. items: the (already-capped) list to show. fullItems:
// the complete matching list — if it's longer than what's shown, a
// "See All" tile is appended and opens the full list as a collection page.
function renderRow(container, title, items, fullItems = items, collection = null) {
  if (!items.length) return;

  const hasMore = fullItems.length > items.length;

  const section = document.createElement("section");
  section.className = "row-section";
  section.innerHTML = `
    <div class="section-head">
      <h2>${escapeHtml(title)}</h2>
    </div>
    <div class="row-scroller">
      <button class="row-arrow row-arrow-left icon-btn" type="button" aria-label="Scroll left">${ICONS.chevronLeft}</button>
      <div class="row-track">
        ${items.map(media => cardMarkup(media, "row-card")).join("")}
        ${hasMore ? seeAllTileMarkup(title) : ""}
      </div>
      <button class="row-arrow row-arrow-right icon-btn" type="button" aria-label="Scroll right">${ICONS.chevronRight}</button>
    </div>
  `;
  container.appendChild(section);
  bindCardOpeners(section, items);

  if (hasMore) {
    section.querySelector("[data-see-all]").addEventListener("click", () =>
      openCollectionView(title, fullItems, collection)
    );
  }

  wireRowScrolling(section);
}

function renderRows() {
  rowsContainer.innerHTML = "";

  const scoped = itemsInScope(getAllLoadedItems());

  if (!scoped.length) {
    rowsContainer.innerHTML = `
      <div class="status-card" style="margin-bottom:34px">
        ${state.initialCatalogueLoading
          ? '<div><div class="spinner"></div>Loading movies and TV shows…</div>'
          : "Nothing loaded yet."}
      </div>
    `;
    return;
  }

  const topRatedFull = [...scoped].sort((a, b) => getMediaRating(b) - getMediaRating(a));
  renderRow(
    rowsContainer,
    "Popular on IMDB",
    topRatedFull.slice(0, MAX_ITEMS_PER_ROW),
    topRatedFull,
    { kind: "popular", scope: state.typeScope }
  );

  if (state.typeScope === "all") {
    const moviesFull = [...state.homeMovies].sort((a, b) => getMediaRating(b) - getMediaRating(a));
    if (moviesFull.length) {
      renderRow(
        rowsContainer,
        "Top Rated Movies",
        moviesFull.slice(0, MAX_ITEMS_PER_ROW),
        moviesFull,
        { kind: "movies", scope: "movie" }
      );
    }

    const showsFull = [...state.homeShows].sort((a, b) => getMediaRating(b) - getMediaRating(a));
    if (showsFull.length) {
      renderRow(
        rowsContainer,
        "Top Rated TV Shows",
        showsFull.slice(0, MAX_ITEMS_PER_ROW),
        showsFull,
        { kind: "tv", scope: "tv" }
      );
    }
  }

  buildGenreBuckets(scoped).forEach(genre => {
    const fullList = itemsForGenreFull(scoped, genre);
    renderRow(
      rowsContainer,
      genre,
      fullList.slice(0, MAX_ITEMS_PER_ROW),
      fullList,
      { kind: "genre", genre, scope: state.typeScope }
    );
  });

  if (!state.heroMedia || !scoped.includes(state.heroMedia)) {
    const heroCandidates = topRatedFull.slice(0, 10);
    populateHero(heroCandidates[Math.floor(Math.random() * heroCandidates.length)] || scoped[0]);
  }
}

function collectionItemsFor(activeCollection) {
  if (!activeCollection) return [];

  const descriptor = activeCollection.collection || {};
  const scope = descriptor.scope || state.typeScope;
  const allItems = getAllLoadedItems();
  const scoped = scope === "all"
    ? allItems
    : allItems.filter(media => getMediaType(media) === scope);

  if (descriptor.kind === "movies") {
    return [...state.homeMovies].sort((a, b) => getMediaRating(b) - getMediaRating(a));
  }

  if (descriptor.kind === "tv") {
    return [...state.homeShows].sort((a, b) => getMediaRating(b) - getMediaRating(a));
  }

  if (descriptor.kind === "genre" && descriptor.genre) {
    return itemsForGenreFull(scoped, descriptor.genre);
  }

  if (descriptor.kind === "popular") {
    return [...scoped].sort((a, b) => getMediaRating(b) - getMediaRating(a));
  }

  return activeCollection.items || [];
}

function canLoadMoreForCollection(activeCollection) {
  const descriptor = activeCollection?.collection || {};
  const scope = descriptor.scope || state.typeScope;

  if (descriptor.kind === "movies" || scope === "movie") return state.movieHasMore;
  if (descriptor.kind === "tv" || scope === "tv") return state.tvHasMore;
  return state.tvHasMore || state.movieHasMore;
}

function renderActiveCollection() {
  if (!state.activeCollection) return;

  const items = collectionItemsFor(state.activeCollection);
  state.activeCollection.items = items;

  collectionTitle.textContent = state.activeCollection.title;
  collectionCount.textContent = `${items.length} title${items.length === 1 ? "" : "s"}`;
  collectionGrid.innerHTML = items.map(media => cardMarkup(media, "card")).join("");
  bindCardOpeners(collectionGrid, items);
  updateCollectionControls();
}

function updateCollectionControls() {
  if (!state.activeCollection) {
    collectionActions.style.display = "none";
    return;
  }

  const canLoadMore = canLoadMoreForCollection(state.activeCollection);
  collectionActions.style.display = canLoadMore ? "flex" : "none";
  collectionLoadMoreButton.textContent = "Load more titles";
  collectionLoadMoreButton.disabled = state.loadingTV || state.loadingMovies;
}

function openCollectionView(title, items, collection = null) {
  if (APP_PAGE !== "collection") {
    const descriptor = collection || {};
    const params = new URLSearchParams({
      title,
      kind: descriptor.kind || "popular",
      scope: descriptor.scope || state.typeScope
    });
    if (descriptor.genre) params.set("genre", descriptor.genre);
    navigateToPage(`./collection.html?${params.toString()}`);
    return;
  }

  state.activeCollection = { title, items, collection };
  searchInput.value = "";
  state.searchTerm = "";
  state.searchResults = null;

  heroSection.style.display = "none";
  rowsContainer.style.display = "none";
  searchResultsSection.style.display = "none";
  catalogueActions.style.display = "none";
  collectionSection.style.display = "block";

  renderActiveCollection();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function closeCollectionView() {
  state.activeCollection = null;
  collectionActions.style.display = "none";
  collectionSection.style.display = "none";
  rowsContainer.style.display = "";
  updateCatalogueControls();
  populateHero(state.heroMedia);
}

function updateCatalogueControls() {
  const hasLoadedTitles = getAllLoadedItems().length > 0;
  const canLoadMore = state.tvHasMore || state.movieHasMore;

  catalogueActions.style.display =
    state.initialCatalogueLoaded &&
    !state.initialCatalogueLoading &&
    !state.searchTerm &&
    !state.activeCollection &&
    hasLoadedTitles &&
    canLoadMore
      ? "flex"
      : "none";

  loadMoreButton.textContent = "Load more titles";
  loadMoreButton.disabled =
    state.initialCatalogueLoading || state.loadingTV || state.loadingMovies;
}

function renderCatalogue() {
  if (state.profileOpen) return;
  if (state.typeScope === "live") {
    showLiveSportsView(searchInput.value);
    return;
  }
  hideLiveSportsView();
  if (state.searchTerm || state.activeCollection) return; // handled separately
  renderRows();
  updateCatalogueControls();
}

async function loadHomeBatch({ render = true } = {}) {
  if (state.loadingTV || !state.tvHasMore) return;
  state.loadingTV = true;
  updateCatalogueControls();

  try {
    const pages = Array.from(
      { length: HOME_PAGE_BATCH },
      (_, index) => state.nextHomePage + index
    );

    const results = await Promise.all(
      pages.map(page => fetchJson(`${TVMAZE_API}/shows?page=${page}`))
    );

    state.nextHomePage += HOME_PAGE_BATCH;

    const known = new Set(state.homeShows.map(show => show.id));
    const incoming = normaliseShows(results.flat())
      .filter(show => !known.has(show.id));

    if (!incoming.length) {
      state.tvHasMore = false;
    } else {
      state.homeShows = [...state.homeShows, ...incoming];
    }
  } catch (error) {
    if (error?.status === 404) {
      state.tvHasMore = false;
    } else {
      console.error(error);
    }
  } finally {
    state.loadingTV = false;
    if (render) renderCatalogue();
    else updateCatalogueControls();
  }
}

async function loadMovieBatch({ render = true } = {}) {
  if (state.loadingMovies || !state.movieHasMore) return;
  state.loadingMovies = true;
  updateCatalogueControls();

  try {
    const extra = state.nextMovieSkip > 0
      ? `/skip=${state.nextMovieSkip}`
      : "";

    const data = await fetchJson(
      `${CINEMETA_API}/catalog/movie/top${extra}.json`
    );

    const incoming = normaliseMovies(data?.metas || []);

    if (!incoming.length) {
      state.movieHasMore = false;
    } else {
      const known = new Set(state.homeMovies.map(movie => movie.imdbId));
      const uniqueIncoming = incoming.filter(movie => !known.has(movie.imdbId));

      state.homeMovies = normaliseMovies([
        ...state.homeMovies,
        ...uniqueIncoming
      ]);

      state.nextMovieSkip += incoming.length;
      if (!uniqueIncoming.length) state.movieHasMore = false;
    }
  } catch (error) {
    console.error(error);
  } finally {
    state.loadingMovies = false;
    if (render) renderCatalogue();
    else updateCatalogueControls();
  }
}

async function loadMoreTitles() {
  loadMoreButton.disabled = true;
  loadMoreButton.textContent = "Loading…";

  await Promise.all([
    loadHomeBatch({ render: false }),
    loadMovieBatch({ render: false })
  ]);

  renderCatalogue();
}

async function loadMoreCollectionTitles() {
  if (!state.activeCollection) return;

  const descriptor = state.activeCollection.collection || {};
  const scope = descriptor.scope || state.typeScope;
  collectionLoadMoreButton.disabled = true;
  collectionLoadMoreButton.textContent = "Loading…";

  const loads = [];
  const onlyTV = descriptor.kind === "tv" || scope === "tv";
  const onlyMovies = descriptor.kind === "movies" || scope === "movie";

  if (onlyTV) {
    if (state.tvHasMore) loads.push(loadHomeBatch({ render: false }));
  } else if (onlyMovies) {
    if (state.movieHasMore) loads.push(loadMovieBatch({ render: false }));
  } else {
    if (state.tvHasMore) loads.push(loadHomeBatch({ render: false }));
    if (state.movieHasMore) loads.push(loadMovieBatch({ render: false }));
  }

  await Promise.all(loads);
  renderActiveCollection();
}

async function loadInitialCatalogue() {
  state.initialCatalogueLoading = true;
  state.initialCatalogueLoaded = false;
  catalogueActions.style.display = "none";
  renderRows();

  // Fetch a few batches up front so there's enough data to bucket into
  // genre rows right away, rather than showing one thin row at a time.
  await Promise.allSettled([
    loadHomeBatch({ render: false }),
    loadHomeBatch({ render: false }),
    loadHomeBatch({ render: false }),
    loadMovieBatch({ render: false }),
    loadMovieBatch({ render: false })
  ]);

  state.initialCatalogueLoading = false;
  state.initialCatalogueLoaded = true;

  renderCatalogue();
  renderContinueWatching();
}

function youtubeVideoId(value) {
  const raw = String(value || "").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;

  try {
    const url = new URL(raw);
    if (url.hostname === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0] || "";
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
    }

    if (url.hostname.includes("youtube.com")) {
      const queryId = url.searchParams.get("v") || "";
      if (/^[A-Za-z0-9_-]{11}$/.test(queryId)) return queryId;

      const parts = url.pathname.split("/").filter(Boolean);
      const marker = parts.findIndex(part => ["embed", "shorts", "live"].includes(part));
      const pathId = marker >= 0 ? (parts[marker + 1] || "") : "";
      return /^[A-Za-z0-9_-]{11}$/.test(pathId) ? pathId : "";
    }
  } catch {
    // Not a URL. It may still be a legacy Cinemeta source value.
  }

  return "";
}

function trailerYouTubeId(meta) {
  const candidates = [];

  const collect = (items, inheritedType = "") => {
    if (!Array.isArray(items)) return;
    items.forEach(item => {
      if (!item) return;
      if (typeof item === "string") {
        candidates.push({ id: youtubeVideoId(item), type: inheritedType });
        return;
      }

      const type = String(item.type || item.title || inheritedType || "");
      const id = youtubeVideoId(
        item.ytId ||
        item.youtubeId ||
        item.source ||
        item.externalUrl ||
        item.url ||
        ""
      );
      candidates.push({ id, type });
    });
  };

  collect(meta?.trailerStreams);
  collect(meta?.trailers);

  if (Array.isArray(meta?.videos)) {
    meta.videos.slice(0, 3).forEach(video => {
      collect(video?.trailerStreams, video?.title || "");
      collect(video?.trailers, video?.title || "");
    });
  }

  const valid = candidates.filter(candidate => candidate.id);
  const trailer = valid.find(candidate => /trailer|teaser/i.test(candidate.type));
  return (trailer || valid[0])?.id || "";
}

function hoverTrailerLayer() {
  return hoverTrailerPreview;
}

function positionHoverTrailer(card) {
  if (!card?.isConnected) return;

  const anchor = card.querySelector(".poster, .continue-poster") || card;
  const anchorRect = anchor.getBoundingClientRect();
  const viewportPadding = 16;
  const width = Math.min(440, window.innerWidth - (viewportPadding * 2));
  const height = hoverTrailerPreview.offsetHeight || ((width * 9 / 16) + 66);
  const left = Math.max(
    viewportPadding,
    Math.min(
      window.innerWidth - width - viewportPadding,
      anchorRect.left + (anchorRect.width - width) / 2
    )
  );
  const top = Math.max(
    viewportPadding,
    Math.min(
      window.innerHeight - height - viewportPadding,
      anchorRect.top + (anchorRect.height - height) / 2
    )
  );

  hoverTrailerPreview.style.width = `${width}px`;
  hoverTrailerPreview.style.left = `${left}px`;
  hoverTrailerPreview.style.top = `${top}px`;
}

function stopHoverTrailer(card = hoverTrailerCard) {
  if (hoverTrailerTimer) {
    clearTimeout(hoverTrailerTimer);
    hoverTrailerTimer = 0;
  }
  hoverTrailerRequestId += 1;

  const target = card || hoverTrailerCard;
  const layer = hoverTrailerLayer();
  if (layer) {
    layer.classList.remove("visible");
    layer.setAttribute("aria-hidden", "true");
    layer.replaceChildren();
  }

  if (!card || hoverTrailerCard === card) hoverTrailerCard = null;
}

function bindHoverTrailer(card, media) {
  if (!CARD_TRAILERS_ENABLED || !card || !media) return;
  const layer = hoverTrailerLayer();
  if (!layer) return;

  card.addEventListener("mouseenter", () => {
    if (hoverTrailerCard && hoverTrailerCard !== card) stopHoverTrailer(hoverTrailerCard);
    if (hoverTrailerTimer) clearTimeout(hoverTrailerTimer);

    hoverTrailerCard = card;
    positionHoverTrailer(card);
    const requestId = ++hoverTrailerRequestId;
    hoverTrailerTimer = window.setTimeout(async () => {
      hoverTrailerTimer = 0;
      const videoId = await getTrailerVideoId(media);
      if (
        requestId !== hoverTrailerRequestId ||
        hoverTrailerCard !== card ||
        !card.isConnected ||
        !card.matches(":hover") ||
        !videoId
      ) return;

      const frame = document.createElement("iframe");
      frame.title = `${getMediaName(media)} trailer preview`;
      frame.tabIndex = -1;
      frame.setAttribute("aria-hidden", "true");
      frame.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture");
      frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      frame.dataset.trailerRevealed = "0";
      frame._trailerReveal = () => {
        if (requestId !== hoverTrailerRequestId || hoverTrailerCard !== card || !card.matches(":hover")) {
          frame.remove();
          return;
        }
        positionHoverTrailer(card);
        layer.setAttribute("aria-hidden", "false");
        layer.classList.add("visible");
      };
      frame._trailerHide = () => {
        layer.classList.remove("visible");
        layer.setAttribute("aria-hidden", "true");
      };
      frame.onload = () => listenToTrailerFrame(frame);
      frame.src = trailerEmbedUrl(videoId);

      const video = document.createElement("div");
      video.className = "hover-trailer-video";
      video.appendChild(frame);

      const details = document.createElement("div");
      details.className = "hover-trailer-details";

      const title = document.createElement("div");
      title.className = "hover-trailer-title";
      title.textContent = card.querySelector(".card-title, .continue-title")?.textContent?.trim() || getMediaName(media);

      const meta = document.createElement("div");
      meta.className = "hover-trailer-meta";
      const metaParts = [...card.querySelectorAll(".card-meta, .continue-episode, .continue-time")]
        .map(item => item.textContent.trim())
        .filter(Boolean);
      meta.textContent = metaParts.join(" · ");

      details.append(title);
      if (meta.textContent) details.append(meta);
      layer.replaceChildren(video, details);
    }, HOVER_TRAILER_DELAY_MS);
  });

  card.addEventListener("mouseleave", () => stopHoverTrailer(card));
}

window.addEventListener("resize", () => {
  if (hoverTrailerCard && hoverTrailerPreview.classList.contains("visible")) {
    positionHoverTrailer(hoverTrailerCard);
  }
});

document.addEventListener("scroll", () => {
  if (hoverTrailerCard && hoverTrailerPreview.classList.contains("visible")) {
    positionHoverTrailer(hoverTrailerCard);
  }
}, true);

function updateTrailerSoundButtons() {
  const icon = trailersMuted ? ICONS.volumeOff : ICONS.volumeOn;
  const label = trailersMuted ? "Unmute trailer" : "Mute trailer";
  [heroSoundToggle, modalSoundToggle].forEach(button => {
    if (!button) return;
    button.innerHTML = icon;
    button.setAttribute("aria-label", label);
    button.title = label;
  });
}

function trailerFrameCommand(frame, command, args = []) {
  try {
    frame?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func: command, args }),
      "https://www.youtube-nocookie.com"
    );
  } catch {
    // Keep the image fallback if the embedded player cannot be controlled.
  }
}

function listenToTrailerFrame(frame) {
  if (!frame?.contentWindow) return;
  const id = frame.id || `trailer-${Math.random().toString(36).slice(2)}`;
  if (!frame.id) frame.id = id;
  const message = JSON.stringify({ event: "listening", id, channel: "widget" });

  // Muted autoplay is already requested in the embed URL. Repeated playVideo
  // calls make YouTube flash its centre pause icon, so only register for
  // player-state events here and leave start-up to autoplay.
  [0, 180, 420, 850].forEach(delay => {
    window.setTimeout(() => {
      try {
        frame.contentWindow?.postMessage(message, "https://www.youtube-nocookie.com");
      } catch {
        // The static backdrop/poster remains until the player responds.
      }
    }, delay);
  });
}

function hideTrailerFrame(frame) {
  if (!frame) return;
  frame.dataset.trailerRevealed = "0";
  frame.dataset.revealToken = String(Number(frame.dataset.revealToken || 0) + 1);
  frame._trailerHide?.();
}

function revealTrailerFrame(frame) {
  if (!frame || frame.dataset.trailerRevealed === "1") return;
  frame.dataset.trailerRevealed = "1";
  const revealToken = String(Number(frame.dataset.revealToken || 0) + 1);
  frame.dataset.revealToken = revealToken;
  // Give the player a short paint delay before revealing the trailer.
  window.setTimeout(() => {
    if (frame.dataset.revealToken !== revealToken || frame.dataset.trailerRevealed !== "1") return;
    if (!frame.isConnected && frame !== heroTrailer && frame !== modalTrailer) return;
    frame._trailerReveal?.();
  }, 180);
}

window.addEventListener("message", event => {
  if (!/^(https:\/\/www\.)?youtube(-nocookie)?\.com$/.test(event.origin)) return;

  let payload = event.data;
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch { return; }
  }
  if (!payload || typeof payload !== "object") return;

  const frames = [heroTrailer, modalTrailer, ...document.querySelectorAll(".hover-trailer-preview iframe")];
  const frame = frames.find(candidate => candidate?.contentWindow === event.source);
  if (!frame) return;

  let playerState = null;
  if (payload.event === "onStateChange") {
    playerState = Number(payload.info);
  } else if (payload.info && typeof payload.info === "object" && payload.info.playerState !== undefined) {
    playerState = Number(payload.info.playerState);
  }

  if (playerState === 1) {
    revealTrailerFrame(frame);
  } else if (playerState === 0) {
    // Loop in code without blanking the preview while it rewinds.
    trailerFrameCommand(frame, "seekTo", [0, true]);
    window.setTimeout(() => trailerFrameCommand(frame, "playVideo"), 60);
  }
});

function setTrailersMuted(muted) {
  trailersMuted = Boolean(muted);
  [heroTrailer, modalTrailer].forEach(frame => {
    if (!frame?.classList.contains("visible")) return;
    trailerFrameCommand(frame, trailersMuted ? "mute" : "unMute");
  });
  updateTrailerSoundButtons();
}

async function getTrailerVideoId(media) {
  const imdbId = getImdbId(media);
  if (!/^tt\d+$/.test(imdbId)) return "";

  const mediaType = getMediaType(media) === "movie" ? "movie" : "series";
  const cacheKey = `${mediaType}:${imdbId}`;
  let videoId = HERO_TRAILER_CACHE.get(cacheKey);

  if (videoId === undefined) {
    try {
      const data = await fetchJson(`${CINEMETA_API}/meta/${mediaType}/${encodeURIComponent(imdbId)}.json`);
      videoId = trailerYouTubeId(data?.meta);
    } catch (error) {
      console.warn(`No trailer found for ${getMediaName(media)}`, error);
      videoId = "";
    }
    HERO_TRAILER_CACHE.set(cacheKey, videoId);
  }

  return videoId || "";
}

function trailerEmbedUrl(videoId) {
  const params = new URLSearchParams({
    autoplay: "1",
    mute: "1",
    controls: "0",
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
    showinfo: "0",
    iv_load_policy: "3",
    cc_load_policy: "0",
    disablekb: "1",
    fs: "0",
    enablejsapi: "1",
    origin: window.location.origin
  });
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params}`;
}

function clearHeroTrailer() {
  heroTrailerRequestId += 1;
  heroTrailer.classList.remove("visible");
  heroSection.classList.remove("trailer-visible");
  heroSoundToggle.hidden = true;
  heroTrailer.removeAttribute("src");
  heroTrailer.dataset.trailerRevealed = "0";
  heroTrailer._trailerReveal = null;
  heroTrailer._trailerHide = null;
  heroTrailer.title = "Featured trailer";
}

function heroTrailerCommand(command) {
  trailerFrameCommand(heroTrailer, command);
}

async function loadHeroTrailer(media) {
  const requestId = ++heroTrailerRequestId;
  heroTrailer.classList.remove("visible");
  heroSection.classList.remove("trailer-visible");
  heroSoundToggle.hidden = true;
  heroTrailer.removeAttribute("src");

  const videoId = await getTrailerVideoId(media);
  if (requestId !== heroTrailerRequestId || state.heroMedia !== media || !videoId) return;

  heroTrailer.title = `${getMediaName(media)} trailer`;
  heroTrailer.dataset.trailerRevealed = "0";
  heroTrailer._trailerReveal = () => {
    if (requestId !== heroTrailerRequestId || state.heroMedia !== media) return;
    heroTrailer.classList.add("visible");
    heroSection.classList.add("trailer-visible");
    heroSoundToggle.hidden = false;
    updateTrailerSoundButtons();
    if (!trailersMuted) trailerFrameCommand(heroTrailer, "unMute");
  };
  heroTrailer._trailerHide = () => {
    heroTrailer.classList.remove("visible");
    heroSection.classList.remove("trailer-visible");
  };
  heroTrailer.onload = () => listenToTrailerFrame(heroTrailer);
  heroTrailer.src = trailerEmbedUrl(videoId);
}

function clearModalTrailer() {
  modalTrailerRequestId += 1;
  modalTrailer.classList.remove("visible");
  modalSoundToggle.hidden = true;
  modalTrailer.removeAttribute("src");
  modalTrailer.dataset.trailerRevealed = "0";
  modalTrailer._trailerReveal = null;
  modalTrailer._trailerHide = null;
  modalTrailer.title = "Title trailer";
}

async function loadModalTrailer(media) {
  const requestId = ++modalTrailerRequestId;
  modalTrailer.classList.remove("visible");
  modalSoundToggle.hidden = true;
  modalTrailer.removeAttribute("src");

  const videoId = await getTrailerVideoId(media);
  if (requestId !== modalTrailerRequestId || !modalWrap.classList.contains("open") || !videoId) return;

  modalTrailer.title = `${getMediaName(media)} trailer`;
  modalTrailer.dataset.trailerRevealed = "0";
  modalTrailer._trailerReveal = () => {
    if (requestId !== modalTrailerRequestId || !modalWrap.classList.contains("open")) return;
    modalTrailer.classList.add("visible");
    modalSoundToggle.hidden = false;
    updateTrailerSoundButtons();
    if (!trailersMuted) trailerFrameCommand(modalTrailer, "unMute");
  };
  modalTrailer._trailerHide = () => modalTrailer.classList.remove("visible");
  modalTrailer.onload = () => listenToTrailerFrame(modalTrailer);
  modalTrailer.src = trailerEmbedUrl(videoId);
}

heroSoundToggle.addEventListener("click", event => {
  event.stopPropagation();
  setTrailersMuted(!trailersMuted);
});

modalSoundToggle.addEventListener("click", event => {
  event.stopPropagation();
  setTrailersMuted(!trailersMuted);
});

updateTrailerSoundButtons();

const heroVisibilityObserver = new IntersectionObserver(entries => {
  const visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio > 0.08);
  if (!heroTrailer.classList.contains("visible")) return;
  heroTrailerCommand(visible ? "playVideo" : "pauseVideo");
}, { threshold: [0, 0.08] });
heroVisibilityObserver.observe(heroSection);

function populateHero(media) {
  if (!media) {
    clearHeroTrailer();
    heroSection.style.display = "none";
    return;
  }

  state.heroMedia = media;
  if (state.profileOpen) {
    heroSection.style.display = "none";
    return;
  }
  heroSection.style.display = "block";

  const isMovie = getMediaType(media) === "movie";

  heroEyebrow.textContent = isMovie ? "Featured movie" : "Featured TV series";
  heroTitle.textContent = getMediaName(media);
  heroDescription.textContent = getMediaSummary(media) ||
    (isMovie
      ? "Watch this film without leaving TV Archive."
      : "Choose a season and episode and watch without leaving TV Archive.");

  const image = getMediaBackdrop(media);
  heroBg.style.backgroundImage = image ? `url("${image}")` : "";
  loadHeroTrailer(media);
  heroBrowse.innerHTML = isMovie
    ? `${ICONS.play}Play movie`
    : `${ICONS.chevronRight}Browse episodes`;
  heroBrowse.onclick = () => isMovie ? openMovie(media) : openShow(media);
}

async function searchCatalogue(query) {
  const term = query.trim();

  if (state.typeScope === "live") {
    showLiveSportsView(term);
    return;
  }

  hideLiveSportsView();
  state.searchTerm = term;

  if (!term) {
    state.searchResults = null;
    searchResultsSection.style.display = "none";
    rowsContainer.style.display = "";
    heroSection.style.display = state.heroMedia ? "block" : "none";
    renderCatalogue();
    return;
  }

  state.activeCollection = null;
  collectionSection.style.display = "none";
  rowsContainer.style.display = "none";
  heroSection.style.display = "none";
  catalogueActions.style.display = "none";
  searchResultsSection.style.display = "block";
  searchResultsTitle.textContent = `Searching for "${term}"…`;
  searchResultsCount.textContent = "";
  searchGrid.innerHTML = `<div class="status-card"><div><div class="spinner"></div>Searching…</div></div>`;

  try {
    const [tvResult, movieResult] = await Promise.allSettled([
      fetchJson(`${TVMAZE_API}/search/shows?q=${encodeURIComponent(term)}`),
      fetchJson(
        `${CINEMETA_API}/catalog/movie/top/search=${encodeURIComponent(term)}.json`
      )
    ]);

    if (searchInput.value.trim() !== term) return;

    const shows = tvResult.status === "fulfilled"
      ? normaliseShows(tvResult.value.map(result => result.show))
      : [];

    const movies = movieResult.status === "fulfilled"
      ? normaliseMovies(movieResult.value?.metas || [])
      : [];

    const results = itemsInScope([...shows, ...movies]);
    state.searchResults = results;

    searchResultsTitle.textContent = `Search results for "${term}"`;

    if (!results.length) {
      searchResultsCount.textContent = "";
      searchGrid.innerHTML = `<div class="status-card">No titles match "${escapeHtml(term)}".</div>`;
      return;
    }

    searchResultsCount.textContent = `${results.length} result${results.length === 1 ? "" : "s"}`;
    searchGrid.innerHTML = results.map(media => cardMarkup(media, "card")).join("");
    bindCardOpeners(searchGrid, results);
  } catch (error) {
    console.error(error);
    searchGrid.innerHTML = `<div class="status-card">Search failed. Try again.</div>`;
  }
}


function liveChannelMarkup(channel) {
  return `
    <div class="live-channel-tile">
      <button class="live-channel-card" type="button" data-live-channel-id="${channel.id}"
        aria-label="Watch ${escapeHtml(channel.name)} live">
        <div class="live-channel-top">
          <span class="live-badge">Live</span>
          <span class="live-channel-id">ID ${channel.id}</span>
        </div>
        <div class="live-channel-name">${escapeHtml(channel.name)}</div>
        <div class="live-channel-bottom">
          <span>${escapeHtml(channel.region)}</span>
          <span class="live-channel-watch">${ICONS.play}Watch</span>
        </div>
      </button>
      <div class="live-channel-actions">
        ${channel.guideSid
          ? `<button class="live-guide-button" type="button" data-live-guide-id="${channel.id}">Schedule</button>`
          : `<span class="live-guide-unavailable">Schedule unavailable</span>`}
      </div>
    </div>
  `;
}

function setLiveSportsView(view = "featured") {
  const target = view === "all" ? "all" : "featured";
  state.liveSportsView = target;

  liveSportsFeaturedTab?.classList.toggle("active", target === "featured");
  liveSportsAllTab?.classList.toggle("active", target === "all");
  liveSportsFeaturedTab?.setAttribute("aria-selected", String(target === "featured"));
  liveSportsAllTab?.setAttribute("aria-selected", String(target === "all"));

  if (liveSportsFeaturedPanel) liveSportsFeaturedPanel.hidden = target !== "featured";
  if (liveSportsAllPanel) liveSportsAllPanel.hidden = target !== "all";

  if (target === "all" && !state.dlstreamsSchedule && !state.dlstreamsScheduleLoading) {
    void loadAllLiveSportsSchedule();
  }

  if (APP_PAGE === "live") {
    searchInput.disabled = target === "all";
    searchInput.placeholder = target === "all"
      ? "Use the schedule search below…"
      : "Search featured live sports channels...";
  }
}

function normaliseDlCategory(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text || "Other";
}

function dlScheduleSearchText(event) {
  return [
    event?.time,
    event?.event,
    ...(event?.channels || []).flatMap(channel => [channel?.name, channel?.id])
  ].filter(Boolean).join(" ").toLowerCase();
}

const DL_SPORT_CATEGORIES = [
  { key: "football", label: "Football", pattern: /\b(soccer|premier league|championship|league one|league two|national league|champions league|europa|conference league|bundesliga|serie a|la liga|ligue 1|eredivisie|mls|nwsl|usl|fifa|uefa|copa|libertadores|fa cup|carabao|world cup)\b/i },
  { key: "tennis", label: "Tennis", pattern: /\b(tennis|atp|wta|wimbledon|us open|australian open|roland garros)\b/i },
  { key: "basketball", label: "Basketball", pattern: /\b(basketball|nba|wnba|ncaa basketball|euroleague)\b/i },
  { key: "combat", label: "Combat Sports", pattern: /\b(ufc|mma|boxing|wrestling|aew|wwe|fight night|bellator|one championship|eternal mma)\b/i },
  { key: "motorsport", label: "Motorsport", pattern: /\b(formula 1|formula one|f1|motogp|moto gp|nascar|indycar|motorsport|supercars|rally|wec)\b/i },
  { key: "american-football", label: "American Football", pattern: /\b(nfl|cfl|college football|high school football|american football|am\. football|ncaa football)\b/i },
  { key: "baseball", label: "Baseball", pattern: /\b(baseball|mlb|softball|little league|minor league)\b/i },
  { key: "ice-hockey", label: "Ice Hockey", pattern: /\b(ice hockey|nhl|ahl|ohl|khl)\b/i },
  { key: "rugby", label: "Rugby", pattern: /\b(rugby|six nations|super rugby|nrl)\b/i },
  { key: "cricket", label: "Cricket", pattern: /\b(cricket|t20|ashes|test match|odi)\b/i },
  { key: "golf", label: "Golf", pattern: /\b(golf|pga|lpga|ryder cup)\b/i },
  { key: "darts", label: "Darts", pattern: /\b(darts|pdc)\b/i },
  { key: "snooker", label: "Snooker", pattern: /\b(snooker|pool|billiards)\b/i },
  { key: "volleyball", label: "Volleyball", pattern: /\b(volleyball|beach volleyball)\b/i },
  { key: "athletics", label: "Athletics", pattern: /\b(athletics|track and field|diamond league)\b/i }
];

function inferDlSport(group, event) {
  const text = [
    group?.category,
    event?.event,
    ...(event?.channels || []).map(channel => channel?.name)
  ].filter(Boolean).join(" ");
  return DL_SPORT_CATEGORIES.find(category => category.pattern.test(text)) || {
    key: "other",
    label: "Other"
  };
}

function renderAllLiveSportsSchedule() {
  if (!liveSportsAllContent || !liveSportsAllStatus || !liveSportsAllCategories) return;
  const data = state.dlstreamsSchedule;
  const groups = Array.isArray(data?.groups) ? data.groups : [];

  if (!data || !groups.length) {
    liveSportsAllContent.innerHTML = "";
    liveSportsAllCategories.innerHTML = "";
    liveSportsAllStatus.hidden = false;
    liveSportsAllStatus.textContent = state.dlstreamsScheduleLoading
      ? "Loading the live schedule…"
      : "The schedule is unavailable right now. Try Refresh.";
    return;
  }

  const allEvents = groups.flatMap(group => (group.events || []).map(event => ({
    ...event,
    sport: inferDlSport(group, event)
  })));

  const categoryCounts = new Map();
  allEvents.forEach(event => {
    categoryCounts.set(event.sport.key, (categoryCounts.get(event.sport.key) || 0) + 1);
  });

  const availableCategories = [
    ...DL_SPORT_CATEGORIES.filter(category => categoryCounts.has(category.key)),
    ...(categoryCounts.has("other") ? [{ key: "other", label: "Other" }] : [])
  ];

  if (state.dlstreamsScheduleCategory !== "all" &&
      !availableCategories.some(category => category.key === state.dlstreamsScheduleCategory)) {
    state.dlstreamsScheduleCategory = "all";
  }

  const activeCategory = state.dlstreamsScheduleCategory;
  const totalEvents = allEvents.length;
  liveSportsAllCategories.innerHTML = [
    { key: "all", label: "All sports", count: totalEvents },
    ...availableCategories.map(category => ({
      ...category,
      count: categoryCounts.get(category.key) || 0
    }))
  ].map(category => `
    <button class="dl-schedule-category-chip dl-sport-${escapeHtml(category.key)}${activeCategory === category.key ? " active" : ""}"
      type="button" data-dl-category="${escapeHtml(category.key)}">
      <span class="dl-category-dot" aria-hidden="true"></span>
      <span class="dl-category-label">${escapeHtml(category.label)}</span>
      <small>${category.count}</small>
    </button>
  `).join("");

  liveSportsAllCategories.querySelectorAll("[data-dl-category]").forEach(button => {
    button.addEventListener("click", () => {
      state.dlstreamsScheduleCategory = button.dataset.dlCategory || "all";
      renderAllLiveSportsSchedule();
    });
  });

  const query = String(state.dlstreamsScheduleQuery || "").trim().toLowerCase();
  const visibleEvents = allEvents.filter(event => {
    if (activeCategory !== "all" && event.sport.key !== activeCategory) return false;
    return !query || dlScheduleSearchText(event).includes(query);
  });

  liveSportsAllMeta.textContent = `${data.dateLabel || "Today’s live schedule"} · ${visibleEvents.length} event${visibleEvents.length === 1 ? "" : "s"}`;
  liveSportsAllStatus.hidden = true;

  if (!visibleEvents.length) {
    liveSportsAllContent.innerHTML = `
      <div class="dl-schedule-empty">
        <strong>No live events found</strong>
        <span>Try another sport or clear your search.</span>
      </div>`;
    return;
  }

  const sections = availableCategories
    .map(category => ({
      ...category,
      events: visibleEvents.filter(event => event.sport.key === category.key)
    }))
    .filter(section => section.events.length);

  const visibleStreamCount = visibleEvents.reduce((sum, event) => sum + (event.channels || []).length, 0);
  const visibleSportCount = new Set(visibleEvents.map(event => event.sport.key)).size;

  liveSportsAllContent.innerHTML = `
    <div class="dl-schedule-overview">
      <div class="dl-schedule-overview-copy">
        <span class="dl-schedule-overview-kicker">${query ? "Search results" : activeCategory === "all" ? "Today’s schedule" : "Filtered schedule"}</span>
        <strong>${query ? `Results for “${escapeHtml(state.dlstreamsScheduleQuery || "")}` + "”" : activeCategory === "all" ? "Everything live today" : escapeHtml(availableCategories.find(category => category.key === activeCategory)?.label || "Live sport")}</strong>
      </div>
      <div class="dl-schedule-overview-stats" aria-label="Schedule summary">
        <span><strong>${visibleEvents.length}</strong><small>event${visibleEvents.length === 1 ? "" : "s"}</small></span>
        <span><strong>${visibleStreamCount}</strong><small>stream${visibleStreamCount === 1 ? "" : "s"}</small></span>
        <span><strong>${visibleSportCount}</strong><small>sport${visibleSportCount === 1 ? "" : "s"}</small></span>
      </div>
    </div>

    ${sections.map(section => `
      <section class="dl-schedule-group dl-sport-${escapeHtml(section.key)}">
        <div class="dl-schedule-group-head">
          <div class="dl-schedule-group-heading">
            <span class="dl-group-accent" aria-hidden="true"></span>
            <div>
              <h2 class="dl-schedule-group-title">${escapeHtml(section.label)}</h2>
              <span>${section.events.length} event${section.events.length === 1 ? "" : "s"}</span>
            </div>
          </div>
          <button class="dl-group-filter" type="button" data-dl-category-jump="${escapeHtml(section.key)}">View only ${escapeHtml(section.label)}</button>
        </div>
        <div class="dl-schedule-event-list">
          ${section.events.map(event => {
            const channelCount = (event.channels || []).length;
            return `
            <article class="dl-schedule-event">
              <time class="dl-schedule-time"><span>${escapeHtml(event.time || "LIVE")}</span></time>
              <div class="dl-schedule-event-main">
                <div class="dl-schedule-event-title">${escapeHtml(event.event || "Live event")}</div>
                <div class="dl-schedule-event-subtitle">${channelCount} stream${channelCount === 1 ? "" : "s"} available</div>
              </div>
              <div class="dl-schedule-channels">
                ${(event.channels || []).map(channel => `
                  <button class="dl-schedule-channel" type="button"
                    data-dlstream-id="${escapeHtml(channel.id)}"
                    data-dlstream-name="${escapeHtml(channel.name || `Stream ${channel.id}`)}"
                    data-dlstream-event="${escapeHtml(event.event || "Live event")}"
                    data-dlstream-time="${escapeHtml(event.time || "")}">
                    <span class="dl-channel-name">${escapeHtml(channel.name || `Stream ${channel.id}`)}</span>
                    <span class="dl-channel-watch">Watch ${ICONS.play}</span>
                  </button>
                `).join("")}
              </div>
            </article>`;
          }).join("")}
        </div>
      </section>
    `).join("")}`;

  liveSportsAllContent.querySelectorAll("[data-dl-category-jump]").forEach(button => {
    button.addEventListener("click", () => {
      state.dlstreamsScheduleCategory = button.dataset.dlCategoryJump || "all";
      renderAllLiveSportsSchedule();
      liveSportsAllCategories?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  });

  liveSportsAllContent.querySelectorAll("[data-dlstream-id]").forEach(button => {
    button.addEventListener("click", () => openDlstreamsScheduleStream({
      id: button.dataset.dlstreamId,
      name: button.dataset.dlstreamName,
      event: button.dataset.dlstreamEvent,
      time: button.dataset.dlstreamTime
    }));
  });
}

async function loadAllLiveSportsSchedule({ force = false } = {}) {
  if (state.dlstreamsScheduleLoading) return;
  if (state.dlstreamsSchedule && !force) {
    renderAllLiveSportsSchedule();
    return;
  }

  state.dlstreamsScheduleLoading = true;
  if (liveSportsAllStatus) {
    liveSportsAllStatus.hidden = false;
    liveSportsAllStatus.textContent = "Loading the live schedule…";
  }
  if (liveSportsAllReload) liveSportsAllReload.disabled = true;

  try {
    const data = await apiFetch("/api/dlstreams/schedule");
    state.dlstreamsSchedule = data;
    state.dlstreamsScheduleCategory = "all";
    renderAllLiveSportsSchedule();
  } catch (error) {
    console.error("DLStreams schedule failed", error);
    if (liveSportsAllStatus) {
      liveSportsAllStatus.hidden = false;
      liveSportsAllStatus.textContent = error.message || "Could not load the live schedule.";
    }
    if (liveSportsAllContent) liveSportsAllContent.innerHTML = "";
  } finally {
    state.dlstreamsScheduleLoading = false;
    if (liveSportsAllReload) liveSportsAllReload.disabled = false;
  }
}

function reloadAllLiveSports() {
  state.dlstreamsSchedule = null;
  void loadAllLiveSportsSchedule({ force: true });
}

function openDlstreamsScheduleStream(channel) {
  if (!channel?.id || !requireSignedInForPlayback()) return;

  heroTrailerCommand("pauseVideo");
  closeModal();
  state.activePlayback = null;
  state.pendingEpisodeAdvance = false;
  state.episodeAdvanceInFlight = false;

  const title = channel.event || channel.name || "Live Sports";
  playerTitle.textContent = title;
  playerSubtitle.textContent = [channel.time, channel.name].filter(Boolean).join(" · ") || "Live";
  document.title = `${title} | TV Archive`;

  playerFrame.setAttribute(
    "sandbox",
    "allow-scripts allow-same-origin allow-forms allow-presentation"
  );
  playerFrame.src = `${LIVE_STREAM_BASE}${encodeURIComponent(channel.id)}.php`;
  playerScreen.classList.add("open");
  playerScreen.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";

  history.pushState(
    { player: true, mediaType: "live", channelId: channel.id, title },
    "",
    `#live=${encodeURIComponent(channel.id)}`
  );
}

function renderLiveSports(query = "") {
  const term = String(query || "").trim().toLowerCase();
  const channels = term
    ? LIVE_SPORTS_CHANNELS.filter(channel =>
        channel.name.toLowerCase().includes(term) ||
        channel.region.toLowerCase().includes(term) ||
        String(channel.id).includes(term)
      )
    : LIVE_SPORTS_CHANNELS;

  if (!channels.length) {
    liveSportsContent.innerHTML = `<div class="live-sports-empty">No live channels match "${escapeHtml(query)}".</div>`;
    return;
  }

  const regions = [...new Set(channels.map(channel => channel.region))];
  liveSportsContent.innerHTML = regions.map(region => {
    const regionChannels = channels.filter(channel => channel.region === region);
    return `
      <section class="live-sports-group">
        <div class="live-sports-group-head">
          <h2>${escapeHtml(region)}</h2>
          <small>${regionChannels.length} channel${regionChannels.length === 1 ? "" : "s"}</small>
        </div>
        <div class="live-channel-grid">
          ${regionChannels.map(liveChannelMarkup).join("")}
        </div>
      </section>
    `;
  }).join("");

  liveSportsContent.querySelectorAll("[data-live-channel-id]").forEach(button => {
    button.addEventListener("click", () => {
      const channel = LIVE_SPORTS_CHANNELS.find(item =>
        String(item.id) === String(button.dataset.liveChannelId)
      );
      if (channel) openLiveSportsChannel(channel);
    });
  });

  liveSportsContent.querySelectorAll("[data-live-guide-id]").forEach(button => {
    button.addEventListener("click", () => {
      const channel = LIVE_SPORTS_CHANNELS.find(item =>
        String(item.id) === String(button.dataset.liveGuideId)
      );
      if (channel) openLiveSchedule(channel);
    });
  });
}

function guideDate(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const part = type => parts.find(item => item.type === type)?.value || "";
  const date = new Date(Date.UTC(Number(part("year")), Number(part("month")) - 1, Number(part("day"))));
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function formatGuideTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function closeLiveSchedule() {
  liveScheduleWrap.classList.remove("open");
  liveScheduleWrap.setAttribute("aria-hidden", "true");
  state.liveScheduleChannel = null;
  if (!playerScreen.classList.contains("open") && !modalWrap.classList.contains("open") && !authModalWrap.classList.contains("open")) {
    document.body.style.overflow = "";
  }
}

async function loadLiveSchedule(channel, offsetDays = 0) {
  if (!channel?.guideSid) return;
  const date = guideDate(offsetDays);
  state.liveScheduleOffset = offsetDays;
  liveScheduleToday.classList.toggle("active", offsetDays === 0);
  liveScheduleTomorrow.classList.toggle("active", offsetDays === 1);
  liveScheduleList.innerHTML = `<div class="live-schedule-status"><div class="spinner"></div> Loading schedule…</div>`;

  try {
    const data = await apiFetch(`/api/live-sports/schedule/${encodeURIComponent(channel.id)}?date=${encodeURIComponent(date)}`);
    if (state.liveScheduleChannel?.id !== channel.id || state.liveScheduleOffset !== offsetDays) return;
    const events = Array.isArray(data?.events) ? data.events : [];
    const now = Date.now();

    if (!events.length) {
      liveScheduleList.innerHTML = `<div class="live-schedule-status">No listings were returned for this date.</div>`;
      return;
    }

    liveScheduleList.innerHTML = events.map(event => {
      const start = new Date(event.start).getTime();
      const end = new Date(event.end).getTime();
      const isNow = offsetDays === 0 && Number.isFinite(start) && Number.isFinite(end) && now >= start && now < end;
      return `
        <div class="live-schedule-item${isNow ? " now" : ""}">
          <div class="live-schedule-time">${formatGuideTime(event.start)} – ${formatGuideTime(event.end)}</div>
          <div>
            <div class="live-schedule-title">${escapeHtml(event.title || "Untitled")}${isNow ? '<span class="live-schedule-now-badge">Now</span>' : ""}</div>
            ${event.synopsis ? `<div class="live-schedule-synopsis">${escapeHtml(event.synopsis)}</div>` : ""}
          </div>
        </div>
      `;
    }).join("");

    const current = liveScheduleList.querySelector(".live-schedule-item.now");
    if (current) current.scrollIntoView({ block: "center" });
  } catch (error) {
    console.error("Live sports schedule failed", error);
    if (state.liveScheduleChannel?.id !== channel.id || state.liveScheduleOffset !== offsetDays) return;
    liveScheduleList.innerHTML = `<div class="live-schedule-status">Schedule could not be loaded right now. Try again shortly.</div>`;
  }
}

function openLiveSchedule(channel) {
  if (!channel?.guideSid) return;
  state.liveScheduleChannel = channel;
  state.liveScheduleOffset = 0;
  document.body.style.overflow = "hidden";
  liveScheduleTitle.textContent = channel.name;
  liveScheduleSubtitle.textContent = "Times shown in UK time · Sky programme guide";
  liveScheduleWrap.classList.add("open");
  liveScheduleWrap.setAttribute("aria-hidden", "false");
  loadLiveSchedule(channel, 0);
}

function showLiveSportsView(query = searchInput.value) {
  state.activeCollection = null;
  state.searchTerm = String(query || "").trim();
  collectionSection.style.display = "none";
  collectionActions.style.display = "none";
  searchResultsSection.style.display = "none";
  rowsContainer.style.display = "none";
  heroSection.style.display = "none";
  continueSection.style.display = "none";
  catalogueActions.style.display = "none";
  liveSportsSection.style.display = "block";
  renderLiveSports(query);
  setLiveSportsView(state.liveSportsView);
}

function hideLiveSportsView() {
  liveSportsSection.style.display = "none";
  continueSection.style.display = "";
  searchInput.disabled = false;
  searchInput.placeholder = "Search movies and TV shows...";

  // Live Sports hides the normal catalogue surfaces. Restore whichever
  // catalogue view should be visible when leaving that tab. Without this,
  // the rows and hero remain display:none, leaving only Continue Watching.
  if (state.typeScope === "live") return;

  if (state.activeCollection) {
    collectionSection.style.display = "block";
    searchResultsSection.style.display = "none";
    rowsContainer.style.display = "none";
    heroSection.style.display = "none";
    return;
  }

  if (state.searchTerm) {
    collectionSection.style.display = "none";
    searchResultsSection.style.display = "block";
    rowsContainer.style.display = "none";
    heroSection.style.display = "none";
    return;
  }

  collectionSection.style.display = "none";
  searchResultsSection.style.display = "none";
  rowsContainer.style.display = "";
  heroSection.style.display = state.heroMedia ? "block" : "none";
}

function openLiveSportsChannel(channel) {
  if (!requireSignedInForPlayback()) return;

  heroTrailerCommand("pauseVideo");
  closeModal();
  // Live streams have no resume position, so they never enter watch history
  // and never create Neon progress writes.
  state.activePlayback = null;
  state.pendingEpisodeAdvance = false;
  state.episodeAdvanceInFlight = false;

  playerTitle.textContent = channel.name;
  playerSubtitle.textContent = `Live · ${channel.region}`;
  document.title = `${channel.name} | TV Archive`;

  // Only live-sports embeds are sandboxed. The movie/TV provider detects
  // sandboxed frames and refuses playback, so those launches explicitly
  // remove this attribute in launchPlayer(). This live-stream sandbox keeps
  // scripts/video working while withholding popup/top-navigation privileges.
  playerFrame.setAttribute(
    "sandbox",
    "allow-scripts allow-same-origin allow-forms allow-presentation"
  );
  playerFrame.src = `${LIVE_STREAM_BASE}${encodeURIComponent(channel.id)}.php`;
  playerScreen.classList.add("open");
  playerScreen.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";

  history.pushState(
    { player: true, mediaType: "live", channelId: channel.id, title: channel.name },
    "",
    `#live=${encodeURIComponent(channel.id)}`
  );
}

function requireSignedInForPlayback() {
  if (state.user) return true;
  closeModal();
  openAuthModal("signin");
  authSubtitle.textContent = "Sign in with your username before you can watch.";
  return false;
}

async function getPlaybackUrl(media, { mediaType, season = null, episode = null, startAt = 0 }) {
  const params = new URLSearchParams({
    type: mediaType,
    imdbId: getImdbId(media),
    startAt: String(Math.max(0, Math.floor(Number(startAt) || 0)))
  });
  if (mediaType === "tv") {
    params.set("season", String(season));
    params.set("episode", String(episode));
  }
  const data = await apiFetch(`/api/playback-url?${params.toString()}`);
  if (!data?.url) throw new Error("Playback URL was not available.");
  return data.url;
}

function launchPlayer(media, url, subtitle, playbackState) {
  heroTrailerCommand("pauseVideo");
  state.activePlayback = { media, ...playbackState };
  state.lastProgressWrite = 0;
  state.pendingEpisodeAdvance = false;
  state.episodeAdvanceInFlight = false;
  playerTitle.textContent = getMediaName(media);
  playerSubtitle.textContent = subtitle;

  if (playbackState?.mediaType === "tv") {
    document.title = `${getMediaName(media)} · S${playbackState.season}E${playbackState.episode} | TV Archive`;
  } else {
    document.title = `${getMediaName(media)} | TV Archive`;
  }

  // Movies and TV must not be sandboxed: the playback provider rejects
  // sandboxed embeds ("Please Disable Sandbox").
  playerFrame.removeAttribute("sandbox");
  playerFrame.src = url;
  playerScreen.classList.add("open");
  playerScreen.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function getEpisodeFromPlayerMessage(message) {
  const candidates = [
    message?.data,
    message?.data?.media,
    message?.data?.metadata,
    message?.media,
    message?.metadata,
    message
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;

    const season = Number(
      candidate.season ?? candidate.seasonNumber ?? candidate.season_number
    );
    const episode = Number(
      candidate.episode ?? candidate.episodeNumber ?? candidate.episode_number
    );

    if (Number.isInteger(season) && season > 0 &&
        Number.isInteger(episode) && episode > 0) {
      return { season, episode };
    }
  }

  return null;
}

function syncActiveTvEpisode(season, episode) {
  const active = state.activePlayback;
  if (!active || active.mediaType !== "tv") return false;

  season = Number(season);
  episode = Number(episode);
  if (!Number.isInteger(season) || !Number.isInteger(episode)) return false;

  const changed =
    Number(active.season) !== season ||
    Number(active.episode) !== episode;

  if (!changed) return false;

  active.season = season;
  active.episode = episode;
  state.lastProgressWrite = 0;
  state.pendingEpisodeAdvance = false;

  const episodeData = findKnownEpisode(active.media, season, episode);
  const episodeName = episodeData?.name || "";

  playerTitle.textContent = getMediaName(active.media);
  playerSubtitle.textContent =
    `Season ${season} · Episode ${episode}` +
    (episodeName ? ` · ${episodeName}` : "");
  document.title = `${getMediaName(active.media)} · S${season}E${episode} | TV Archive`;

  const entry = makeWatchEntry(active.media, {
    mediaType: "tv",
    season,
    episode
  }, null);
  entry.currentTime = 0;
  entry.duration = 0;
  entry.lastWatched = Date.now();
  saveWatchEntry(entry);

  if (!episodeName) {
    const mediaAtLookup = active.media;
    void resolveEpisodeData(mediaAtLookup, season, episode).then(resolved => {
      const resolvedName = String(resolved?.name || "").trim();
      const current = state.activePlayback;
      if (!resolvedName || !current || current.mediaType !== "tv" ||
          !isSameTvShow(current.media, mediaAtLookup) ||
          Number(current.season) !== season || Number(current.episode) !== episode) {
        return;
      }

      playerSubtitle.textContent = `Season ${season} · Episode ${episode} · ${resolvedName}`;
      const saved = getSavedPlayback(getImdbId(mediaAtLookup));
      if (saved && Number(saved.season) === season && Number(saved.episode) === episode &&
          saved.episodeName !== resolvedName) {
        setWatchHistory(getWatchHistory().map(item =>
          item.imdbId === saved.imdbId ? { ...item, episodeName: resolvedName } : item
        ));
        renderContinueWatching();
      }
    });
  }

  const imdbId = getImdbId(active.media);
  if (imdbId && location.hash.startsWith("#watch=")) {
    history.replaceState(
      {
        player: true,
        mediaType: "tv",
        title: getMediaName(active.media),
        season,
        episode
      },
      "",
      `#watch=${encodeURIComponent(imdbId)}-s${season}e${episode}`
    );
  }

  return true;
}

async function getNextEpisodeForActivePlayback() {
  const active = state.activePlayback;
  if (!active || active.mediaType !== "tv") return null;

  let episodes = [];
  const showId = Number(active.media?.id || 0);

  if (state.currentEpisodes.length && isSameTvShow(state.currentShow, active.media)) {
    episodes = state.currentEpisodes;
  }

  if (!episodes.length && showId) {
    try {
      episodes = await fetchEpisodesForShow(active.media);

      // Keep the episode names available for the player heading and history card.
      state.currentShow = active.media;
      state.currentEpisodes = episodes;
    } catch (error) {
      console.warn("Could not load the next episode from TVMaze.", error);
    }
  }

  if (episodes.length) {
    const ordered = [...episodes].sort((a, b) =>
      a.season - b.season || a.number - b.number
    );
    const currentIndex = ordered.findIndex(item =>
      Number(item.season) === Number(active.season) &&
      Number(item.number) === Number(active.episode)
    );

    if (currentIndex >= 0 && currentIndex + 1 < ordered.length) {
      const next = ordered[currentIndex + 1];
      return { season: Number(next.season), episode: Number(next.number) };
    }
  }

  // Fallback if TVMaze is temporarily unavailable. This still handles the
  // common case of moving to the next episode within the same season.
  return { season: Number(active.season), episode: Number(active.episode) + 1 };
}

async function syncToNextEpisodeAfterPlayerAdvance(currentTime, duration, eventName) {
  if (state.episodeAdvanceInFlight) return;
  state.episodeAdvanceInFlight = true;

  try {
    const next = await getNextEpisodeForActivePlayback();
    if (!next || !state.activePlayback) return;

    syncActiveTvEpisode(next.season, next.episode);
    updatePlaybackProgress(currentTime, duration, eventName);
  } finally {
    state.pendingEpisodeAdvance = false;
    state.episodeAdvanceInFlight = false;
  }
}

async function openEpisode(show, season, episode, options = {}) {
  if (!requireSignedInForPlayback()) return;
  closeModal();
  const imdbId = getImdbId(show);
  const existing = getSavedPlayback(imdbId);
  const requestedStart = Number(options.startAt);
  const isSameEpisode = existing?.mediaType !== "movie" &&
    Number(existing?.season) === Number(season) &&
    Number(existing?.episode) === Number(episode);
  const startAt = Number.isFinite(requestedStart)
    ? requestedStart
    : isSameEpisode ? Number(existing?.currentTime) || 0 : 0;

  try {
    const [playbackUrl, episodeData] = await Promise.all([
      getPlaybackUrl(show, {
        mediaType: "tv",
        season: Number(season),
        episode: Number(episode),
        startAt
      }),
      resolveEpisodeData(show, season, episode)
    ]);
    const episodeName = String(episodeData?.name ||
      (isSameEpisode ? existing?.episodeName : "") || "").trim();

    const watchEntry = makeWatchEntry(show, {
      mediaType: "tv",
      season: Number(season),
      episode: Number(episode),
      episodeName
    }, isSameEpisode ? existing : null);
    watchEntry.lastWatched = Date.now();
    saveWatchEntry(watchEntry);

    launchPlayer(
      show,
      playbackUrl,
      `Season ${season} · Episode ${episode}` +
        (episodeName ? ` · ${episodeName}` : "") +
        (startAt >= 5 ? ` · Resuming at ${formatWatchTime(startAt)}` : ""),
      { mediaType: "tv", season: Number(season), episode: Number(episode) }
    );

    history.pushState(
      { player: true, mediaType: "tv", title: getMediaName(show), season, episode },
      "",
      `#watch=${encodeURIComponent(imdbId)}-s${season}e${episode}`
    );
  } catch (error) {
    if (error.status === 401) {
      clearAuthSession();
      openAuthModal("signin");
      authSubtitle.textContent = "Your session expired. Sign in again to keep watching.";
      return;
    }
    console.error("Could not start episode", error);
    alert(error.message || "Could not start this episode.");
  }
}

async function updateModalLibraryActions(media, { load = true } = {}) {
  if (!media) return;
  state.modalMedia = media;
  modalListPicker.hidden = true;
  if (!state.user) {
    watchLaterButton.textContent = "+ Watch Later";
    addToListButton.textContent = "+ Add to list";
    return;
  }
  if (load && !state.personalLibraryLoaded) {
    try {
      await ensurePersonalLibraryLoaded();
      if (state.modalMedia === media) updateModalLibraryActions(media, { load: false });
    } catch (error) {
      console.error("Could not load saved library", error);
    }
    return;
  }
  const imdbId = getImdbId(media);
  const inWatchLater = state.watchLater.some(item => item.imdbId === imdbId);
  watchLaterButton.textContent = inWatchLater ? "✓ In Watch Later" : "+ Watch Later";
  addToListButton.textContent = "+ Add to list";
}

async function toggleModalWatchLater() {
  if (!state.modalMedia) return;
  if (!state.user) {
    openAuthModal("signin");
    authSubtitle.textContent = "Sign in to save titles to Watch Later.";
    return;
  }
  watchLaterButton.disabled = true;
  try {
    await ensurePersonalLibraryLoaded();
    const item = libraryItemFromMedia(state.modalMedia);
    const exists = state.watchLater.some(entry => entry.imdbId === item.imdbId);
    if (exists) {
      await apiFetch(`/api/watch-later/${encodeURIComponent(item.imdbId)}`, { method: "DELETE" });
      state.watchLater = state.watchLater.filter(entry => entry.imdbId !== item.imdbId);
    } else {
      const data = await apiFetch(`/api/watch-later/${encodeURIComponent(item.imdbId)}`, {
        method: "PUT", body: JSON.stringify(item)
      });
      state.watchLater = [data.entry || item, ...state.watchLater.filter(entry => entry.imdbId !== item.imdbId)];
    }
    updateModalLibraryActions(state.modalMedia, { load: false });
    if (state.profileOpen) renderProfilePage();
  } catch (error) {
    window.alert(error.message || "Could not update Watch Later.");
  } finally { watchLaterButton.disabled = false; }
}

async function toggleModalListPicker() {
  if (!state.modalMedia) return;
  if (!state.user) {
    openAuthModal("signin");
    authSubtitle.textContent = "Sign in to add titles to your lists.";
    return;
  }
  try {
    await ensurePersonalLibraryLoaded();
    modalListPicker.hidden = !modalListPicker.hidden;
    if (modalListPicker.hidden) return;
    if (!state.userLists.length) {
      modalListPickerOptions.innerHTML = '<span class="profile-form-message">Create a list from Profile → My Lists first.</span>';
      return;
    }
    const imdbId = getImdbId(state.modalMedia);
    modalListPickerOptions.innerHTML = state.userLists.map(list => {
      const included = (list.items || []).some(item => item.imdbId === imdbId);
      return `<button type="button" data-modal-list="${escapeHtml(list.id)}">${included ? "✓ " : "+ "}${escapeHtml(list.name)}</button>`;
    }).join("");
    modalListPickerOptions.querySelectorAll("[data-modal-list]").forEach(button => {
      button.addEventListener("click", () => addModalMediaToList(button.dataset.modalList));
    });
  } catch (error) { window.alert(error.message || "Could not load your lists."); }
}

async function addModalMediaToList(listId) {
  const media = state.modalMedia;
  const list = state.userLists.find(item => String(item.id) === String(listId));
  if (!media || !list) return;
  const libraryItem = libraryItemFromMedia(media);
  const exists = (list.items || []).some(item => item.imdbId === libraryItem.imdbId);
  try {
    if (exists) {
      await apiFetch(`/api/lists/${encodeURIComponent(list.id)}/items/${encodeURIComponent(libraryItem.imdbId)}`, { method: "DELETE" });
      list.items = (list.items || []).filter(item => item.imdbId !== libraryItem.imdbId);
    } else {
      const data = await apiFetch(`/api/lists/${encodeURIComponent(list.id)}/items/${encodeURIComponent(libraryItem.imdbId)}`, {
        method: "PUT", body: JSON.stringify(libraryItem)
      });
      list.items = [data.item || libraryItem, ...(list.items || []).filter(item => item.imdbId !== libraryItem.imdbId)];
    }
    toggleModalListPicker();
    if (state.profileOpen) renderProfilePage();
  } catch (error) { window.alert(error.message || "Could not update this list."); }
}

function openMovieDetails(movie) {
  if (!movie || !getImdbId(movie)) return;

  state.currentShow = null;
  state.currentEpisodes = [];
  modalEyebrow.textContent = "Movie";
  modalTitle.textContent = getMediaName(movie);
  modalDescription.textContent = getMediaSummary(movie) || "Ready to watch.";
  updateModalLibraryActions(movie);

  const bg = getMediaBackdrop(movie);
  modalBanner.style.backgroundImage = bg
    ? `url("${bg}")`
    : "linear-gradient(135deg, rgba(236,53,56,.22), #151821)";

  seasonLabel.style.display = "none";
  modalSelectorBar.style.display = "flex";
  episodeGrid.style.display = "none";
  continueButton.disabled = false;
  continueButton.innerHTML = `${ICONS.play}Play movie`;
  continueButton.onclick = () => openMovie(movie);

  heroTrailerCommand("pauseVideo");
  modalWrap.classList.add("open");
  modalWrap.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  loadModalTrailer(movie);
}

async function openMovie(movie, options = {}) {
  if (!requireSignedInForPlayback()) return;
  closeModal();
  const imdbId = getImdbId(movie);
  if (!imdbId) return;

  const existing = getSavedPlayback(imdbId);
  const requestedStart = Number(options.startAt);
  const startAt = Number.isFinite(requestedStart)
    ? requestedStart
    : existing?.mediaType === "movie" ? Number(existing.currentTime) || 0 : 0;

  try {
    const playbackUrl = await getPlaybackUrl(movie, { mediaType: "movie", startAt });

    const watchEntry = makeWatchEntry(movie, { mediaType: "movie" },
      existing?.mediaType === "movie" ? existing : null);
    watchEntry.lastWatched = Date.now();
    saveWatchEntry(watchEntry);

    launchPlayer(
      movie,
      playbackUrl,
      "Movie" + (startAt >= 5 ? ` · Resuming at ${formatWatchTime(startAt)}` : ""),
      { mediaType: "movie", season: null, episode: null }
    );

    history.pushState(
      { player: true, mediaType: "movie", title: getMediaName(movie) },
      "",
      `#watch=${encodeURIComponent(imdbId)}-movie`
    );
  } catch (error) {
    if (error.status === 401) {
      clearAuthSession();
      openAuthModal("signin");
      authSubtitle.textContent = "Your session expired. Sign in again to keep watching.";
      return;
    }
    console.error("Could not start movie", error);
    alert(error.message || "Could not start this movie.");
  }
}

function stopPlayerFrame() {
  // Removing the iframe destroys its browsing context immediately, which is
  // more reliable than merely hiding it or assigning an empty src. Reinsert
  // the same element so it is ready for the next launch.
  const frameWrap = playerFrame.parentElement;
  playerFrame.remove();
  playerFrame.removeAttribute("src");
  if (frameWrap) frameWrap.appendChild(playerFrame);
}

function closePlayer({ resetRoute = true } = {}) {
  syncActivePlaybackOnExit();
  playerScreen.classList.remove("open");
  playerScreen.setAttribute("aria-hidden", "true");
  stopPlayerFrame();
  state.activePlayback = null;
  state.pendingEpisodeAdvance = false;
  state.episodeAdvanceInFlight = false;
  document.body.style.overflow = "";
  document.title = "TV Archive";
  if (heroSection.style.display !== "none") heroTrailerCommand("playVideo");

  // Do not depend on history.back(): if another #watch entry is underneath
  // the current one, the app can return to the menu while leaving the watch
  // URL active. Explicitly restore the TV Archive route instead.
  if (resetRoute && (location.hash.startsWith("#watch=") || location.hash.startsWith("#live="))) {
    history.replaceState(
      { player: false },
      "",
      `${location.pathname}${location.search}`
    );
  }
}

async function openShow(show) {
  if (!validPlayableShow(show)) return;

  state.currentShow = show;
  state.currentSeason = 1;
  state.currentEpisodes = [];
  modalEyebrow.textContent = "TV Series";
  modalTitle.textContent = show.name;
  modalDescription.textContent = getMediaSummary(show) || "Loading episode information…";
  updateModalLibraryActions(show);

  seasonLabel.style.display = "";
  modalSelectorBar.style.display = "flex";
  episodeGrid.style.display = "grid";

  const bg = getMediaBackdrop(show);
  modalBanner.style.backgroundImage = bg
    ? `url("${bg}")`
    : "linear-gradient(135deg, rgba(236,53,56,.22), #151821)";

  seasonSelect.innerHTML = `<option>Loading…</option>`;
  seasonSelect.disabled = true;
  continueButton.disabled = true;
  episodeGrid.innerHTML = `
    <div class="status-card">
      <div><div class="spinner"></div>Loading episodes…</div>
    </div>
  `;

  heroTrailerCommand("pauseVideo");
  modalWrap.classList.add("open");
  modalWrap.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  loadModalTrailer(show);

  try {
    const episodes = await fetchJson(`${TVMAZE_API}/shows/${show.id}/episodes`);
    state.currentEpisodes = episodes.filter(episode =>
      Number.isInteger(episode.season) && Number.isInteger(episode.number)
    );
    if (Number(show.id || 0)) {
      episodeMetadataCache.set(Number(show.id), state.currentEpisodes);
    }

    const seasons = [...new Set(state.currentEpisodes.map(episode => episode.season))]
      .sort((a, b) => a - b);

    if (!seasons.length) {
      seasonSelect.innerHTML = "";
      episodeGrid.innerHTML = `<div class="status-card">No numbered episodes were found for this show.</div>`;
      return;
    }

    seasonSelect.innerHTML = seasons.map(
      season => `<option value="${season}">Season ${season}</option>`
    ).join("");
    seasonSelect.disabled = false;
    state.currentSeason = seasons[0];
    renderEpisodes();
  } catch (error) {
    console.error(error);
    seasonSelect.innerHTML = "";
    episodeGrid.innerHTML = `<div class="status-card">Could not load episodes for this show.</div>`;
  }
}

function renderEpisodes() {
  const show = state.currentShow;
  const season = Number(seasonSelect.value);
  state.currentSeason = season;

  const episodes = state.currentEpisodes
    .filter(episode => episode.season === season)
    .sort((a, b) => a.number - b.number);

  if (!episodes.length) {
    episodeGrid.innerHTML = `<div class="status-card">No episodes found for this season.</div>`;
    continueButton.disabled = true;
    return;
  }

  episodeGrid.innerHTML = episodes.map(episode => `
    <button class="episode" data-episode="${episode.number}">
      <strong>Episode ${episode.number}</strong>
      <span class="episode-name">${escapeHtml(episode.name || "")}</span>
      <small>S${season} E${episode.number}</small>
    </button>
  `).join("");

  episodeGrid.querySelectorAll(".episode").forEach(button => {
    button.addEventListener("click", () =>
      openEpisode(show, season, Number(button.dataset.episode))
    );
  });

  continueButton.disabled = false;
  continueButton.innerHTML = `${ICONS.play}Play episode ${episodes[0].number}`;
  continueButton.onclick = () => openEpisode(show, season, episodes[0].number);
}

function closeModal() {
  clearModalTrailer();
  modalListPicker.hidden = true;
  state.modalMedia = null;
  modalWrap.classList.remove("open");
  modalWrap.setAttribute("aria-hidden", "true");
  seasonLabel.style.display = "";
  episodeGrid.style.display = "grid";
  if (!playerScreen.classList.contains("open")) {
    document.body.style.overflow = "";
    if (heroSection.style.display !== "none") heroTrailerCommand("playVideo");
  }
}

seasonSelect.addEventListener("change", renderEpisodes);

searchInput.addEventListener("input", event => {
  clearTimeout(state.searchTimer);
  const value = event.target.value;
  if (APP_PAGE !== "search" && APP_PAGE !== "live") {
    state.searchTimer = setTimeout(() => {
      const query = value.trim();
      if (query) {
        const scope = ["tv", "movie"].includes(state.typeScope) ? state.typeScope : "all";
        navigateToPage(`./search.html?q=${encodeURIComponent(query)}&scope=${encodeURIComponent(scope)}`);
      }
    }, 500);
    return;
  }
  state.searchTimer = setTimeout(() => searchCatalogue(value), 300);
});

loadMoreButton.addEventListener("click", loadMoreTitles);
collectionLoadMoreButton.addEventListener("click", loadMoreCollectionTitles);
collectionBack.addEventListener("click", () => {
  if (APP_PAGE === "collection") {
    if (window.history.length > 1) navigateToPage("", { back: true });
    else navigateToPage("./index.html");
    return;
  }
  closeCollectionView();
});

accountButton.addEventListener("click", event => {
  event.stopPropagation();
  if (!state.user) {
    openAuthModal("signin");
    return;
  }
  accountMenu.hidden ? openAccountMenu() : closeAccountMenu();
});
accountMenu.addEventListener("click", event => event.stopPropagation());
discoverPageBack.addEventListener("click", () => navigateToPage("./index.html"));
profileButton.addEventListener("click", () => navigateToPage("./profile.html"));
logoutButton.addEventListener("click", logoutAccount);
profileBack.addEventListener("click", () => navigateToPage("./index.html"));
profileTabs.addEventListener("click", event => {
  const button = event.target.closest("[data-profile-tab]");
  if (button) setProfileTab(button.dataset.profileTab);
});
profileClearHistory.addEventListener("click", clearProfileHistory);
profilePictureInput.addEventListener("change", changeProfilePicture);
profilePictureRemove.addEventListener("click", removeProfilePicture);
createListForm.addEventListener("submit", createUserList);
discoverListsRefresh.addEventListener("click", refreshDiscoverLists);
discoverListBack.addEventListener("click", renderDiscoverLists);
profileUsernameForm.addEventListener("submit", submitProfileUsername);
profilePasswordForm.addEventListener("submit", submitProfilePassword);
profileLogoutButton.addEventListener("click", logoutAccount);
watchLaterButton.addEventListener("click", toggleModalWatchLater);
addToListButton.addEventListener("click", toggleModalListPicker);
authClose.addEventListener("click", closeAuthModal);
authSignInTab.addEventListener("click", () => setAuthMode("signin"));
authRegisterTab.addEventListener("click", () => setAuthMode("register"));
authForm.addEventListener("submit", submitAuthForm);
authModalWrap.addEventListener("click", event => {
  if (event.target === authModalWrap) closeAuthModal();
});
document.addEventListener("click", closeAccountMenu);

document.addEventListener("click", event => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target.closest("a[href]");
  if (!link || link.target || link.hasAttribute("download")) return;

  const target = new URL(link.href, window.location.href);
  if (target.origin !== window.location.origin || !/\.html$/i.test(target.pathname)) return;

  event.preventDefault();
  navigateToPage(target.href);
}, true);

el("closeModal").addEventListener("click", closeModal);
el("playerBack").addEventListener("click", () => closePlayer());

liveScheduleClose.addEventListener("click", closeLiveSchedule);
liveScheduleWrap.addEventListener("click", event => {
  if (event.target === liveScheduleWrap) closeLiveSchedule();
});
liveScheduleToday.addEventListener("click", () => {
  if (state.liveScheduleChannel) loadLiveSchedule(state.liveScheduleChannel, 0);
});
liveScheduleTomorrow.addEventListener("click", () => {
  if (state.liveScheduleChannel) loadLiveSchedule(state.liveScheduleChannel, 1);
});

liveSportsFeaturedTab?.addEventListener("click", () => setLiveSportsView("featured"));
liveSportsAllTab?.addEventListener("click", () => setLiveSportsView("all"));
liveSportsAllReload?.addEventListener("click", reloadAllLiveSports);
liveSportsAllSearch?.addEventListener("input", () => {
  state.dlstreamsScheduleQuery = liveSportsAllSearch.value;
  renderAllLiveSportsSchedule();
});

modalWrap.addEventListener("click", event => {
  if (event.target === modalWrap) closeModal();
});

window.addEventListener("message", event => {
  if (!isVidFastOrigin(event.origin)) return;
  if (event.source !== playerFrame.contentWindow) return;

  let message = event.data;
  if (typeof message === "string") {
    try {
      message = JSON.parse(message);
    } catch {
      return;
    }
  }

  if (!message || typeof message !== "object") return;

  // VidFast may include the current season/episode in PLAYER_EVENT or
  // MEDIA_DATA messages. If it does, treat that as the source of truth.
  const playerEpisode = getEpisodeFromPlayerMessage(message);
  if (playerEpisode && state.activePlayback?.mediaType === "tv") {
    syncActiveTvEpisode(playerEpisode.season, playerEpisode.episode);
  }

  if (message.type !== "PLAYER_EVENT" && message.type !== "MEDIA_DATA") return;

  const data = message.data || message;
  const eventName = data.event || "";
  const currentTime = Number(data.currentTime);
  const duration = Number(data.duration);
  const hasPlaybackTime =
    Number.isFinite(currentTime) || Number.isFinite(duration);

  if (message.type === "PLAYER_EVENT" && eventName === "ended" &&
      state.activePlayback?.mediaType === "tv") {
    // Save the completed episode first, then wait for VidFast to start the
    // next one. The next play/timeupdate event will move the outer app too.
    if (hasPlaybackTime) {
      updatePlaybackProgress(currentTime, duration, eventName);
    }
    state.pendingEpisodeAdvance = true;
    return;
  }

  const looksLikeFreshEpisodePlayback =
    state.pendingEpisodeAdvance &&
    state.activePlayback?.mediaType === "tv" &&
    ["play", "timeupdate", "playerstatus"].includes(eventName) &&
    Number.isFinite(currentTime) && currentTime >= 0 && currentTime < 60;

  if (looksLikeFreshEpisodePlayback) {
    // If VidFast did not include season/episode metadata, infer the next
    // episode from TVMaze only after the new video actually begins.
    syncToNextEpisodeAfterPlayerAdvance(currentTime, duration, eventName);
    return;
  }

  if (hasPlaybackTime) {
    updatePlaybackProgress(currentTime, duration, eventName);
  }
});

window.addEventListener("popstate", () => {
  if (playerScreen.classList.contains("open")) closePlayer({ resetRoute: false });
});

// A normal fetch can be cancelled when the page is torn down. keepalive lets
// the final exit checkpoint finish without adding any periodic Neon writes.
window.addEventListener("pagehide", () => {
  if (playerScreen.classList.contains("open")) {
    syncActivePlaybackOnExit({ keepalive: true });
  }
});

document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  closeAccountMenu();
  if (playerScreen.classList.contains("open")) {
    closePlayer();
    return;
  }
  if (authModalWrap.classList.contains("open")) {
    closeAuthModal();
    return;
  }
  if (liveScheduleWrap.classList.contains("open")) {
    closeLiveSchedule();
    return;
  }
  if (modalWrap.classList.contains("open")) closeModal();
});

async function initialiseTVArchive() {
  migrateWatchHistory();

  const initialParams = new URLSearchParams(window.location.search);
  const pageScopes = { home: "all", tv: "tv", movies: "movie", live: "live" };
  const requestedScope = initialParams.get("scope");
  state.typeScope = ["all", "tv", "movie"].includes(requestedScope)
    ? requestedScope
    : (pageScopes[APP_PAGE] || "all");
  typeNav.querySelectorAll("[data-type]").forEach(link => {
    link.classList.toggle("active", link.dataset.type === state.typeScope && APP_PAGE !== "profile" && APP_PAGE !== "discover");
  });
  discoverListsTopButton.classList.toggle("active", APP_PAGE === "discover");

  // Currently Watching is account-only. Old local history remains hidden
  // while signed out and is migrated into the account after sign-in.
  renderContinueWatching();
  catalogueActions.style.display = "none";

  await restoreAccountSession();

  if (APP_PAGE === "discover") {
    await openDiscoverPage();
    return;
  }

  if (APP_PAGE === "profile") {
    await openProfilePage();
    return;
  }

  if (APP_PAGE === "auth") {
    if (state.user) {
      navigateToPage(authReturnPath(), { replace: true });
      return;
    }
    openAuthModal(initialParams.get("mode") === "register" ? "register" : "signin");
    return;
  }

  if (state.typeScope === "live") {
    showLiveSportsView("");
    return;
  }

  if (APP_PAGE === "search") {
    const initialQuery = initialParams.get("q")?.trim() || "";
    searchInput.value = initialQuery;
    if (initialQuery) await searchCatalogue(initialQuery);
    return;
  }

  await loadInitialCatalogue();

  if (APP_PAGE === "collection") {
    const descriptor = {
      kind: initialParams.get("kind") || "popular",
      scope: state.typeScope,
      genre: initialParams.get("genre") || ""
    };
    const title = initialParams.get("title") || descriptor.genre || "Browse titles";
    openCollectionView(title, [], descriptor);
  }
}

// When a signed-in page returns from the back/forward cache, re-fetch the
// account history so progress made on another device can appear here.
window.addEventListener("pageshow", () => {
  if (state.user) syncWatchHistoryFromAccount({ migrateLocal: false });
  else renderContinueWatching();
});

initialiseTVArchive()
  .catch(error => console.error("TV Archive failed to initialise", error))
  .finally(() => {
    window.requestAnimationFrame(() => {
      document.body.classList.add("page-ready");
      document.body.setAttribute("aria-busy", "false");
    });
  });
