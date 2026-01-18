import { BASE_URL, WS_BASE_URL } from './config.js';

const fetchJson = (endpoint) =>
  fetch(`${BASE_URL}${endpoint}`)
    .then((response) => response.json())
    .catch((error) => {
      console.error(`Error fetching api ${endpoint}:`, error);
      return error;
    });

const getSystem = () => fetchJson('/system');

const getVisitors = () => fetchJson('/visitors');

const getEvents = (params) => fetchJson(`/events?${params}`);

const getVisitorsAnalytics = () => fetchJson('/visitor-analytics');

const getChatHistory = (channel, params) => fetchJson(`/chat/${encodeURIComponent(channel)}/history?${params}`);

let __sharedVisitorsWs = null;
function __setSharedVisitorsWs(ws) {
  __sharedVisitorsWs = ws;
  console.debug('[analytics] Setting shared visitors WS');
  try {
    AnalyticsDelivery.attachWebSocket(ws);
  } catch (err) {
    console.warn('[analytics] Failed to attach WebSocket:', err);
  }
}
export function getSharedVisitorsWebSocket() {
  return __sharedVisitorsWs;
}

const AnalyticsDelivery = (() => {
  const STORAGE_KEY = 'analytics_click_queue_v1';
  const MAX_STORED_EVENTS = 500;
  const FLUSH_CHUNK_SIZE = 50;
  const FLUSH_INTERVAL_MS = 4000;
  let inMemoryQueue = [];
  let wsRef = null;
  let flushTimerId = null;
  let initialized = false;
  let sequenceCounter = 0;
  let pageSessionId = null;

  function loadQueue() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    } catch {}
    return [];
  }

  function saveQueue(queue) {
    try {
      const trimmed =
        queue.length > MAX_STORED_EVENTS
          ? queue.slice(queue.length - MAX_STORED_EVENTS)
          : queue;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch {}
  }

  function getQueue() {
    if (inMemoryQueue.length === 0) {
      inMemoryQueue = loadQueue();
    }
    return inMemoryQueue;
  }

  function persist() {
    saveQueue(inMemoryQueue);
  }

  function isWsOpen() {
    return wsRef && wsRef.readyState === WebSocket.OPEN;
  }

  function trySendBatchOverWs(events) {
    if (!isWsOpen()) {
      console.debug('[analytics] WS not open, skipping batch send');
      return false;
    }
    try {
      const msg = {
        type: 'analytics.batch',
        payload: {
          topic: 'clicks',
          events
        }
      };
      wsRef.send(JSON.stringify(msg));
      console.debug('[analytics] Sent batch of', events.length, 'click events');
      return true;
    } catch (err) {
      console.warn('[analytics] WS send failed, will retry later:', err);
      return false;
    }
  }

  function scheduleFlush() {
    if (flushTimerId != null) return;
    flushTimerId = setInterval(flushIfPossible, FLUSH_INTERVAL_MS);
  }

  function cancelFlushTimer() {
    if (flushTimerId != null) {
      clearInterval(flushTimerId);
      flushTimerId = null;
    }
  }

  function flushIfPossible() {
    if (!isWsOpen()) return;
    const queue = getQueue();
    if (queue.length === 0) return;
    const toSend = queue.slice(0, FLUSH_CHUNK_SIZE);
    const ok = trySendBatchOverWs(toSend);
    if (ok) {
      inMemoryQueue = queue.slice(toSend.length);
      persist();
      if (inMemoryQueue.length > 0) {
        Promise.resolve().then(flushIfPossible);
      }
    }
  }

  function getOrCreatePageSessionId() {
    if (pageSessionId) return pageSessionId;
    try {
      pageSessionId = sessionStorage.getItem('page_session_id');
      if (!pageSessionId) {
        pageSessionId = Math.random().toString(36).slice(2) + Date.now().toString(36);
        sessionStorage.setItem('page_session_id', pageSessionId);
      }
    } catch {
      pageSessionId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
    return pageSessionId;
  }

  function augment(event) {
    const nowMs = Date.now();
    const sid = getOrCreatePageSessionId();
    return {
      type: 'click',
      ts: nowMs,
      seq: ++sequenceCounter,
      session: { pageId: sid },
      page: {
        url: location.href,
        path: location.pathname,
        title: document.title
      },
      ...event
    };
  }

  function enqueueClick(rawEvent) {
    const ev = augment(rawEvent);
    const queue = getQueue();
    queue.push(ev);
    persist();
    console.debug('[analytics] Click enqueued, queue size:', queue.length, 'wsOpen:', isWsOpen());
    flushIfPossible();
  }

  function attachWebSocket(ws) {
    if (!ws) return;
    console.debug('[analytics] Attaching WebSocket, readyState:', ws.readyState);
    wsRef = ws;
    if (isWsOpen()) {
      console.debug('[analytics] WS already open, flushing immediately');
      flushIfPossible();
    }
    try {
      ws.addEventListener('open', () => {
        console.debug('[analytics] WS opened, flushing');
        flushIfPossible();
      }, { once: true });
      ws.addEventListener('close', () => {
        console.debug('[analytics] WS closed');
      });
      ws.addEventListener('error', (e) => {
        console.debug('[analytics] WS error:', e);
      });
    } catch {}
    scheduleFlush();
  }

  function beaconFlush() {
    const queue = getQueue();
    if (queue.length === 0) return;
    try {
      const payload = { events: queue, topic: 'clicks' };
      const blob = new Blob([JSON.stringify(payload)], {
        type: 'application/json'
      });
      const ok = navigator.sendBeacon(`${BASE_URL}/analytics/clicks`, blob);
      if (ok) {
        inMemoryQueue = [];
        persist();
      }
    } catch {
    }
  }

  function initLifecycleHooks() {
    if (initialized) return;
    initialized = true;
    scheduleFlush();
    const onHide = () => beaconFlush();
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') beaconFlush();
    });
    window.addEventListener('online', flushIfPossible);
  }

  return {
    init: initLifecycleHooks,
    enqueueClick,
    attachWebSocket,
    flushIfPossible
  };
})();

export function initAnalyticsDelivery() {
  AnalyticsDelivery.init();
}

export function recordClickEvent(clickPayload) {
  AnalyticsDelivery.enqueueClick(clickPayload);
}

const getWsVisitors = (callbacks = {}) => {
  const ws = new WebSocket(`${WS_BASE_URL}/ws/visitors`);

  const {
    onConnect = () => {},
    onVisitorJoin = (_visitor) => {},
    onVisitorLeave = (_ip) => {},
    onUpdate = (_data) => {},
    onError = (error) => console.error('WebSocket error:', error),
    onDisconnect = () => {},
  } = callbacks;

  ws.onopen = onConnect;

  ws.onmessage = async (event) => {
    try {
      let text = event.data;
      if (event.data instanceof Blob) {
        text = await event.data.text();
      }
      const data = JSON.parse(text);

      if (data.type === 'ping') {
        ws.send('pong');
      } else if (data.type === 'join') {
        onVisitorJoin(data.visitor);
        onUpdate(data);
      } else if (data.type === 'leave') {
        onVisitorLeave(data.ip);
        onUpdate(data);
      } else {
        onUpdate(data);
      }
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  };

  ws.onerror = onError;

  ws.onclose = onDisconnect;

  try {
    __setSharedVisitorsWs(ws);
  } catch {}

  return {
    ws,
    close: () => ws.close(),
    send: (data) => ws.send(JSON.stringify(data)),
  };
};
export { getSystem, getVisitors, getEvents, getVisitorsAnalytics, getChatHistory, getWsVisitors };
