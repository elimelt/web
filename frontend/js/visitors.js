// =============================================================================
// Imports
// =============================================================================
import { getVisitors, getVisitorsAnalytics, getWsVisitors } from './api.js';
import { BASE_URL, PAGE_SIZE, RECONNECT } from './config.js';
import { toTimestampMs, debounce, getHumanReadableDateTimeString } from './utils.js';

// =============================================================================
// Module State
// =============================================================================
let visitorsInitialized = false;

/** All visitor events collected from API and WebSocket */
let allVisitorEvents = [];

/** Map of IP addresses to their activity data */
let ipActivityMap = new Map();

/** Filter state for visitor list */
const filterState = {
  time: 'all',
  search: '',
  searchInvert: false
};

/** Pagination state for infinite scroll */
const paginationState = {
  isLoadingMore: false,
  hasMoreEvents: true,
    nextBefore: null,
    totalEvents: null
};

// =============================================================================
// Constants
// =============================================================================
/** Time bucket size for event deduplication (1 hour) */
const DEDUP_BUCKET_MS = 60 * 60 * 1000;

// =============================================================================
// Main Initialization
// =============================================================================
function initVisitors() {
  if (visitorsInitialized) return;
  visitorsInitialized = true;

  // ---------------------------------------------------------------------------
  // DOM Elements
  // ---------------------------------------------------------------------------
  const statsEl = document.getElementById("visitor-stats");
  const analyticsEl = document.getElementById("visitor-analytics");
  const listEl = document.getElementById("visitor-list");
  const recentTitleEl = document.getElementById("recent-visitors-title");
  const recentListEl = document.getElementById("recent-visitor-list");
  const filterTimeEl = document.getElementById("visitor-filter-time");
  const filterSearchEl = document.getElementById("visitor-filter-search");
  const filterStatsEl = document.getElementById("visitor-filter-stats");
  const modalOverlay = document.getElementById("visitor-modal-overlay");
  const modalTitle = document.getElementById("visitor-modal-title");
  const modalContent = document.getElementById("visitor-modal-content");
  const modalClose = document.getElementById("visitor-modal-close");
  // analytics button removed

  if (!statsEl || !listEl) {
    visitorsInitialized = false;
    return;
  }

  // ---------------------------------------------------------------------------
  // WebSocket Connection State
  // ---------------------------------------------------------------------------
  let reconnectTimer = null;
  let currentWs = null;
  let retries = 0;
  let stopped = false;

  // ---------------------------------------------------------------------------
  // Utility Functions
  // ---------------------------------------------------------------------------
  function normalizeVisitors(data) {
    if (!data) return [];
    let visitors = [];
    if (Array.isArray(data)) {
      visitors = data;
    } else if (Array.isArray(data.visitors)) {
      visitors = data.visitors;
    } else if (Array.isArray(data.active_visitors)) {
      visitors = data.active_visitors;
    } else if (data.visitors && typeof data.visitors === "object") {
      visitors = Object.values(data.visitors);
    } else if (Array.isArray(data.recent_visits)) {
      visitors = data.recent_visits;
    }
    const seen = new Set();
    return visitors.filter((v) => {
      const ip = v?.ip || v?.address || v?.id;
      if (!ip || seen.has(ip)) return false;
      seen.add(ip);
      return true;
    });
  }

  function formatVisitor(visitor) {
    if (!visitor || typeof visitor !== "object") return "Unknown visitor";
    const ip = visitor.ip || visitor.address || visitor.id || "unknown";
    const city = visitor.location?.city || visitor.city;
    const country = visitor.location?.country || visitor.country;
    const ua = visitor.userAgent || visitor.ua;
    const parts = [];
    parts.push(ip);
    if (city || country) {
      parts.push(`— ${[city, country].filter(Boolean).join(", ")}`);
    }
    if (ua) {
      parts.push(`(${ua.split(" ").slice(0, 6).join(" ")}…)`);
    }
    return parts.join(" ");
  }

  function formatRecentVisit(visit) {
    if (!visit || typeof visit !== "object") return "Unknown visitor";
    const base = formatVisitor(visit);
    const ts = visit.timestamp || visit.connected_at;
    if (!ts) return base;
    const d = new Date(ts);
    if (isNaN(d.getTime())) return base;
    const when = d.toLocaleString(undefined, {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
    return `${base} — ${when}`;
  }

  function getVisitorIp(visit) {
    if (!visit || typeof visit !== "object") return null;
    return visit.ip || visit.address || visit.id || null;
  }

  function getEventDedupKey(event) {
    const ip = getVisitorIp(event) || "unknown";
    const tsMs = toTimestampMs(event?.timestamp ?? event?.connected_at);
    const bucket = tsMs == null ? "unknown" : Math.floor(tsMs / DEDUP_BUCKET_MS);
    const type = event.type || 'join';
    return `${ip}:${bucket}:${type}`;
  }

  function dedupeVisitorEvents(events) {
    if (!Array.isArray(events) || events.length === 0) return [];
    const sorted = [...events].sort((a, b) => {
      const ta = toTimestampMs(a?.timestamp ?? a?.connected_at) ?? 0;
      const tb = toTimestampMs(b?.timestamp ?? b?.connected_at) ?? 0;
      return tb - ta;
    });
    const seen = new Set();
    const result = [];
    for (const event of sorted) {
      const key = getEventDedupKey(event);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(event);
    }
    return result;
  }

  function getEventSearchText(event) {
    const parts = [];
    const ip = getVisitorIp(event);
    if (ip) parts.push(ip);

    const loc = event.location;
    if (loc) {
      if (loc.city) parts.push(loc.city);
      if (loc.region) parts.push(loc.region);
      if (loc.country) parts.push(loc.country);
    }
    if (event.city) parts.push(event.city);
    if (event.country) parts.push(event.country);

    return parts.join(' ').toLowerCase();
  }

  function filterEvents(events) {
    const now = Date.now();
    const timeRanges = {
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      'all': Infinity
    };
    const timeLimit = timeRanges[filterState.time] || Infinity;
    const cutoff = now - timeLimit;

    let searchRegex = null;
    if (filterState.search) {
      try {
        searchRegex = new RegExp(filterState.search, 'i');
      } catch (e) {
        searchRegex = new RegExp(filterState.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      }
    }

    return events.filter(event => {
      const eventTime = toTimestampMs(event.timestamp || event.connected_at);
      if (eventTime && eventTime < cutoff) {
        return false;
      }

      if (searchRegex) {
        const searchText = getEventSearchText(event);
        const matches = searchRegex.test(searchText);
        if (filterState.searchInvert ? matches : !matches) {
          return false;
        }
      }

      return true;
    });
  }

  function buildIpActivityMap(events) {
    ipActivityMap.clear();

    for (const event of events) {
      const ip = getVisitorIp(event);
      if (!ip) continue;

      if (!ipActivityMap.has(ip)) {
        ipActivityMap.set(ip, {
          ip,
          events: [],
          firstSeen: null,
          lastSeen: null,
          totalVisits: 0,
          location: event.location || { city: event.city, country: event.country },
          userAgent: event.userAgent || event.ua
        });
      }

      const activity = ipActivityMap.get(ip);
      const eventTime = toTimestampMs(event.timestamp || event.connected_at);

      activity.events.push({
        type: event.type || 'join',
        timestamp: eventTime,
        raw: event
      });

      if (event.type === 'join') {
        activity.totalVisits++;
      }

      if (eventTime) {
        if (!activity.firstSeen || eventTime < activity.firstSeen) {
          activity.firstSeen = eventTime;
        }
        if (!activity.lastSeen || eventTime > activity.lastSeen) {
          activity.lastSeen = eventTime;
        }
      }
    }

    for (const activity of ipActivityMap.values()) {
      activity.events.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    }
  }

  function formatTimestamp(ms) {
    if (!ms) return 'Unknown';
    return getHumanReadableDateTimeString(ms);
  }

  // Cached analytics data
  let analyticsCache = null;
  let analyticsFetchedAt = 0;
  const ANALYTICS_TTL_MS = 60 * 1000;

  async function getAnalyticsCached() {
    const now = Date.now();
    if (analyticsCache && (now - analyticsFetchedAt) < ANALYTICS_TTL_MS) {
      return analyticsCache;
    }
    const analytics = await getVisitorAnalytics();
    analyticsCache = analytics || null;
    analyticsFetchedAt = Date.now();
    return analyticsCache;
  }

  function formatDuration(seconds) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '—';
    const s = Math.round(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const rem = s % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${rem}s`;
    return `${rem}s`;
  }

  // ---------------------------------------------------------------------------
  // Modal Functions
  // ---------------------------------------------------------------------------
  function showIpActivityModal(ip) {
    const activity = ipActivityMap.get(ip);
    if (!activity) return;

    if (modalTitle) {
      modalTitle.textContent = `Activity for ${ip}`;
    }

    if (modalContent) {
      // Render analytics placeholder and event history (no non-analytics summary)
      modalContent.innerHTML = `
        <div class="visitor-modal-summary" id="visitor-analytics-summary">
          <div class="visitor-modal-stat" style="grid-column: 1 / -1;">
            <div class="visitor-modal-loading">Loading analytics…</div>
          </div>
        </div>
        <h4 class="visitor-modal-events-title">Event History</h4>
        <ul class="visitor-modal-events">
          ${activity.events.slice().reverse().map(event => `
            <li class="visitor-modal-event">
              <span class="visitor-modal-event-type ${event.type}">${event.type}</span>
              <span class="visitor-modal-event-time">${formatTimestamp(event.timestamp)}</span>
            </li>
          `).join('')}
        </ul>
      `;
    }

    if (modalOverlay) {
      modalOverlay.classList.add('active');
    }

    // Fetch analytics asynchronously and enrich the modal
    getAnalyticsCached()
      .then((analytics) => {
        const container = modalContent?.querySelector('#visitor-analytics-summary');
        if (!container) return;
        const perIp = (analytics?.visitors || []).find(v => v.visitor_ip === ip);
        if (!perIp) {
          container.innerHTML = `
            <div class="visitor-modal-stat" style="grid-column: 1 / -1;">
              <div class="visitor-modal-error">No analytics available for this visitor.</div>
            </div>
          `;
          return;
        }

        const totalTime = formatDuration(perIp.total_time_seconds);
        const avgSession = formatDuration(perIp.avg_session_duration_seconds);
        const recurring = perIp.is_recurring ? 'Yes' : 'No';
        const freq = perIp.visit_frequency_per_day != null ? String(perIp.visit_frequency_per_day) : '—';
        const city = perIp.location_city || 'Unknown';
        const country = perIp.location_country || 'Unknown';

        container.innerHTML = `
          <div class="visitor-modal-stat">
            <div class="visitor-modal-stat-label">Analytics Visits</div>
            <div class="visitor-modal-stat-value">${perIp.total_visits ?? '—'}</div>
          </div>
          <div class="visitor-modal-stat">
            <div class="visitor-modal-stat-label">Total Time</div>
            <div class="visitor-modal-stat-value">${totalTime}</div>
          </div>
          <div class="visitor-modal-stat">
            <div class="visitor-modal-stat-label">Avg Session</div>
            <div class="visitor-modal-stat-value">${avgSession}</div>
          </div>
          <div class="visitor-modal-stat">
            <div class="visitor-modal-stat-label">Recurring</div>
            <div class="visitor-modal-stat-value">${recurring}</div>
          </div>
          <div class="visitor-modal-stat">
            <div class="visitor-modal-stat-label">Visits/Day</div>
            <div class="visitor-modal-stat-value">${freq}</div>
          </div>
          <div class="visitor-modal-stat">
            <div class="visitor-modal-stat-label">Location</div>
            <div class="visitor-modal-stat-value">${city}, ${country}</div>
          </div>
        `;
      })
      .catch(() => {
        const container = modalContent?.querySelector('#visitor-analytics-summary');
        if (container) {
          container.innerHTML = `
            <div class="visitor-modal-stat" style="grid-column: 1 / -1;">
              <div class="visitor-modal-error">Failed to load analytics.</div>
            </div>
          `;
        }
      });
  }

  function closeModal() {
    if (modalOverlay) {
      modalOverlay.classList.remove('active');
    }
  }

  if (modalClose) {
    modalClose.addEventListener('click', closeModal);
  }
  if (modalOverlay) {
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) {
        closeModal();
      }
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
    }
  });

  // ---------------------------------------------------------------------------
  // Filtering Functions
  // ---------------------------------------------------------------------------
  function updateFilterStats() {
    if (!filterStatsEl) return;
    filterStatsEl.textContent = "";
  }

  function applyFilters() {
    const filtered = filterEvents(allVisitorEvents);
    renderRecentWithFilters(filtered);

    updateFilterStats();

    ensureScrollable();
  }

  // ---------------------------------------------------------------------------
  // Filter Event Handlers
  // ---------------------------------------------------------------------------
  if (filterTimeEl) {
    filterTimeEl.addEventListener('change', (e) => {
      filterState.time = e.target.value;
      applyFilters();
    });
  }

  if (filterSearchEl) {
    const handleSearchInput = debounce((e) => {
      let value = e.target.value.trim();
      if (value.startsWith('!')) {
        filterState.searchInvert = true;
        value = value.slice(1);
      } else {
        filterState.searchInvert = false;
      }
      filterState.search = value;
      applyFilters();
    }, 150);
    filterSearchEl.addEventListener('input', handleSearchInput);
  }

  // ---------------------------------------------------------------------------
  // Rendering Functions
  // ---------------------------------------------------------------------------
  function createVisitorListItem(v) {
    const li = document.createElement("li");
    const ip = getVisitorIp(v);
    const eventType = v.type || 'join';
    const typeIndicator = eventType === 'join' ? '→' : '←';
    li.textContent = `${typeIndicator} ${formatRecentVisit(v)}`;
    li.dataset.ip = ip;
    // Analytics metadata to improve identifiability
    li.setAttribute('data-analytics', 'visitors.recent_item');
    if (ip) {
      li.setAttribute('data-analytics-id', `visitor:${ip}`);
      li.setAttribute('data-analytics-label', `Recent visitor ${ip}`);
    }
    li.addEventListener('click', () => {
      if (ip) {
        showIpActivityModal(ip);
      }
    });
    return li;
  }

  function getLoadingIndicator() {
    let loader = recentListEl?.querySelector('.visitor-loader');
    if (!loader && recentListEl) {
      loader = document.createElement("li");
      loader.className = "visitor-loader";
      loader.textContent = "Loading more…";
      loader.style.opacity = "0.6";
      loader.style.textAlign = "center";
      loader.style.display = "none";
    }
    return loader;
  }

  function setLoading(loading) {
    paginationState.isLoadingMore = loading;
    const loader = getLoadingIndicator();
    if (loader) {
      loader.style.display = loading ? "block" : "none";
    }
  }

  function renderRecentWithFilters(visits, append = false) {
    if (!recentListEl) return;

    if (!append) {
      recentListEl.innerHTML = "";
    }

    if (!Array.isArray(visits) || visits.length === 0) {
      if (!append) {
        const li = document.createElement("li");
        li.textContent = "No matching visitors.";
        li.style.opacity = "0.8";
        recentListEl.appendChild(li);
      }
      return;
    }

    const fragment = document.createDocumentFragment();
    visits.forEach((v) => {
      fragment.appendChild(createVisitorListItem(v));
    });
    recentListEl.appendChild(fragment);

    const existingLoader = recentListEl.querySelector('.visitor-loader');
    if (!existingLoader) {
      const loader = getLoadingIndicator();
      if (loader) {
        recentListEl.appendChild(loader);
      }
    }
  }

  function appendMoreEvents(events) {
    if (!recentListEl || !Array.isArray(events) || events.length === 0) return;

    const newEvents = events.map(v => ({
      ...v,
      type: v.type || 'join'
    }));
    allVisitorEvents = dedupeVisitorEvents([...allVisitorEvents, ...newEvents]);
    buildIpActivityMap(allVisitorEvents);

    const filtered = filterEvents(allVisitorEvents);
    renderRecentWithFilters(filtered);

    updateFilterStats();
  }

  function render(visitors, countOverride) {
    const count =
      typeof countOverride === "number" ? countOverride : visitors.length;
    statsEl.textContent = `${count} active ${
      count === 1 ? "visitor" : "visitors"
    }`;
    listEl.innerHTML = "";
    if (count === 0) {
      const li = document.createElement("li");
      li.textContent = "No active visitors right now.";
      li.style.opacity = "0.8";
      listEl.appendChild(li);
      return;
    }
    if (!visitors || visitors.length === 0) {
      const li = document.createElement("li");
      li.textContent = `${count} visitors active (details unavailable)`;
      listEl.appendChild(li);
      return;
    }
    visitors.forEach((v) => {
      const li = document.createElement("li");
      li.textContent = formatVisitor(v);
      listEl.appendChild(li);
    });
  }

  function renderRecent(recentVisits) {
    if (!recentListEl) return;
    if (recentTitleEl) {
      recentTitleEl.textContent = "Recent visitors";
    }

    const eventsWithType = (recentVisits || []).map(v => ({
      ...v,
      type: v.type || 'join'
    }));
    allVisitorEvents = dedupeVisitorEvents(eventsWithType);
    buildIpActivityMap(allVisitorEvents);

    const filtered = filterEvents(allVisitorEvents);
    renderRecentWithFilters(filtered);

    updateFilterStats();
  }

  // ---------------------------------------------------------------------------
  // Network/API Functions
  // ---------------------------------------------------------------------------

  async function getVisitorAnalytics() {
    const analytics = await getVisitorsAnalytics();

    /**
     * {
      "visitors": [
          {
              "visitor_ip": "100.71.111.68",
              "computed_at": "2026-01-01T21:09:42.544536+00:00",
              "period_start": "2026-01-01T00:00:00+00:00",
              "period_end": "2026-01-02T00:00:00+00:00",
              "total_visits": 6,
              "total_time_seconds": 11649.626308,
              "avg_session_duration_seconds": 1941.6043846666669,
              "is_recurring": true,
              "first_visit_at": "2026-01-01T20:41:05.231055+00:00",
              "last_visit_at": "2026-01-01T21:06:42.120291+00:00",
              "visit_frequency_per_day": 6,
              "location_country": "Unknown",
              "location_city": "Unknown"
          },
          {
              "visitor_ip": "202.8.40.181",
              "computed_at": "2026-01-01T21:09:42.535864+00:00",
              "period_start": "2026-01-01T00:00:00+00:00",
              "period_end": "2026-01-02T00:00:00+00:00",
              "total_visits": 2,
              "total_time_seconds": 3.8441989999999997,
              "avg_session_duration_seconds": 1.9220994999999998,
              "is_recurring": true,
              "first_visit_at": "2026-01-01T04:46:35.140874+00:00",
              "last_visit_at": "2026-01-01T15:54:37.306162+00:00",
              "visit_frequency_per_day": 2,
              "location_country": "United States",
              "location_city": "Ashburn"
          },
          {
              "visitor_ip": "100.79.135.19",
              "computed_at": "2026-01-01T21:09:42.526011+00:00",
              "period_start": "2026-01-01T00:00:00+00:00",
              "period_end": "2026-01-02T00:00:00+00:00",
              "total_visits": 84,
              "total_time_seconds": 14658.645890999998,
              "avg_session_duration_seconds": 174.5076891785714,
              "is_recurring": true,
              "first_visit_at": "2026-01-01T03:39:23.982034+00:00",
              "last_visit_at": "2026-01-01T20:57:42.847240+00:00",
              "visit_frequency_per_day": 84,
              "location_country": "Unknown",
              "location_city": "Unknown"
          },
          {
              "visitor_ip": "100.89.233.21",
              "computed_at": "2026-01-01T21:09:35.991505+00:00",
              "period_start": "2025-12-31T00:00:00+00:00",
              "period_end": "2026-01-01T00:00:00+00:00",
              "total_visits": 1,
              "total_time_seconds": 2058.363283,
              "avg_session_duration_seconds": 2058.363283,
              "is_recurring": false,
              "first_visit_at": "2025-12-31T23:25:41.636717+00:00",
              "last_visit_at": "2025-12-31T23:25:41.636717+00:00",
              "visit_frequency_per_day": 1,
              "location_country": "Unknown",
              "location_city": "Unknown"
          },
          {
              "visitor_ip": "100.79.135.19",
              "computed_at": "2026-01-01T21:09:35.982509+00:00",
              "period_start": "2025-12-31T00:00:00+00:00",
              "period_end": "2026-01-01T00:00:00+00:00",
              "total_visits": 1,
              "total_time_seconds": 529.112429,
              "avg_session_duration_seconds": 529.112429,
              "is_recurring": false,
              "first_visit_at": "2025-12-31T23:51:10.887571+00:00",
              "last_visit_at": "2025-12-31T23:51:10.887571+00:00",
              "visit_frequency_per_day": 1,
              "location_country": "Unknown",
              "location_city": "Unknown"
          }
      ],
      "count": 5,
      "filters": {
          "visitor_id": null,
          "start_date": null,
          "end_date": null,
          "segment": null,
          "limit": 100
      }
  }
     */

    return analytics;
  }

  function renderVisitorAnalytics(analytics) {
    if (!analyticsEl) return;
    analyticsEl.innerHTML = `
      <h2>Visitor Analytics</h2>
      <table>
        <thead>
          <tr>
            <th>IP</th>
            <th>Total Visits</th>
            <th>Total Time</th>
          </tr>
        </thead>
        <tbody>
          ${analytics.visitors.map(visitor => `
            <tr>
              <td>${visitor.visitor_ip}</td>
              <td>${visitor.total_visits}</td>
              <td>${visitor.total_time_seconds}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  async function fetchPresenceEvents(before = null) {
    const params = new URLSearchParams({
      topic: "visitor_updates",
      limit: String(PAGE_SIZE),
    });
    if (before) {
      params.set("before", before);
    }

    try {
      const res = await fetch(`${BASE_URL}/events?${params}`);
      const body = await res.json();

      const events = (body.events || []).map((e) => ({
        ...e,
        type: e.type,
        ip: e.payload?.visitor?.ip || e.payload?.ip || e.visitor?.ip || e.ip,
        timestamp: e.timestamp || e.payload?.visitor?.connected_at,
        location: e.payload?.visitor?.location || e.visitor?.location || e.location,
        userAgent: e.payload?.visitor?.userAgent || e.visitor?.userAgent || e.userAgent || e.ua,
      }));

      const sortedEvents = events.sort((a, b) => {
        const ta = toTimestampMs(a.timestamp) || 0;
        const tb = toTimestampMs(b.timestamp) || 0;
        return tb - ta;
      });

      const total =
        typeof body.total === 'number' ? body.total
        : typeof body.total_count === 'number' ? body.total_count
        : typeof body.count === 'number' ? body.count
        : typeof body.events_total === 'number' ? body.events_total
        : null;

      return { events: sortedEvents, nextBefore: body.next_before || null, total };
    } catch (err) {
      console.error("Failed to fetch presence events:", err);
      return { events: [], nextBefore: null, total: null };
    }
  }

  async function fetchMoreEvents() {
    if (paginationState.isLoadingMore || !paginationState.hasMoreEvents) return false;

    setLoading(true);

    try {
      const { events, nextBefore, total } = await fetchPresenceEvents(paginationState.nextBefore);

      if (total != null) {
        paginationState.totalEvents = total;
      }

      if (events.length === 0 || !nextBefore) {
        paginationState.hasMoreEvents = false;
        return false;
      }

      paginationState.nextBefore = nextBefore;

      const existingKeys = new Set(allVisitorEvents.map(getEventDedupKey));
      const newEvents = events.filter(e => !existingKeys.has(getEventDedupKey(e)));

      if (newEvents.length > 0) {
        appendMoreEvents(newEvents);
      }

      return true;
    } catch (err) {
      console.error("Failed to fetch more events:", err);
      return false;
    } finally {
      setLoading(false);
    }
  }

  function handleRecentListScroll() {
    if (!recentListEl) return;

    const { scrollTop, scrollHeight, clientHeight } = recentListEl;
    const nearBottom = scrollHeight - scrollTop - clientHeight < 50;

    if (nearBottom && !paginationState.isLoadingMore && paginationState.hasMoreEvents) {
      fetchMoreEvents();
    }
  }

  function isScrollable() {
    if (!recentListEl) return true;
    return recentListEl.scrollHeight > recentListEl.clientHeight;
  }

  async function ensureScrollable() {
    while (!isScrollable() && paginationState.hasMoreEvents && !paginationState.isLoadingMore) {
      const fetched = await fetchMoreEvents();
      if (!fetched) break;
    }
  }

  async function refreshVisitors() {
    try {
      const data = await getVisitors();
      const activeVisitors = normalizeVisitors(data);
      const activeCount =
        typeof data?.active_count === "number"
          ? data.active_count
          : activeVisitors.length;
      render(activeVisitors, activeCount);

      const recentVisits = Array.isArray(data?.recent_visits) ? data.recent_visits : [];

      const sortedEvents = [...recentVisits].sort((a, b) => {
        const ta = toTimestampMs(a.timestamp || a.connected_at) || 0;
        const tb = toTimestampMs(b.timestamp || b.connected_at) || 0;
        return tb - ta;
      });

      if (sortedEvents.length > 0) {
        const oldestEvent = sortedEvents[sortedEvents.length - 1];
        const oldestTimestamp = oldestEvent.timestamp || oldestEvent.connected_at;
        if (oldestTimestamp) {
          paginationState.nextBefore = oldestTimestamp;
          paginationState.hasMoreEvents = true;
        } else {
          paginationState.hasMoreEvents = false;
        }
      } else {
        paginationState.hasMoreEvents = false;
      }

      renderRecent(sortedEvents);

      ensureScrollable();
    } catch (err) {
      console.error("Failed to load visitors:", err);
      statsEl.textContent = "Failed to load visitors";
    }
  }

  // ---------------------------------------------------------------------------
  // WebSocket Functions
  // ---------------------------------------------------------------------------
  function stopRetrying() {
    stopped = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (currentWs) {
      currentWs.ws.onclose = null;
      currentWs.ws.onerror = null;
      currentWs.close();
      currentWs = null;
    }
    statsEl.textContent = "Connection failed — refresh page to retry";
  }

  function scheduleReconnect() {
    if (stopped) return;
    if (reconnectTimer) return;
    retries++;
    if (retries >= RECONNECT.maxRetries) {
      stopRetrying();
      return;
    }
    statsEl.textContent = `Disconnected — retry ${retries}/${RECONNECT.maxRetries}…`;
    reconnectTimer = setTimeout(initRealtime, RECONNECT.minDelay);
  }

  function initRealtime() {
    if (stopped) return;

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (currentWs) {
      currentWs.ws.onclose = null;
      currentWs.ws.onerror = null;
      currentWs.close();
      currentWs = null;
    }

    try {
      currentWs = getWsVisitors({
        onConnect: () => {
          if (stopped) return;
          retries = 0;
          statsEl.textContent = "Connected — updating…";
          refreshVisitors();
        },
        onVisitorJoin: () => {
          if (stopped) return;
          refreshVisitors();
        },
        onVisitorLeave: () => {
          if (stopped) return;
          refreshVisitors();
        },
        onUpdate: () => {
          if (stopped) return;
          refreshVisitors();
        },
        onError: () => {
          if (stopped) return;
          scheduleReconnect();
        },
        onDisconnect: () => {
          if (stopped) return;
          scheduleReconnect();
        },
      });
    } catch (e) {
      console.error("Failed to start realtime tracking:", e);
      scheduleReconnect();
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup & Initialization
  // ---------------------------------------------------------------------------
  function cleanup() {
    stopRetrying();
  }

  window.addEventListener("beforeunload", cleanup);
  window.addEventListener("pagehide", cleanup);

  if (recentListEl) {
    recentListEl.addEventListener("scroll", handleRecentListScroll);
  }

  // Start the visitor tracking
  refreshVisitors();
  initRealtime();
}



// =============================================================================
// Module Bootstrap
// =============================================================================
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initVisitors);
} else {
  initVisitors();
}
