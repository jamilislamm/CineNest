(() => {
  "use strict";

  // ---------- Constants ----------
  const TMDB_KEY = "8b2ae18b23829873d101cd49a562152c";
  const API = "https://api.themoviedb.org/3";
  const IMG = "https://image.tmdb.org/t/p/w500";
  const STILL = "https://image.tmdb.org/t/p/w300";
  const FALLBACK = "https://placehold.co/500x750/202735/e5e7eb?text=No+Poster";
  const WATCHED_THRESHOLD = 0.6; // 60% of episode runtime → tick
  const $ = (id) => document.getElementById(id);

  // ---------- Servers ----------
  const servers = [
    {
      id: "nxsha",
      name: "Nxsha",
      movie: (id) => `https://nxsha.space/embed/movie/${id}`,
      tv: (id, s, e) => `https://nxsha.space/embed/tv/${id}/${s}/${e}`,
    },
    {
      id: "cineverse",
      name: "Cineverse",
      movie: (id) =>
        `https://rozgarlelo.modiplay.xyz/embed/tmdb/movie?id=${id}`,
      tv: (id, s, e) =>
        `https://rozgarlelo.modiplay.xyz/embed/tmdb/tv?id=${id}&s=${s}&e=${e}`,
    },
    {
      id: "vidrift",
      name: "VidRift",
      movie: (id) => `https://embed.vidrift.net/embed/movie/${id}`,
      tv: (id, s, e) => `https://embed.vidrift.net/embed/tv/${id}/${s}/${e}`,
    },
    {
      id: "screenscape",
      name: "Screenscape",
      movie: (id) => `https://nxsha.screenscape.me/embed?tmdb=${id}&type=movie`,
      tv: (id, s, e) =>
        `https://nxsha.screenscape.me/embed?tmdb=${id}&type=tv&s=${s}&e=${e}`,
    },
    {
      id: "vidbolt",
      name: "VidBolt",
      movie: (id) => `https://vidbolt.xyz/movie/${id}`,
      tv: (id, s, e) => `https://vidbolt.xyz/tv/${id}/${s}/${e}`,
    },
    {
      id: "vidly",
      name: "Vidly",
      movie: (id) => `https://vidly.pro/movie/${id}`,
      tv: (id, s, e) => `https://vidly.pro/tv/${id}/${s}/${e}`,
    },
    {
      id: "moviesnexus",
      name: "MoviesNexus",
      movie: (id) => `https://www.moviesnexus.fun/movie/${id}`,
      tv: (id, s, e) => `https://www.moviesnexus.fun/tv/${id}/${s}/${e}`,
    },
  ];
  let currentServerId = "nxsha"; // always the default

  // ---------- State ----------
  const read = (k, d) => {
    try {
      return JSON.parse(localStorage.getItem(k)) ?? d;
    } catch {
      return d;
    }
  };

  let movie = null;
  let currentImdbId = null;
  let currentMediaType = "movie";
  let currentSeason = 1;
  let currentEpisode = 1;
  let currentTotalEpisodes = 0;
  let seasons = [];
  let episodes = [];
  let results = [];
  let page = 1;
  let totalPages = 1;
  let mode = "popular";
  let query = "";
  let genres = [];
  let watchlist = read("cinenest_watchlist", []);
  let history = read("cinenest_history", []);
  let progress = read("cinenest_progress", {});
  let prefs = read("cinenest_prefs", { theme: "dark", audio: "" });
  let toastTimer;
  let suggestionTimer;
  let fetchToken = 0;
  let playingEpisodeKey = null;
  let episodeWatchTimer = null;
  let currentEpisodeRuntimeSec = 24 * 60;
  let currentShowRuntimeSec = 0;

  const imdbCache = new Map();

  // ---------- Filter metadata ----------
  const FILTER_META = {
    contentType: {
      label: "Content",
      values: { movie: "Movies", tv: "TV Series", anime: "Anime", all: "All" },
    },
    country: { label: "Country" },
    genre: { label: "Genre" },
    year: { label: "Year" },
    dateRange: {
      label: "Date",
      values: {
        7: "7 days",
        30: "30 days",
        90: "3 months",
        180: "6 months",
        365: "1 year",
        1825: "5 years",
        3650: "10 years",
        5475: "15 years",
        7300: "20 years",
        ty: "This year",
        ly: "Last year",
      },
    },
    sort: {
      label: "Sort",
      values: {
        "popularity.desc": "Popularity",
        "vote_average.desc": "TMDB rating",
        "vote_count.desc": "Most votes",
        "primary_release_date.desc": "Newest",
        "primary_release_date.asc": "Oldest",
        "revenue.desc": "Revenue",
        "imdb.desc": "IMDb rating",
      },
    },
    pageSize: { label: "Batch" },
  };

  const FILTER_DEFAULTS = {
    contentType: "movie",
    country: "",
    genre: "",
    year: "",
    dateRange: "",
    sort: "imdb.desc",
    pageSize: "20",
  };

  const COUNTRY_NAMES = {
    IN: "India",
    BD: "Bangladesh",
    US: "United States",
    GB: "United Kingdom",
    KR: "South Korea",
    JP: "Japan",
    CN: "China",
    PK: "Pakistan",
    FR: "France",
    DE: "Germany",
    ES: "Spain",
    IT: "Italy",
    RU: "Russia",
    TR: "Turkey",
    TH: "Thailand",
    ID: "Indonesia",
    PH: "Philippines",
    MY: "Malaysia",
    SG: "Singapore",
    NP: "Nepal",
    LK: "Sri Lanka",
    BR: "Brazil",
    MX: "Mexico",
    AR: "Argentina",
    CA: "Canada",
    AU: "Australia",
    NZ: "New Zealand",
    ZA: "South Africa",
    EG: "Egypt",
    NG: "Nigeria",
  };

  // ---------- Init ----------
  if (prefs.theme === "light") document.body.classList.add("light");
  $("audio").value = prefs.audio || "";

  // ---------- Persistence ----------
  function save() {
    localStorage.setItem("cinenest_watchlist", JSON.stringify(watchlist));
    localStorage.setItem("cinenest_history", JSON.stringify(history));
    localStorage.setItem("cinenest_prefs", JSON.stringify(prefs));
  }

  function saveProgressStore() {
    localStorage.setItem("cinenest_progress", JSON.stringify(progress));
  }

  function getProgress(id) {
    return progress[id] || null;
  }

  function markProgress(id, season, episode, meta) {
    if (!progress[id]) progress[id] = { watched: [] };
    const p = progress[id];
    if (!Array.isArray(p.watched)) p.watched = [];
    const key = `${season}x${episode}`;
    if (!p.watched.includes(key)) p.watched.push(key);
    p.season = season;
    p.episode = episode;
    p.lastWatched = Date.now();
    if (meta) {
      if (meta.title) p.title = meta.title;
      if (meta.poster_path) p.poster_path = meta.poster_path;
      if (meta.totalEpisodes) p.totalEpisodes = meta.totalEpisodes;
    }
    saveProgressStore();
  }

  function isEpisodeWatched(id, season, episode) {
    const p = progress[id];
    if (!p || !Array.isArray(p.watched)) return false;
    return p.watched.includes(`${season}x${episode}`);
  }

  // Update position without marking as watched
  function updateWatchPosition(id, season, episode, meta) {
    if (!progress[id]) progress[id] = { watched: [], episodeProgress: {} };
    const p = progress[id];
    if (!Array.isArray(p.watched)) p.watched = [];
    if (!p.episodeProgress) p.episodeProgress = {};
    p.season = season;
    p.episode = episode;
    p.lastWatched = Date.now();
    if (meta) {
      if (meta.title) p.title = meta.title;
      if (meta.poster_path) p.poster_path = meta.poster_path;
      if (meta.totalEpisodes) p.totalEpisodes = meta.totalEpisodes;
    }
    saveProgressStore();
  }

  function getEpisodeRuntimeSec(ep) {
    if (ep && ep.runtime && ep.runtime > 0) return ep.runtime * 60;
    if (currentShowRuntimeSec > 0) return currentShowRuntimeSec;
    return 24 * 60;
  }

  function startEpisodeTracking() {
    if (currentMediaType !== "tv" || !movie) {
      stopEpisodeTracking();
      return;
    }
    const key = `${movie.id}-${currentSeason}x${currentEpisode}`;
    if (playingEpisodeKey === key && episodeWatchTimer) return;

    stopEpisodeTracking();
    playingEpisodeKey = key;

    if (isEpisodeWatched(movie.id, currentSeason, currentEpisode)) return;

    const ep = episodes.find((e) => e.episode_number === currentEpisode);
    currentEpisodeRuntimeSec = getEpisodeRuntimeSec(ep);

    episodeWatchTimer = setInterval(() => {
      if (!movie) return;
      if (playingEpisodeKey !== key) return;
      if (document.visibilityState !== "visible") return;
      if ($("detailPage").classList.contains("hidden")) return;

      const id = movie.id;
      if (!progress[id]) progress[id] = { watched: [], episodeProgress: {} };
      const p = progress[id];
      if (!p.episodeProgress) p.episodeProgress = {};

      const epKey = `${currentSeason}x${currentEpisode}`;
      const prev = p.episodeProgress[epKey] || 0;
      const next = prev + 5;
      p.episodeProgress[epKey] = next;

      const threshold = currentEpisodeRuntimeSec * WATCHED_THRESHOLD;

      if (
        next >= threshold &&
        !isEpisodeWatched(id, currentSeason, currentEpisode)
      ) {
        markProgress(id, currentSeason, currentEpisode, {
          title: movie.title || movie.name,
          poster_path: movie.poster_path,
          totalEpisodes: currentTotalEpisodes,
        });
        renderEpisodes();
        updateResumeBanner();
        toast(
          `S${String(currentSeason).padStart(2, "0")}E${String(
            currentEpisode,
          ).padStart(2, "0")} marked as watched`,
        );
        stopEpisodeTracking();
      } else if (next % 30 === 0) {
        saveProgressStore();
      }
    }, 5000);
  }

  function stopEpisodeTracking() {
    if (episodeWatchTimer) {
      clearInterval(episodeWatchTimer);
      episodeWatchTimer = null;
    }
    if (progress[movie?.id]?.episodeProgress) saveProgressStore();
    playingEpisodeKey = null;
  }

  function timeAgo(ts) {
    if (!ts) return "";
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    return `${Math.floor(d / 7)}w ago`;
  }

  // ---------- Helpers ----------
  function toast(s) {
    const el = $("toast");
    el.textContent = s;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), 2800);
  }

  function status(s) {
    $("status").textContent = s;
  }

  function pageView(id, push = true) {
    ["home", "detailPage", "settingsPage", "listPage"].forEach((x) =>
      $(x).classList.add("hidden"),
    );
    $(id).classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
    hideSuggestions();
    if (id !== "detailPage") {
      $("player").innerHTML = "";
      stopEpisodeTracking();
    } else if (!push && movie) {
      loadPlayer();
    }
    if (push && window.history.state?.view !== id) {
      window.history.pushState({ view: id }, "");
    }
  }

  // ---------- TMDB API ----------
  async function tmdb(path, params = {}) {
    const u = new URL(API + path);
    u.searchParams.set("api_key", TMDB_KEY);
    u.searchParams.set("language", "en-US");
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    const r = await fetch(u);
    if (!r.ok) throw Error("TMDB request failed (" + r.status + ").");
    return r.json();
  }

  function poster(p) {
    return p ? IMG + p : FALLBACK;
  }
  function still(p) {
    return p ? STILL + p : FALLBACK;
  }

  function formatDate(d) {
    if (!d) return "";
    try {
      return new Date(d + "T00:00:00").toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return d;
    }
  }

  function guessType(m) {
    if (m.media_type === "tv" || m.media_type === "movie") return m.media_type;
    if (m.first_air_date || m.name) return "tv";
    return "movie";
  }

  // ---------- IMDb ratings ----------
  async function fetchImdbRatings(imdbIds) {
    if (!imdbIds.length) return {};
    const missing = imdbIds.filter((id) => !imdbCache.has(id));
    if (missing.length === 0) {
      const out = {};
      imdbIds.forEach((id) => (out[id] = imdbCache.get(id)));
      return out;
    }

    // Chunk into batches of 100 (Agregarr per-call limit)
    const chunks = [];
    for (let i = 0; i < missing.length; i += 100) {
      chunks.push(missing.slice(i, i + 100));
    }

    for (let c = 0; c < chunks.length; c++) {
      const chunk = chunks[c];
      try {
        const params = new URLSearchParams();
        chunk.forEach((id) => params.append("id", id));
        const r = await fetch(`https://api.agregarr.org/api/ratings?${params}`);
        if (!r.ok) throw Error("IMDb API failed");
        const data = await r.json();
        data.forEach((item) => {
          imdbCache.set(item.imdbId, {
            rating: item.rating ?? null,
            votes: item.votes ?? null,
          });
        });
        // Mark any IDs not returned as null so they don't get retried
        chunk.forEach((id) => {
          if (!imdbCache.has(id))
            imdbCache.set(id, { rating: null, votes: null });
        });
      } catch {
        chunk.forEach((id) => imdbCache.set(id, { rating: null, votes: null }));
      }
      if (chunks.length > 1) {
        status(
          `Fetching IMDb ratings… ${Math.round(
            ((c + 1) / chunks.length) * 100,
          )}%`,
        );
      }
    }

    const out = {};
    imdbIds.forEach((id) => {
      out[id] = imdbCache.get(id) || { rating: null, votes: null };
    });
    return out;
  }

  // ---------- IMDb ID resolver — uses external_ids for TV ----------
  async function resolveImdbIds(tmdbItems) {
    const map = {};
    const CHUNK = 20;
    const DELAY_MS = 400;

    for (let i = 0; i < tmdbItems.length; i += CHUNK) {
      const chunk = tmdbItems.slice(i, i + CHUNK);
      const promises = chunk.map(async (m) => {
        const type = guessType(m);
        try {
          let imdbId = null;
          if (type === "tv") {
            const ext = await tmdb(`/tv/${m.id}/external_ids`);
            imdbId = ext.imdb_id || null;
          } else {
            const d = await tmdb(`/movie/${m.id}`);
            imdbId = d.imdb_id || null;
          }
          return { tmdbId: m.id, imdbId };
        } catch {
          return { tmdbId: m.id, imdbId: null };
        }
      });
      const resolved = await Promise.all(promises);
      resolved.forEach((r) => {
        if (r.imdbId) map[r.tmdbId] = r.imdbId;
      });

      if (i + CHUNK < tmdbItems.length) {
        const progress = Math.round(((i + CHUNK) / tmdbItems.length) * 100);
        status(`Resolving IMDb IDs… ${Math.min(progress, 100)}%`);
        await new Promise((res) => setTimeout(res, DELAY_MS));
      }
    }

    return map;
  }

  async function enrichWithImdb(items) {
    const idMap = await resolveImdbIds(items);
    const imdbIds = Object.values(idMap);
    const ratings = await fetchImdbRatings(imdbIds);
    items.forEach((m) => {
      const imdbId = idMap[m.id];
      if (imdbId && ratings[imdbId]) {
        m.imdb_rating = ratings[imdbId].rating;
        m.imdb_votes = ratings[imdbId].votes;
      } else {
        m.imdb_rating = null;
        m.imdb_votes = null;
      }
    });
  }

  // ---------- Movie card ----------
  function card(m) {
    const el = document.createElement("article");
    el.className = "movie";
    el.tabIndex = 0;
    el.setAttribute("role", "button");

    const wrap = document.createElement("div");
    wrap.className = "poster-wrap";

    const im = document.createElement("img");
    im.className = "poster";
    im.loading = "lazy";
    im.alt = (m.title || m.name || "Movie") + " poster";
    im.src = poster(m.poster_path);
    im.onerror = () => (im.src = FALLBACK);
    wrap.append(im);

    const ratingValue = m.imdb_rating ?? m.vote_average;
    if (ratingValue) {
      const r = document.createElement("span");
      r.className = "rating";
      const src = m.imdb_rating ? "IMDb" : "TMDB";
      r.textContent = `★ ${Number(ratingValue).toFixed(1)} (${src})`;
      wrap.append(r);
    }

    const f = document.createElement("button");
    f.className = "fav";
    f.textContent = watchlist.some((x) => x.id === m.id) ? "♥" : "♡";
    f.title = "Toggle watchlist";
    f.onclick = (e) => {
      e.stopPropagation();
      toggleFav(m);
      f.textContent = watchlist.some((x) => x.id === m.id) ? "♥" : "♡";
    };

    const info = document.createElement("div");
    info.className = "movie-info";

    const t = document.createElement("div");
    t.className = "movie-title";
    t.textContent = m.title || m.name || "Untitled";

    const meta = document.createElement("div");
    meta.className = "meta";
    const type = guessType(m);
    const year = (m.release_date || m.first_air_date || "").slice(0, 4);
    if (type === "tv") {
      const p = getProgress(m.id);
      if (p && p.season && p.episode) {
        meta.textContent = `S${String(p.season).padStart(2, "0")}E${String(
          p.episode,
        ).padStart(2, "0")} · ${year}`;
      } else {
        meta.textContent = year || "Year unknown";
      }
    } else {
      meta.textContent = year || "Year unknown";
    }

    info.append(t, meta);
    el.append(wrap, f, info);

    el.onclick = () => openMovie(m);
    el.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openMovie(m);
      }
    };
    return el;
  }

  function render(arr, target = $("grid")) {
    target.innerHTML = "";
    arr.forEach((m) => target.append(card(m)));
  }

  function empty(msg, target = $("empty")) {
    target.textContent = msg;
    target.classList.remove("hidden");
  }

  function hideEmpty(target = $("empty")) {
    target.classList.add("hidden");
  }

  // ---------- Filters ----------
  function populateYears() {
    const sel = $("year");
    sel.innerHTML = '<option value="">Any year</option>';
    const now = new Date().getFullYear();
    for (let y = now + 1; y >= 1950; y--) {
      const o = document.createElement("option");
      o.value = String(y);
      o.textContent = String(y);
      sel.append(o);
    }
  }
  populateYears();

  async function loadGenres() {
    if (genres.length) return;
    try {
      const d = await tmdb("/genre/movie/list");
      genres = d.genres || [];
      const sel = $("genre");
      sel.innerHTML = '<option value="">All genres</option>';
      genres.forEach((g) => {
        const o = document.createElement("option");
        o.value = g.id;
        o.textContent = g.name;
        sel.append(o);
      });
    } catch {
      /* ignore */
    }
  }

  function buildDiscoverParams(type) {
    const country = $("country").value;
    const genre = $("genre").value;
    const year = $("year").value;
    const dateRange = $("dateRange").value;
    const sortBy = $("sort").value;

    const params = {
      page: String(page),
      include_adult: "false",
      sort_by: sortBy === "imdb.desc" ? "popularity.desc" : sortBy,
    };

    let endpoint = "/discover/movie";
    if (type === "tv" || type === "anime") endpoint = "/discover/tv";

    if (type === "anime") {
      params.with_genres = "16";
      params.with_original_language = "ja";
    } else if (genre) {
      params.with_genres = genre;
    }

    if (country) params.with_origin_country = country;

    if (year) {
      if (endpoint === "/discover/movie") params.primary_release_year = year;
      else params.first_air_date_year = year;
    }

    if (dateRange) {
      const dateField =
        endpoint === "/discover/movie"
          ? "primary_release_date"
          : "first_air_date";
      const today = new Date();
      let fromDate = null,
        toDate = null;
      if (dateRange === "ty") {
        fromDate = new Date(today.getFullYear(), 0, 1);
        toDate = new Date(today.getFullYear(), 11, 31);
      } else if (dateRange === "ly") {
        fromDate = new Date(today.getFullYear() - 1, 0, 1);
        toDate = new Date(today.getFullYear() - 1, 11, 31);
      } else {
        const days = parseInt(dateRange, 10);
        if (!isNaN(days)) {
          fromDate = new Date(today.getTime() - days * 86400000);
          toDate = today;
        }
      }
      if (fromDate)
        params[dateField + ".gte"] = fromDate.toISOString().slice(0, 10);
      if (toDate)
        params[dateField + ".lte"] = toDate.toISOString().slice(0, 10);
    }

    return { endpoint, params };
  }

  // ---------- Discover ----------
  async function discover(append = false) {
    const myToken = ++fetchToken;
    mode = "discover";
    const pageSize = parseInt($("pageSize").value, 10) || 20;
    const pagesPerBatch = Math.max(1, Math.ceil(pageSize / 20));
    const contentType = $("contentType").value;
    const sortBy = $("sort").value;

    if (!append) {
      page = 1;
      $("grid").innerHTML = "";
      results = [];
    }

    const startPage = page;

    try {
      status("Loading…");
      let items = [];
      let lastTotalPages = 1;

      if (contentType === "all") {
        // Fetch movie + TV in parallel
        const mp = buildDiscoverParams("movie");
        const tp = buildDiscoverParams("tv");
        for (let i = 0; i < pagesPerBatch; i++) {
          const p = startPage + i;
          if (p > 500) break;
          mp.params.page = String(p);
          tp.params.page = String(p);
          const [dM, dT] = await Promise.all([
            tmdb(mp.endpoint, mp.params).catch(() => ({
              results: [],
              total_pages: 1,
            })),
            tmdb(tp.endpoint, tp.params).catch(() => ({
              results: [],
              total_pages: 1,
            })),
          ]);
          items.push(
            ...(dM.results || []).map((x) => ({ ...x, media_type: "movie" })),
          );
          items.push(
            ...(dT.results || []).map((x) => ({ ...x, media_type: "tv" })),
          );
          lastTotalPages = Math.min(dM.total_pages || 1, dT.total_pages || 1);
          if (p >= lastTotalPages) break;
        }
        // Sort combined results
        if (sortBy === "popularity.desc")
          items.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
        else if (sortBy === "vote_average.desc")
          items.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
        else if (sortBy === "vote_count.desc")
          items.sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0));
      } else {
        const { endpoint, params } = buildDiscoverParams(contentType);
        for (let i = 0; i < pagesPerBatch; i++) {
          const p = startPage + i;
          if (p > 500) break;
          params.page = String(p);
          const d = await tmdb(endpoint, params);
          items.push(...(d.results || []));
          lastTotalPages = d.total_pages || 1;
          if (p >= lastTotalPages) break;
        }
      }

      if (myToken !== fetchToken) return;

      totalPages = lastTotalPages;
      page = startPage + pagesPerBatch;

      if (items.length) await enrichWithImdb(items);

      if (myToken !== fetchToken) return;

      if (sortBy === "imdb.desc") {
        items.sort((a, b) => (b.imdb_rating ?? 0) - (a.imdb_rating ?? 0));
      }

      results = append ? results.concat(items) : items;

      // Dedupe by composite key (media_type + id)
      const seen = new Set();
      results = results.filter((item) => {
        const key = `${guessType(item)}-${item.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      $("heading").textContent = "Discover";
      $("sub").textContent = `${results.length} results loaded`;
      render(results);
      if (results.length) hideEmpty();
      else empty("No results match these filters.");
      $("more").classList.toggle("hidden", page > totalPages);
      status("");
      renderFilterBadges();
    } catch (e) {
      status(e.message);
      empty(e.message);
    }
  }

  // ---------- Popular ----------
  async function loadPopular(append = false) {
    const myToken = ++fetchToken;
    mode = "popular";
    const pageSize = parseInt($("pageSize").value, 10) || 20;
    const pagesPerBatch = Math.max(1, Math.ceil(pageSize / 20));

    if (!append) {
      page = 1;
      $("grid").innerHTML = "";
      query = "";
      results = [];
    }
    const startPage = page;

    try {
      status("Loading popular movies…");
      const batches = [];
      let lastTotalPages = 1;
      for (let i = 0; i < pagesPerBatch; i++) {
        const p = startPage + i;
        if (p > 500) break;
        const d = await tmdb("/movie/popular", { page: String(p) });
        batches.push(d.results || []);
        lastTotalPages = d.total_pages || 1;
        if (p >= lastTotalPages) break;
      }
      if (myToken !== fetchToken) return;

      const items = [].concat(...batches);
      totalPages = lastTotalPages;
      page = startPage + pagesPerBatch;

      await enrichWithImdb(items);
      if (myToken !== fetchToken) return;
      results = append ? results.concat(items) : items;

      const seen = new Set();
      results = results.filter((item) => {
        const key = `${guessType(item)}-${item.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      $("heading").textContent = "Popular movies";
      $("sub").textContent = "Discover something new";
      render(results);
      hideEmpty();
      status("");
      $("more").classList.toggle("hidden", page > totalPages);
      if (!append) renderHistory();
    } catch (e) {
      status(e.message);
      empty(e.message);
    }
  }

  // ---------- Search ----------
  async function search(q, append = false) {
    const myToken = ++fetchToken;
    if ($("home").classList.contains("hidden")) {
      pageView("home");
      if (!append) $("grid").innerHTML = "";
    }
    mode = "search";
    query = q;
    page = append ? page + 1 : 1;
    if (!append) {
      $("grid").innerHTML = "";
      results = [];
    }

    try {
      status("Searching…");
      const d = await tmdb("/search/multi", {
        query: q,
        include_adult: "false",
        page: String(page),
      });
      if (myToken !== fetchToken) return;
      const items = (d.results || []).filter((x) => x.media_type !== "person");
      await enrichWithImdb(items);
      if (myToken !== fetchToken) return;
      results = append ? results.concat(items) : items;
      totalPages = d.total_pages || 1;

      const seen = new Set();
      results = results.filter((item) => {
        const key = `${guessType(item)}-${item.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      $("heading").textContent = `Results for "${q}"`;
      $("sub").textContent = `${d.total_results || 0} matches`;
      render(results);

      if (results.length) hideEmpty();
      else empty("No matches. Try another title.");

      $("more").classList.toggle("hidden", page >= totalPages);
      status("");
    } catch (e) {
      status(e.message);
    }
  }

  // ---------- Watchlist ----------
  function isFav(id) {
    return watchlist.some((x) => x.id === id);
  }

  function toggleFav(m) {
    if (isFav(m.id)) watchlist = watchlist.filter((x) => x.id !== m.id);
    else watchlist.unshift(m);
    save();
    $("fav").textContent = isFav(m.id)
      ? "♥ In watchlist"
      : "♡ Add to watchlist";
    render(results);
    toast(isFav(m.id) ? "Added to watchlist" : "Removed from watchlist");
  }

  // ---------- Open detail ----------
  async function openMovie(m) {
    movie = m;
    currentImdbId = null;
    currentSeason = 1;
    currentEpisode = 1;
    currentTotalEpisodes = 0;
    seasons = [];
    episodes = [];

    let type = guessType(m);
    currentMediaType = type;

    pageView("detailPage");

    $("poster").src = poster(m.poster_path);
    $("poster").onerror = () => ($("poster").src = FALLBACK);
    $("title").textContent = m.title || m.name || "Untitled";
    $("overview").textContent = m.overview || "No description available.";
    $("pills").innerHTML = "";
    $("fav").textContent = isFav(m.id)
      ? "♥ In watchlist"
      : "♡ Add to watchlist";
    $("extra").textContent = "";
    $("imdbLink").classList.add("hidden");
    $("episodeSection").classList.add("hidden");
    $("resumeBanner").classList.add("hidden");

    // Default server always
    currentServerId = servers[0].id;

    // Fetch details (with type-mismatch fallback + title verification)
    let d = null;
    try {
      try {
        d = await tmdb(`/${type}/${m.id}`);
      } catch {
        type = type === "movie" ? "tv" : "movie";
        currentMediaType = type;
        d = await tmdb(`/${type}/${m.id}`);
      }
      const expectedTitle = (m.title || m.name || "").toLowerCase().trim();
      const returnedTitle = (d.title || d.name || "").toLowerCase().trim();
      if (expectedTitle && returnedTitle && returnedTitle !== expectedTitle) {
        const altType = type === "movie" ? "tv" : "movie";
        try {
          const altD = await tmdb(`/${altType}/${m.id}`);
          const altTitle = (altD.title || altD.name || "").toLowerCase().trim();
          if (altTitle === expectedTitle) {
            d = altD;
            type = altType;
            currentMediaType = altType;
          }
        } catch {
          /* keep d */
        }
      }
    } catch {
      $("extra").textContent = "Could not load details.";
    }

    // Render pills
    const releaseDate =
      (d && (d.release_date || d.first_air_date)) ||
      m.release_date ||
      m.first_air_date ||
      "";
    const dateDisplay = releaseDate ? formatDate(releaseDate) : "Unknown date";
    const dateLabel = type === "tv" ? "First aired" : "Released";
    const tmdbRating = (d && d.vote_average) || m.vote_average;
    [
      `${dateLabel}: ${dateDisplay}`,
      tmdbRating ? `TMDB ★ ${Number(tmdbRating).toFixed(1)}` : "",
      `TMDB ID ${m.id}`,
    ]
      .filter(Boolean)
      .forEach((s) => {
        const p = document.createElement("span");
        p.className = "pill";
        p.textContent = s;
        $("pills").append(p);
      });

    if (d) {
      const extraParts = [
        d.runtime ? `${d.runtime} min` : "",
        d.episode_run_time?.[0] ? `${d.episode_run_time[0]} min/ep` : "",
        d.genres?.map((g) => g.name).join(" · ") || "",
        d.number_of_seasons
          ? `${d.number_of_seasons} season${d.number_of_seasons > 1 ? "s" : ""}`
          : "",
      ].filter(Boolean);
      $("extra").textContent = extraParts.join(" • ");

      // IMDb — for TV use external_ids
      let imdbId = null;
      if (type === "tv") {
        try {
          const ext = await tmdb(`/tv/${m.id}/external_ids`);
          imdbId = ext.imdb_id || null;
        } catch {
          /* ignore */
        }
      } else {
        imdbId = d.imdb_id || null;
      }
      currentImdbId = imdbId;
      $("imdbLink").classList.toggle("hidden", !currentImdbId);
      if (imdbId) {
        const ratings = await fetchImdbRatings([imdbId]);
        const imdb = ratings[imdbId];
        if (imdb && imdb.rating) {
          const votesText = imdb.votes
            ? ` (${imdb.votes.toLocaleString()} votes)`
            : "";
          const p = document.createElement("span");
          p.className = "pill";
          p.textContent = `IMDb ★ ${Number(imdb.rating).toFixed(1)}${votesText}`;
          $("pills").append(p);
        }
      }

      // TV seasons & episodes
      if (type === "tv") {
        currentShowRuntimeSec =
          d.episode_run_time && d.episode_run_time[0] > 0
            ? d.episode_run_time[0] * 60
            : 0;
        seasons = (d.seasons || []).filter((s) => s.season_number > 0);
        currentTotalEpisodes = seasons.reduce(
          (sum, s) => sum + (s.episode_count || 0),
          0,
        );

        // Resume from last watched if exists
        const p = getProgress(m.id);
        if (p && p.season && p.episode) {
          currentSeason = p.season;
          currentEpisode = p.episode;
        } else {
          currentSeason = 1;
          currentEpisode = 1;
        }

        if (seasons.length) {
          $("episodeSection").classList.remove("hidden");
          populateSeasonSelect();
          await loadSeasonEpisodes(currentSeason);
        }
      }
    }

    renderServerTabs();
    loadPlayer();
    updateResumeBanner();

    // History
    history = history.filter((x) => x.id !== m.id);
    history.unshift({ ...m, openedAt: Date.now() });
    history = history.slice(0, 30);
    save();
    renderHistory();
  }

  // ---------- Resume banner ----------
  function updateResumeBanner() {
    const banner = $("resumeBanner");
    if (!banner) return;
    if (!movie || currentMediaType !== "tv") {
      banner.classList.add("hidden");
      return;
    }
    const p = getProgress(movie.id);
    if (p && p.season && p.episode) {
      const watched = Array.isArray(p.watched) ? p.watched.length : 0;
      const total = p.totalEpisodes || currentTotalEpisodes || "?";
      $("resumeText").textContent = `Continue from S${String(p.season).padStart(
        2,
        "0",
      )}E${String(p.episode).padStart(2, "0")}`;
      $("resumeSub").textContent =
        `${watched} of ${total} episodes watched · ${timeAgo(p.lastWatched)}`;
      banner.classList.remove("hidden");
    } else {
      banner.classList.add("hidden");
    }
  }

  // ---------- Seasons & Episodes ----------
  function populateSeasonSelect() {
    const sel = $("seasonSelect");
    if (!sel) return;
    sel.innerHTML = "";
    seasons.forEach((s) => {
      const o = document.createElement("option");
      o.value = String(s.season_number);
      o.textContent = `Season ${s.season_number}`;
      sel.append(o);
    });
    sel.value = String(currentSeason);
    sel.onchange = async () => {
      currentSeason = parseInt(sel.value, 10) || 1;
      currentEpisode = 1;
      await loadSeasonEpisodes(currentSeason);
      loadPlayer();
      updateResumeBanner();
    };
  }

  async function loadSeasonEpisodes(seasonNum) {
    if (!movie) return;
    try {
      const d = await tmdb(`/tv/${movie.id}/season/${seasonNum}`);
      episodes = d.episodes || [];
    } catch {
      episodes = [];
    }
    renderEpisodes();
  }

  function renderEpisodes() {
    const grid = $("episodeGrid");
    if (!grid) return;
    grid.innerHTML = "";
    episodes.forEach((ep) => {
      const el = document.createElement("div");
      el.className = "episode-card";
      if (ep.episode_number === currentEpisode) el.classList.add("active");
      if (isEpisodeWatched(movie.id, currentSeason, ep.episode_number))
        el.classList.add("watched");
      el.onclick = () => {
        currentEpisode = ep.episode_number;
        updateWatchPosition(movie.id, currentSeason, currentEpisode, {
          title: movie.title || movie.name,
          poster_path: movie.poster_path,
          totalEpisodes: currentTotalEpisodes,
        });
        renderEpisodes();
        loadPlayer();
        updateResumeBanner();
      };

      const img = document.createElement("img");
      img.src = still(ep.still_path);
      img.alt = "";
      img.onerror = () => (img.src = FALLBACK);

      const info = document.createElement("div");
      info.className = "episode-info";

      const num = document.createElement("div");
      num.className = "episode-num";
      num.textContent = `S${String(currentSeason).padStart(2, "0")}E${String(
        ep.episode_number,
      ).padStart(2, "0")}`;

      const name = document.createElement("div");
      name.className = "episode-name";
      name.textContent = ep.name || "Untitled";

      const date = document.createElement("div");
      date.className = "episode-date";
      date.textContent = ep.air_date ? formatDate(ep.air_date) : "";

      info.append(num, name, date);
      el.append(img, info);
      grid.append(el);
    });
  }

  // ---------- Player ----------
  function loadPlayer() {
    if (!movie) return;
    const server = servers.find((s) => s.id === currentServerId) || servers[0];
    let url =
      currentMediaType === "tv"
        ? server.tv(movie.id, currentSeason, currentEpisode)
        : server.movie(movie.id);

    if (prefs.audio && currentMediaType === "movie") {
      try {
        const u = new URL(url);
        u.searchParams.set("audio", prefs.audio);
        url = u.toString();
      } catch {
        /* ignore */
      }
    }

    const iframe = document.createElement("iframe");
    iframe.src = url;
    iframe.title = "Player for " + (movie.title || movie.name);
    iframe.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    $("player").replaceChildren(iframe);

    if (currentMediaType === "tv") {
      $("playerMeta").textContent = `S${String(currentSeason).padStart(
        2,
        "0",
      )}E${String(currentEpisode).padStart(2, "0")} · ${server.name}`;
      updateWatchPosition(movie.id, currentSeason, currentEpisode, {
        title: movie.title || movie.name,
        poster_path: movie.poster_path,
        totalEpisodes: currentTotalEpisodes,
      });
      startEpisodeTracking();
    } else {
      $("playerMeta").textContent = server.name;
    }
    toast(`Player: ${server.name}`);
  }

  function renderServerTabs() {
    const container = $("serverTabs");
    container.innerHTML = "";
    servers.forEach((srv) => {
      const btn = document.createElement("button");
      btn.className =
        "server-tab" + (srv.id === currentServerId ? " active" : "");
      btn.textContent = srv.name;
      btn.onclick = () => {
        currentServerId = srv.id;
        renderServerTabs();
        loadPlayer();
      };
      container.append(btn);
    });
  }

  // ---------- Filter badges ----------
  function renderFilterBadges() {
    const container = $("filterBadges");
    if (!container) return;
    container.innerHTML = "";

    let activeCount = 0;
    const makeBadge = (key, displayText) => {
      activeCount++;
      const badge = document.createElement("span");
      badge.className = "filter-badge active";
      badge.textContent = `${FILTER_META[key]?.label || key}: ${displayText}`;
      const x = document.createElement("button");
      x.textContent = "✕";
      x.title = "Remove this filter";
      x.onclick = () => {
        $(key).value = FILTER_DEFAULTS[key];
        discover(false);
      };
      badge.append(x);
      container.append(badge);
    };

    Object.keys(FILTER_DEFAULTS).forEach((key) => {
      const el = $(key);
      if (!el) return;
      const current = el.value;
      const def = FILTER_DEFAULTS[key];
      if (current === def) return;
      let display = current;
      const meta = FILTER_META[key];
      if (meta?.values && meta.values[current]) display = meta.values[current];
      else if (key === "genre") {
        const g = genres.find((x) => String(x.id) === String(current));
        if (g) display = g.name;
      } else if (key === "country" && COUNTRY_NAMES[current]) {
        display = COUNTRY_NAMES[current];
      } else if (key === "pageSize") {
        display = current + " / page";
      }
      makeBadge(key, display);
    });

    if (activeCount === 0) {
      const badge = document.createElement("span");
      badge.className = "filter-badge";
      badge.textContent = "No filters applied — showing defaults";
      container.append(badge);
    } else {
      const reset = document.createElement("button");
      reset.textContent = "Reset all";
      reset.className = "filter-badge reset-all";
      reset.onclick = () => {
        Object.keys(FILTER_DEFAULTS).forEach((k) => {
          const el = $(k);
          if (el) el.value = FILTER_DEFAULTS[k];
        });
        discover(false);
      };
      container.append(reset);
    }
  }

  // ---------- History ----------
  function renderHistory() {
    const h = history.slice(0, 6);
    $("continue").classList.toggle("hidden", !h.length);
    render(h, $("historyGrid"));
  }

  // ---------- List view ----------
  function list(kind) {
    pageView("listPage");
    const arr = kind === "watchlist" ? watchlist : history;
    $("listTitle").textContent =
      kind === "watchlist" ? "My watchlist" : "Recently opened";
    $("listSub").textContent = `${arr.length} titles saved in this browser`;
    render(arr, $("listGrid"));
    if (arr.length) hideEmpty($("listEmpty"));
    else
      empty(
        kind === "watchlist"
          ? "No saved movies yet. Tap the heart on a movie."
          : "No history yet. Open a movie to start.",
        $("listEmpty"),
      );
  }

  // ---------- Theme ----------
  function theme() {
    prefs.theme = prefs.theme === "light" ? "dark" : "light";
    document.body.classList.toggle("light", prefs.theme === "light");
    save();
  }

  // ---------- Suggestions ----------
  function hideSuggestions() {
    $("suggestions").classList.add("hidden");
  }

  function showSuggestions(items) {
    const box = $("suggestions");
    if (!items.length) {
      hideSuggestions();
      return;
    }
    box.innerHTML = "";
    items.forEach((m) => {
      const div = document.createElement("div");
      div.className = "suggestion-item";
      const img = document.createElement("img");
      img.src = poster(m.poster_path);
      img.alt = "";
      img.onerror = () => (img.src = FALLBACK);
      const info = document.createElement("div");
      info.className = "suggestion-info";
      const title = document.createElement("div");
      title.className = "suggestion-title";
      title.textContent = m.title || m.name || "Untitled";
      const year = document.createElement("div");
      year.className = "suggestion-year";
      year.textContent =
        (m.release_date || m.first_air_date || "").slice(0, 4) || "";
      info.append(title, year);
      div.append(img, info);
      div.onclick = () => {
        hideSuggestions();
        openMovie(m);
      };
      box.append(div);
    });
    box.classList.remove("hidden");
  }

  $("search").addEventListener("input", () => {
    clearTimeout(suggestionTimer);
    const q = $("search").value.trim();
    if (q.length < 2) {
      hideSuggestions();
      return;
    }
    suggestionTimer = setTimeout(async () => {
      try {
        const d = await tmdb("/search/multi", {
          query: q,
          page: "1",
          include_adult: "false",
        });
        const items = (d.results || [])
          .filter((x) => x.media_type !== "person")
          .slice(0, 6);
        showSuggestions(items);
      } catch {
        /* ignore */
      }
    }, 300);
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest("#searchForm")) hideSuggestions();
  });

  // ---------- Bindings ----------
  $("brand").onclick = () => {
    pageView("home");
    loadPopular();
  };

  $("searchForm").onsubmit = (e) => {
    e.preventDefault();
    const q = $("search").value.trim();
    hideSuggestions();
    if (q) search(q);
    else loadPopular();
  };

  $("search").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const q = $("search").value.trim();
      hideSuggestions();
      if (q) search(q);
      else loadPopular();
    }
  });

  $("settingsBtn").onclick = () => pageView("settingsPage");
  $("settingsBack").onclick = () => {
    if (window.history.state?.view !== "home") window.history.back();
    else pageView("home");
  };
  $("back").onclick = () => {
    if (window.history.state?.view !== "home") window.history.back();
    else pageView("home");
  };
  $("listBack").onclick = () => {
    if (window.history.state?.view !== "home") window.history.back();
    else pageView("home");
  };

  $("popularBtn").onclick = () => loadPopular(false);
  $("watchlistBtn").onclick = () => list("watchlist");
  $("historyBtn").onclick = () => list("history");

  // Filters — no persistence
  $("applyFilters").onclick = () => discover(false);
  $("resetFilters").onclick = () => {
    Object.keys(FILTER_DEFAULTS).forEach((k) => {
      const el = $(k);
      if (el) el.value = FILTER_DEFAULTS[k];
    });
    discover(false);
  };

  $("more").onclick = () => {
    if (mode === "search") search(query, true);
    else if (mode === "discover") discover(true);
    else loadPopular(true);
  };

  $("audio").onchange = () => {
    prefs.audio = $("audio").value;
    save();
    toast("Audio preference saved. Reloading player…");
    if (movie) loadPlayer();
  };

  $("imdbLink").onclick = () => {
    if (currentImdbId) {
      window.open(
        `https://www.imdb.com/title/${currentImdbId}/`,
        "_blank",
        "noopener,noreferrer",
      );
    }
  };

  $("share").onclick = async () => {
    if (!movie) return;
    const t = currentMediaType === "tv" ? "tv" : "movie";
    const u = `https://www.themoviedb.org/${t}/${movie.id}`;
    try {
      await navigator.clipboard.writeText(u);
      toast("TMDB link copied");
    } catch {
      toast(u);
    }
  };

  $("startOverBtn").onclick = () => {
    if (!movie) return;
    currentSeason = 1;
    currentEpisode = 1;
    if (progress[movie.id]) {
      progress[movie.id].season = 1;
      progress[movie.id].episode = 1;
      saveProgressStore();
    }
    const sel = $("seasonSelect");
    if (sel) sel.value = "1";
    loadSeasonEpisodes(1).then(() => {
      loadPlayer();
      updateResumeBanner();
    });
  };

  $("theme").onclick = theme;
  $("theme2").onclick = theme;

  $("clearHistory").onclick = () => {
    history = [];
    save();
    renderHistory();
  };

  $("export").onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob(
        [JSON.stringify({ watchlist, history, prefs, progress }, null, 2)],
        {
          type: "application/json",
        },
      ),
    );
    a.download = "cinenest-data.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  $("clearData").onclick = () => {
    if (!confirm("Clear saved watchlist, history, progress and preferences?"))
      return;
    [
      "cinenest_watchlist",
      "cinenest_history",
      "cinenest_prefs",
      "cinenest_progress",
    ].forEach((k) => localStorage.removeItem(k));
    location.reload();
  };

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;

    const k = e.key.toLowerCase();
    if (k === "/") {
      e.preventDefault();
      $("search").focus();
    } else if (k === "s") pageView("settingsPage");
    else if (k === "t") theme();
    else if (k === "p") {
      if (movie) loadPlayer();
    } else if (k === "w" && movie) toggleFav(movie);
    else if (k === "escape") {
      if (window.history.state?.view && window.history.state.view !== "home") {
        window.history.back();
      }
    } else if (k === "?")
      toast(
        "Shortcuts: / search · S settings · P play · W watchlist · T theme · Esc back",
      );
  });

  // Browser back/forward
  window.addEventListener("popstate", (e) => {
    const view = e.state?.view || "home";
    pageView(view, false);
  });
  if (!window.history.state) {
    window.history.replaceState({ view: "home" }, "");
  }

  // Save progress on tab hide / unload
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      if (progress[movie?.id]?.episodeProgress) saveProgressStore();
    }
  });
  window.addEventListener("beforeunload", () => {
    stopEpisodeTracking();
    if (progress[movie?.id]?.episodeProgress) saveProgressStore();
  });

  // ---------- Initial load ----------
  loadGenres().then(() => {
    renderFilterBadges();
  });
  loadPopular();
})();
