import { getVisitors, getWsVisitors } from './api.js';

let visitorsInitialized = false;

function initVisitors() {
  if (visitorsInitialized) return;
  visitorsInitialized = true;

  const statsEl = document.getElementById("visitor-stats");
  const listEl = document.getElementById("visitor-list");
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

  async function refreshVisitors() {
    try {
      const data = await getVisitors();
      const visitors = normalizeVisitors(data);
      render(visitors, visitors.length);
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


