(() => {
  "use strict";

  // ---------- Constants ----------
  const TMDB_KEY = "8b2ae18b23829873d101cd49a562152c";
  const API = "https://api.themoviedb.org/3";
  const IMG = "https://image.tmdb.org/t/p/w500";
  const FALLBACK = "https://placehold.co/500x750/202735/e5e7eb?text=No+Poster";
  const $ = (id) => document.getElementById(id);

  // Servers — all support movie + tv patterns
  const servers = [
    {
      id: "vidbolt",
      name: "VidBolt",
      movie: (id) => `https://vidbolt.xyz/movie/${id}`,
      tv: (id, s, e) => `https://vidbolt.xyz/tv/${id}/${s}/${e}`,
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
      id: "vidly",
      name: "Vidly",
      movie: (id) => `https://vidly.pro/movie/${id}`,
      tv: (id, s, e) => `https://vidly.pro/tv/${id}/${s}/${e}`,
    },
    {
      id: "nxsha",
      name: "Nxsha",
      movie: (id) => `https://nxsha.space/embed/movie/${id}`,
      tv: (id, s, e) => `https://nxsha.space/embed/tv/${id}/${s}/${e}`,
    },
    {
      id: "screenscape",
      name: "Screenscape",
      movie: (id) => `https://nxsha.screenscape.me/embed?tmdb=${id}&type=movie`,
      tv: (id, s, e) =>
        `https://nxsha.screenscape.me/embed?tmdb=${id}&type=tv&s=${s}&e=${e}`,
    },
    {
      id: "moviesnexus",
      name: "MoviesNexus",
      movie: (id) => `https://www.moviesnexus.fun/movie/${id}`,
      tv: (id, s, e) => `https://www.moviesnexus.fun/tv/${id}/${s}/${e}`,
    },
  ];
  let currentServerId = "vidbolt";

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
  let prefs = read("cinenest_prefs", { theme: "dark", audio: "" });
  let toastTimer;
  let suggestionTimer;

  // IMDb rating cache: id -> { rating, votes }
  const imdbCache = new Map();

  // ---------- Init ----------
  if (prefs.theme === "light") document.body.classList.add("light");
  $("audio").value = prefs.audio || "";
  if (prefs.serverMovie && servers.some((s) => s.id === prefs.serverMovie)) {
    currentServerId = prefs.serverMovie;
  }

  // ---------- Persistence ----------
  function save() {
    localStorage.setItem("cinenest_watchlist", JSON.stringify(watchlist));
    localStorage.setItem("cinenest_history", JSON.stringify(history));
    localStorage.setItem("cinenest_prefs", JSON.stringify(prefs));
  }

  // ---------- Filter persistence ----------
  function saveFilters() {
    const f = {
      contentType: $("contentType").value,
      country: $("country").value,
      language: $("language").value,
      genre: $("genre").value,
      year: $("year").value,
      dateRange: $("dateRange").value,
      minRating: $("minRating").value,
      minVotes: $("minVotes").value,
      sort: $("sort").value,
      pageSize: $("pageSize").value,
    };
    localStorage.setItem("cinenest_filters", JSON.stringify(f));
  }

  function restoreFilters() {
    try {
      const f = JSON.parse(localStorage.getItem("cinenest_filters") || "{}");
      if (f.contentType) $("contentType").value = f.contentType;
      if (f.country !== undefined) $("country").value = f.country;
      if (f.language !== undefined) $("language").value = f.language;
      if (f.year !== undefined) $("year").value = f.year;
      if (f.dateRange !== undefined) $("dateRange").value = f.dateRange;
      if (f.minRating !== undefined) $("minRating").value = f.minRating;
      if (f.minVotes !== undefined) $("minVotes").value = f.minVotes;
      if (f.sort) $("sort").value = f.sort;
      if (f.pageSize) $("pageSize").value = f.pageSize;
    } catch {
      /* ignore */
    }
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
      // Stop any running player when leaving detail page
      $("player").innerHTML = "";
    } else if (!push && movie) {
      // Browser back/forward into detail page — reload player
      loadPlayer();
    }
    if (push && window.history.state?.view !== id) {
      window.history.pushState({ view: id }, "");
    }
  }

  // ---------- TMDB API (key is global) ----------
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

  function formatDate(d) {
    if (!d) return "";
    try {
      const date = new Date(d + "T00:00:00");
      return date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return d;
    }
  }

  // ---------- IMDb ratings (Agregarr batch API) ----------
  async function fetchImdbRatings(imdbIds) {
    if (!imdbIds.length) return {};
    // Filter out cached ones
    const missing = imdbIds.filter((id) => !imdbCache.has(id));
    if (missing.length === 0) {
      const out = {};
      imdbIds.forEach((id) => (out[id] = imdbCache.get(id)));
      return out;
    }

    try {
      const params = new URLSearchParams();
      missing.slice(0, 100).forEach((id) => params.append("id", id));
      const r = await fetch(`https://api.agregarr.org/api/ratings?${params}`);
      if (!r.ok) throw Error("IMDb API failed");
      const data = await r.json();
      const out = {};
      data.forEach((item) => {
        const obj = { rating: item.rating ?? null, votes: item.votes ?? null };
        imdbCache.set(item.imdbId, obj);
        out[item.imdbId] = obj;
      });
      // Also include cached
      imdbIds.forEach((id) => {
        if (!out[id] && imdbCache.has(id)) out[id] = imdbCache.get(id);
      });
      return out;
    } catch {
      // Return nulls on failure so UI still works
      const out = {};
      imdbIds.forEach((id) => (out[id] = { rating: null, votes: null }));
      return out;
    }
  }

  // Resolve TMDB ID -> IMDb ID (for a batch of movies)
  async function resolveImdbIds(tmdbItems) {
    // TMDB list endpoints don't include imdb_id; we must call /movie/{id} or /tv/{id}
    // To keep it fast, we do parallel individual calls for the current page (max 20).
    const promises = tmdbItems.map(async (m) => {
      const type = m.media_type === "tv" ? "tv" : "movie";
      try {
        const d = await tmdb(`/${type}/${m.id}`);
        return { tmdbId: m.id, imdbId: d.imdb_id || null };
      } catch {
        return { tmdbId: m.id, imdbId: null };
      }
    });
    const resolved = await Promise.all(promises);
    const map = {};
    resolved.forEach((r) => {
      if (r.imdbId) map[r.tmdbId] = r.imdbId;
    });
    return map;
  }

  // Attach IMDb ratings to items (mutates items with .imdb_rating, .imdb_votes)
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

    // Show IMDb rating if available, else TMDB
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
    const year =
      (m.release_date || m.first_air_date || "").slice(0, 4) || "Year unknown";
    meta.textContent = year;

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
      // Restore saved genre after options exist
      try {
        const f = JSON.parse(localStorage.getItem("cinenest_filters") || "{}");
        if (f.genre) sel.value = f.genre;
      } catch {
        /* ignore */
      }
    } catch {
      /* ignore */
    }
  }

  function buildDiscoverParams() {
    const contentType = $("contentType").value;
    const country = $("country").value;
    const language = $("language").value;
    const genre = $("genre").value;
    const year = $("year").value;
    const dateRange = $("dateRange").value;
    const minRating = $("minRating").value;
    const minVotes = $("minVotes").value;
    const sortBy = $("sort").value;

    const params = {
      page: String(page),
      include_adult: "false",
      sort_by: sortBy === "imdb.desc" ? "popularity.desc" : sortBy,
    };

    let endpoint = "/discover/movie";
    if (contentType === "tv" || contentType === "anime") {
      endpoint = "/discover/tv";
    }

    // Genre / anime
    if (contentType === "anime") {
      params.with_genres = "16";
      params.with_original_language = "ja";
    } else if (genre) {
      params.with_genres = genre;
    }

    // Language
    if (language && contentType !== "anime") {
      params.with_original_language = language;
    }

    // Country
    if (country) params.with_origin_country = country;

    // Year
    if (year) {
      if (endpoint === "/discover/movie") params.primary_release_year = year;
      else params.first_air_date_year = year;
    }

    // Release date range
    if (dateRange) {
      const dateField =
        endpoint === "/discover/movie"
          ? "primary_release_date"
          : "first_air_date";
      const today = new Date();
      let fromDate = null;
      let toDate = null;
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

    // Rating and votes
    if (minRating) params["vote_average.gte"] = minRating;
    if (minVotes) params["vote_count.gte"] = minVotes;

    return { endpoint, params, sortBy };
  }

  // ---------- Discover ----------
  async function discover(append = false) {
    mode = "discover";
    const pageSize = parseInt($("pageSize").value, 10) || 20;
    const pagesPerBatch = Math.max(1, Math.ceil(pageSize / 20));

    if (!append) {
      page = 1;
      $("grid").innerHTML = "";
    }

    const { endpoint, params, sortBy } = buildDiscoverParams();
    const startPage = page;

    try {
      status("Loading…");
      const batches = [];
      let lastTotalPages = 1;
      for (let i = 0; i < pagesPerBatch; i++) {
        const p = startPage + i;
        if (p > 500) break;
        params.page = String(p);
        const d = await tmdb(endpoint, params);
        batches.push(d.results || []);
        lastTotalPages = d.total_pages || 1;
        if (p >= lastTotalPages) break;
      }
      let items = [].concat(...batches);
      totalPages = lastTotalPages;
      page = startPage + pagesPerBatch;

      if (items.length) {
        await enrichWithImdb(items);
      }

      // Client-side sort by IMDb (only applies within this batch)
      if (sortBy === "imdb.desc") {
        items.sort((a, b) => (b.imdb_rating ?? 0) - (a.imdb_rating ?? 0));
      }

      results = append ? results.concat(items) : items;

      $("heading").textContent = "Discover";
      $("sub").textContent = `${results.length} results loaded`;

      render(results);
      if (results.length) hideEmpty();
      else empty("No results match these filters.");

      $("more").classList.toggle("hidden", page > totalPages);
      status("");
    } catch (e) {
      status(e.message);
      empty(e.message);
    }
  }

  // ---------- Popular ----------
  async function loadPopular(append = false) {
    mode = "popular";
    const pageSize = parseInt($("pageSize").value, 10) || 20;
    const pagesPerBatch = Math.max(1, Math.ceil(pageSize / 20));

    if (!append) {
      page = 1;
      $("grid").innerHTML = "";
      query = "";
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
      let items = [].concat(...batches);
      totalPages = lastTotalPages;
      page = startPage + pagesPerBatch;

      await enrichWithImdb(items);

      results = append ? results.concat(items) : items;

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
    if ($("home").classList.contains("hidden")) {
      pageView("home");
      if (!append) $("grid").innerHTML = "";
    }

    mode = "search";
    query = q;
    page = append ? page + 1 : 1;

    if (!append) $("grid").innerHTML = "";

    try {
      status("Searching…");
      const d = await tmdb("/search/multi", {
        query: q,
        include_adult: "false",
        page: String(page),
      });

      // Filter out people results
      let items = (d.results || []).filter((x) => x.media_type !== "person");

      await enrichWithImdb(items);

      results = append ? results.concat(items) : items;
      totalPages = d.total_pages || 1;

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

  // ---------- Open movie detail ----------
  async function openMovie(m) {
    movie = m;
    currentImdbId = null;
    currentSeason = 1;
    currentEpisode = 1;
    seasons = [];
    episodes = [];

    // Robust media type detection
    let type = m.media_type;
    if (!type) {
      if (m.first_air_date || m.name) type = "tv";
      else type = "movie";
    }
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

    // Load saved server for this media type
    const savedServer = type === "tv" ? prefs.serverTv : prefs.serverMovie;
    if (savedServer && servers.some((s) => s.id === savedServer)) {
      currentServerId = savedServer;
    }

    // Fetch details with type-mismatch fallback
    let d = null;
    try {
      try {
        d = await tmdb(`/${type}/${m.id}`);
      } catch {
        type = type === "movie" ? "tv" : "movie";
        currentMediaType = type;
        d = await tmdb(`/${type}/${m.id}`);
      }
      // Verify title matches (fixes VisionQuest / ID-collision issue)
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

    // Render pills (after type confirmed)
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

      // IMDb rating + link (correct imdb_id now)
      currentImdbId = d.imdb_id || null;
      $("imdbLink").classList.toggle("hidden", !currentImdbId);
      if (d.imdb_id) {
        const ratings = await fetchImdbRatings([d.imdb_id]);
        const imdb = ratings[d.imdb_id];
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

      // TV seasons + episodes
      if (type === "tv") {
        seasons = (d.seasons || []).filter((s) => s.season_number > 0);
        if (seasons.length) {
          $("episodeSection").classList.remove("hidden");
          populateSeasonSelect();
          await loadSeasonEpisodes(1);
        }
      }
    }

    renderServerTabs();
    loadPlayer();

    history = history.filter((x) => x.id !== m.id);
    history.unshift({ ...m, openedAt: Date.now() });
    history = history.slice(0, 30);
    save();
    renderHistory();
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
    iframe.allow =
      "autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write";
    iframe.allowFullscreen = true;
    // Try permissive referrer policy; some servers require no-referrer
    iframe.referrerPolicy = "no-referrer";
    // Sandbox with broad permissions (helps some players)
    iframe.setAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-downloads",
    );
    // Add error handling: if iframe fails, show fallback message
    iframe.onerror = () => {
      const placeholder = document.createElement("div");
      placeholder.className = "placeholder";
      placeholder.textContent =
        "This server refused to connect in an iframe. Please try another server.";
      $("player").replaceChildren(placeholder);
    };

    $("player").replaceChildren(iframe);

    if (currentMediaType === "tv") {
      $("playerMeta").textContent = `S${String(currentSeason).padStart(
        2,
        "0",
      )}E${String(currentEpisode).padStart(2, "0")} · ${server.name}`;
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
        if (currentMediaType === "tv") prefs.serverTv = srv.id;
        else prefs.serverMovie = srv.id;
        save();
        renderServerTabs();
        loadPlayer();
      };
      container.append(btn);
    });
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
      el.className =
        "episode-card" +
        (ep.episode_number === currentEpisode ? " active" : "");
      el.onclick = () => {
        currentEpisode = ep.episode_number;
        renderEpisodes();
        loadPlayer();
      };

      const img = document.createElement("img");
      img.src = ep.still_path
        ? `https://image.tmdb.org/t/p/w300${ep.still_path}`
        : FALLBACK;
      img.alt = "";
      img.onerror = () => (img.src = FALLBACK);

      const info = document.createElement("div");
      info.className = "episode-info";

      const num = document.createElement("div");
      num.className = "episode-num";
      num.textContent = `S${String(currentSeason).padStart(
        2,
        "0",
      )}E${String(ep.episode_number).padStart(2, "0")}`;

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

  // ---------- Search suggestions ----------
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

  // ---------- Event bindings ----------
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

  $("popularBtn").onclick = loadPopular;
  $("watchlistBtn").onclick = () => list("watchlist");
  $("historyBtn").onclick = () => list("history");

  // Filters
  $("applyFilters").onclick = () => {
    saveFilters();
    discover(false);
  };
  $("resetFilters").onclick = () => {
    $("contentType").value = "movie";
    $("country").value = "";
    $("language").value = "";
    $("genre").value = "";
    $("year").value = "";
    $("dateRange").value = "";
    $("minRating").value = "";
    $("minVotes").value = "";
    $("sort").value = "popularity.desc";
    $("pageSize").value = "20";
    saveFilters();
    discover(false);
  };

  // Load more
  $("more").onclick = () => {
    if (mode === "search") search(query, true);
    else if (mode === "discover") discover(true);
    else loadPopular();
  };

  // Audio preference
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
      new Blob([JSON.stringify({ watchlist, history, prefs }, null, 2)], {
        type: "application/json",
      }),
    );
    a.download = "cinenest-data.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  $("clearData").onclick = () => {
    if (!confirm("Clear saved watchlist, history and preferences?")) return;
    ["cinenest_watchlist", "cinenest_history", "cinenest_prefs"].forEach((k) =>
      localStorage.removeItem(k),
    );
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

  // ---------- Browser back / forward navigation ----------
  window.addEventListener("popstate", (e) => {
    const view = e.state?.view || "home";
    pageView(view, false);
  });

  if (!window.history.state) {
    window.history.replaceState({ view: "home" }, "");
  }

  // ---------- Initial load ----------
  loadGenres();
  restoreFilters();
  loadPopular();
})();
