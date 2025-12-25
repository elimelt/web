import { getVisitors, getWsVisitors } from './api.js';

let visitorsInitialized = false;

function initVisitors() {
  if (visitorsInitialized) return;
  visitorsInitialized = true;

  const statsEl = document.getElementById("visitor-stats");
  const listEl = document.getElementById("visitor-list");
  const recentTitleEl = document.getElementById("recent-visitors-title");
  const recentListEl = document.getElementById("recent-visitor-list");
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
    recentListEl.innerHTML = "";
    if (!Array.isArray(recentVisits) || recentVisits.length === 0) {
      const li = document.createElement("li");
      li.textContent = "No recent visitors.";
      li.style.opacity = "0.8";
      recentListEl.appendChild(li);
      return;
    }
    // Deduplicate by 10-minute intervals per IP, then show up to the latest 20
    const deduped = dedupeRecentVisitsByTenMinutes(recentVisits);
    const items = deduped.slice(0, 20);
    items.forEach((v) => {
      const li = document.createElement("li");
      li.textContent = formatRecentVisit(v);
      recentListEl.appendChild(li);
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
      const recent = Array.isArray(data?.recent_visits) ? data.recent_visits : [];
      renderRecent(recent);
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


