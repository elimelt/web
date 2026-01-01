import { BASE_URL, WS_BASE_URL } from './config.js';

/**
 * SCHEMAS (for backend reference)
 *
 * ClickEvent:
 * {
 *   type: "click",
 *   ts: number,                // ms since epoch at the time of click
 *   seq: number,               // per-page, monotonically increasing
 *   session: { pageId: string },
 *   page: {
 *     url: string,
 *     path: string,
 *     title: string
 *   },
 *   viewport: {
 *     width: number,
 *     height: number,
 *     scrollX: number,
 *     scrollY: number,
 *     dpr: number
 *   },
 *   pointer: {
 *     x: number|null,          // clientX
 *     y: number|null,          // clientY
 *     pageX: number|null,
 *     pageY: number|null,
 *     button: number|null,     // 0=primary, 1=middle, 2=secondary
 *     buttons: number|null,
 *     pointerType: "mouse"|"pen"|"touch"|string,
 *     altKey: boolean,
 *     ctrlKey: boolean,
 *     metaKey: boolean,
 *     shiftKey: boolean
 *   },
 *   element: {
 *     tag: string,             // e.g. "a", "button"
 *     id: string,
 *     classes: string,         // space-separated class names
 *     role: string,
 *     name: string,
 *     ariaLabel: string,
 *     text: string,            // trimmed, <=120 chars
 *     analytics: {
 *       id: string,            // from data-analytics-id on closest labeled ancestor
 *       label: string,         // from data-analytics-label
 *       group: string,         // from data-analytics-group
 *       type: string           // from data-analytics
 *     },
 *     domPath: string,         // short path like "a#link.primary > span"
 *     rect: {
 *       x: number,
 *       y: number,
 *       width: number,
 *       height: number
 *     }
 *   }
 * }
 *
 * WebSocket outbound (piggyback on /ws/visitors):
 * {
 *   type: "analytics.batch",
 *   payload: {
 *     topic: "clicks",
 *     events: ClickEvent[]
 *   }
 * }
 *
 * HTTP beacon fallback:
 * POST ${BASE_URL}/analytics/clicks
 * Body: {
 *   topic: "clicks",
 *   events: ClickEvent[]
 * }
 */

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

// -----------------------------------------------------------------------------
// Shared/Reusable WebSocket reference
// -----------------------------------------------------------------------------
let __sharedVisitorsWs = null;
function __setSharedVisitorsWs(ws) {
  __sharedVisitorsWs = ws;
  // Let analytics try to flush when WS becomes available
  try {
    AnalyticsDelivery.attachWebSocket(ws);
  } catch (err) {
    // Avoid hard dependency ordering issues
  }
}
export function getSharedVisitorsWebSocket() {
  return __sharedVisitorsWs;
}

// -----------------------------------------------------------------------------
// Reliable Analytics Delivery (clicks)
//  - Reuses existing visitors WS when available
//  - Queues events (memory + localStorage) if WS not open
//  - Flushes via sendBeacon on pagehide/visibilitychange/beforeunload
// -----------------------------------------------------------------------------
const AnalyticsDelivery = (() => {
  const STORAGE_KEY = 'analytics_click_queue_v1';
  const MAX_STORED_EVENTS = 500;
  const FLUSH_CHUNK_SIZE = 50;
  const FLUSH_INTERVAL_MS = 4000;
  /** @type {Array<Object>} */
  let inMemoryQueue = [];
  /** @type {WebSocket|null} */
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
      // Cap stored size to avoid unbounded growth
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
    if (!isWsOpen()) return false;
    try {
      const msg = {
        type: 'analytics.batch',
        payload: {
          topic: 'clicks',
          events
        }
      };
      wsRef.send(JSON.stringify(msg));
      return true;
    } catch (err) {
      console.warn('WS send failed, will retry later:', err);
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
    // Send in chunks to avoid huge payloads
    const toSend = queue.slice(0, FLUSH_CHUNK_SIZE);
    const ok = trySendBatchOverWs(toSend);
    if (ok) {
      inMemoryQueue = queue.slice(toSend.length);
      persist();
      // If there are more, keep flushing within this turn
      if (inMemoryQueue.length > 0) {
        // Use microtask to avoid blocking
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
      // Fallback if sessionStorage unavailable
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
    // Opportunistic flush
    flushIfPossible();
  }

  function attachWebSocket(ws) {
    if (!ws) return;
    wsRef = ws;
    // Flush ASAP if the socket is already open
    if (isWsOpen()) {
      flushIfPossible();
    }
    try {
      ws.addEventListener('open', flushIfPossible, { once: true });
      ws.addEventListener('close', () => {
        // keep queue, attempts will resume when re-opened
      });
      ws.addEventListener('error', () => {
        // keep queue; beacon/pagehide will ensure eventual delivery
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
      // If beacon fails, we keep the queue for next time
    }
  }

  function initLifecycleHooks() {
    if (initialized) return;
    initialized = true;
    // Attempt periodic flushes even if no WS yet (once it appears, attachWebSocket will flush)
    scheduleFlush();
    // Ensure delivery on page transitions
    const onHide = () => beaconFlush();
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') beaconFlush();
    });
    // Network changes can help flushing soon after reconnection
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
  // clickPayload is expected to have { viewport, pointer, element } etc.
  console.log('recordClickEvent', clickPayload);
  AnalyticsDelivery.enqueueClick(clickPayload);
}

// -----------------------------------------------------------------------------
// Existing Visitors WS setup (extended to expose shared socket)
// -----------------------------------------------------------------------------
const getWsVisitors = (callbacks = {}) => {
  const ws = new WebSocket(`${WS_BASE_URL}/ws/visitors`);

  const {
    onConnect = () => console.log('Connected to visitor tracking'),
    onVisitorJoin = (visitor) => console.log('Visitor joined:', visitor),
    onVisitorLeave = (ip) => console.log('Visitor left:', ip),
    onUpdate = (data) => console.log('Update:', data),
    onError = (error) => console.error('WebSocket error:', error),
    onDisconnect = () => console.log('Disconnected from visitor tracking'),
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

  // Expose shared socket for other modules (e.g., analytics delivery)
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
