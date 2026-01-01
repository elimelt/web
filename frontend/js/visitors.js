import { getVisitors, getWsVisitors } from './api.js';
import { BASE_URL } from './config.js';

let visitorsInitialized = false;

// Store all visitor events for filtering
let allVisitorEvents = [];
let ipActivityMap = new Map();

// Filter state
const filterState = {
  time: 'all',
  ip: ''
};

function initVisitors() {
  if (visitorsInitialized) return;
  visitorsInitialized = true;

  const statsEl = document.getElementById("visitor-stats");
  const listEl = document.getElementById("visitor-list");
  const recentTitleEl = document.getElementById("recent-visitors-title");
  const recentListEl = document.getElementById("recent-visitor-list");
  const filterTimeEl = document.getElementById("visitor-filter-time");
  const filterIpEl = document.getElementById("visitor-filter-ip");
  const filterStatsEl = document.getElementById("visitor-filter-stats");
  const modalOverlay = document.getElementById("visitor-modal-overlay");
  const modalTitle = document.getElementById("visitor-modal-title");
  const modalContent = document.getElementById("visitor-modal-content");
  const modalClose = document.getElementById("visitor-modal-close");

  if (!statsEl || !listEl) {
    visitorsInitialized = false;
    return;
  }

  let reconnectTimer = null;
  let currentWs = null;
  let retries = 0;
  let stopped = false;
  const maxRetries = 5;
  const minDelay = 2000;

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
    // Deduplicate by IP
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
    // Show a concise local timestamp
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

  function toTimestampMs(value) {
    if (value == null) return null;
    if (typeof value === "number") {
      // Handle seconds vs milliseconds
      return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
    }
    if (typeof value === "string") {
      const num = Number(value);
      if (!Number.isNaN(num)) {
        return num < 1e12 ? Math.round(num * 1000) : Math.round(num);
      }
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? null : parsed;
    }
    if (value instanceof Date) {
      const ms = value.getTime();
      return Number.isNaN(ms) ? null : ms;
    }
    return null;
  }

  function dedupeRecentVisitsByTenMinutes(recentVisits) {
    if (!Array.isArray(recentVisits) || recentVisits.length === 0) return [];
    const TEN_MIN_MS = 10 * 60 * 1000;
    // Sort newest first to keep the most recent within each bucket
    const sorted = [...recentVisits].sort((a, b) => {
      const ta = toTimestampMs(a?.timestamp ?? a?.connected_at) ?? 0;
      const tb = toTimestampMs(b?.timestamp ?? b?.connected_at) ?? 0;
      return tb - ta;
    });
    const seen = new Set();
    const result = [];
    for (const visit of sorted) {
      const ip = getVisitorIp(visit) || "unknown";
      const tsMs = toTimestampMs(visit?.timestamp ?? visit?.connected_at);
      const bucket = tsMs == null ? "unknown" : Math.floor(tsMs / TEN_MIN_MS);
      const key = `${ip}:${bucket}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(visit);
    }
    return result;
  }

  // Filter visitor events based on current filter state
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

    return events.filter(event => {
      // Filter by time
      const eventTime = toTimestampMs(event.timestamp || event.connected_at);
      if (eventTime && eventTime < cutoff) {
        return false;
      }

      // Filter by IP
      if (filterState.ip) {
        const ip = getVisitorIp(event) || '';
        if (!ip.toLowerCase().includes(filterState.ip.toLowerCase())) {
          return false;
        }
      }

      return true;
    });
  }

  // Build IP activity map from events
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

    // Sort events within each IP by timestamp
    for (const activity of ipActivityMap.values()) {
      activity.events.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    }
  }

  // Format timestamp for display
  function formatTimestamp(ms) {
    if (!ms) return 'Unknown';
    const d = new Date(ms);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }

  // Show modal with IP activity details
  function showIpActivityModal(ip) {
    const activity = ipActivityMap.get(ip);
    if (!activity) return;

    if (modalTitle) {
      modalTitle.textContent = `Activity for ${ip}`;
    }

    if (modalContent) {
      modalContent.innerHTML = `
        <div class="visitor-modal-summary">
          <div class="visitor-modal-stat">
            <div class="visitor-modal-stat-label">Total Visits</div>
            <div class="visitor-modal-stat-value">${activity.totalVisits || activity.events.filter(e => e.type === 'join').length}</div>
          </div>
          <div class="visitor-modal-stat">
            <div class="visitor-modal-stat-label">First Seen</div>
            <div class="visitor-modal-stat-value">${formatTimestamp(activity.firstSeen)}</div>
          </div>
          <div class="visitor-modal-stat">
            <div class="visitor-modal-stat-label">Last Activity</div>
            <div class="visitor-modal-stat-value">${formatTimestamp(activity.lastSeen)}</div>
          </div>
        </div>
        <h4 class="visitor-modal-events-title">Event History (${activity.events.length} events)</h4>
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
  }

  // Close modal
  function closeModal() {
    if (modalOverlay) {
      modalOverlay.classList.remove('active');
    }
  }

  // Setup modal event listeners
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

  // Setup filter event listeners
  function applyFilters() {
    const filtered = filterEvents(allVisitorEvents);
    renderRecentWithFilters(filtered);

    if (filterStatsEl) {
      filterStatsEl.textContent = `Showing ${filtered.length} of ${allVisitorEvents.length} events`;
    }
  }

  if (filterTimeEl) {
    filterTimeEl.addEventListener('change', (e) => {
      filterState.time = e.target.value;
      applyFilters();
    });
  }

  if (filterIpEl) {
    let debounceTimer;
    filterIpEl.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        filterState.ip = e.target.value;
        applyFilters();
      }, 150);
    });
  }

  // Render recent visitors with click handlers for IP lookup
  function renderRecentWithFilters(visits) {
    if (!recentListEl) return;
    recentListEl.innerHTML = "";

    if (!Array.isArray(visits) || visits.length === 0) {
      const li = document.createElement("li");
      li.textContent = "No matching visitors.";
      li.style.opacity = "0.8";
      recentListEl.appendChild(li);
      return;
    }

    // Show up to 50 items
    const items = visits.slice(0, 50);
    items.forEach((v) => {
      const li = document.createElement("li");
      const ip = getVisitorIp(v);
      const eventType = v.type || 'join';
      const typeIndicator = eventType === 'join' ? '→' : '←';
      li.textContent = `${typeIndicator} ${formatRecentVisit(v)}`;
      li.dataset.ip = ip;
      li.addEventListener('click', () => {
        if (ip) {
          showIpActivityModal(ip);
        }
      });
      recentListEl.appendChild(li);
    });
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
    // If API only provided a count but not a list
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

    // Store all events and build activity map
    allVisitorEvents = (recentVisits || []).map(v => ({
      ...v,
      type: v.type || 'join'
    }));
    buildIpActivityMap(allVisitorEvents);

    // Apply current filters
    const filtered = filterEvents(allVisitorEvents);
    renderRecentWithFilters(filtered);

    if (filterStatsEl) {
      filterStatsEl.textContent = `Showing ${filtered.length} of ${allVisitorEvents.length} events`;
    }
  }

  // Fetch presence events (join/leave) from the events API
  async function fetchPresenceEvents() {
    const results = [];
    const params = new URLSearchParams({
      topic: "visitor_updates",
      limit: "200",
    });

    for (const type of ["join", "leave"]) {
      params.set("type", type);
      try {
        const res = await fetch(`${BASE_URL}/events?${params}`);
        const body = await res.json();
        const events = (body.events || body.messages || []).map((e) => ({
          ...e,
          type,
          ip: e.visitor?.ip || e.ip,
          timestamp: e.timestamp || e.visitor?.connected_at,
          location: e.visitor?.location || e.location,
          userAgent: e.visitor?.userAgent || e.userAgent || e.ua,
        }));
        results.push(...events);
      } catch (err) {
        console.error(`Failed to fetch ${type} events:`, err);
      }
    }

    return results.sort((a, b) => {
      const ta = toTimestampMs(a.timestamp) || 0;
      const tb = toTimestampMs(b.timestamp) || 0;
      return tb - ta;
    });
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

      // Combine recent_visits with presence events
      const recentVisits = Array.isArray(data?.recent_visits) ? data.recent_visits : [];
      const presenceEvents = await fetchPresenceEvents();

      // Merge and deduplicate
      const allEvents = [...recentVisits, ...presenceEvents];
      const seenKeys = new Set();
      const uniqueEvents = allEvents.filter(e => {
        const ip = getVisitorIp(e) || 'unknown';
        const ts = toTimestampMs(e.timestamp || e.connected_at) || 0;
        const type = e.type || 'join';
        const key = `${ip}:${ts}:${type}`;
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      });

      // Sort by timestamp descending
      uniqueEvents.sort((a, b) => {
        const ta = toTimestampMs(a.timestamp || a.connected_at) || 0;
        const tb = toTimestampMs(b.timestamp || b.connected_at) || 0;
        return tb - ta;
      });

      renderRecent(uniqueEvents);
    } catch (err) {
      console.error("Failed to load visitors:", err);
      statsEl.textContent = "Failed to load visitors";
    }
  }

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
    if (retries >= maxRetries) {
      stopRetrying();
      return;
    }
    statsEl.textContent = `Disconnected — retry ${retries}/${maxRetries}…`;
    reconnectTimer = setTimeout(initRealtime, minDelay);
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

  function cleanup() {
    stopRetrying();
  }

  window.addEventListener("beforeunload", cleanup);
  window.addEventListener("pagehide", cleanup);

  // Initial load + subscribe
  refreshVisitors();
  initRealtime();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initVisitors);
} else {
  initVisitors();
}


