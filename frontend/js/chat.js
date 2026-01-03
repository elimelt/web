import { getEvents, getChatHistory } from './api.js';
import { WS_BASE_URL, PAGE_SIZE, RECONNECT } from './config.js';
import { getHumanReadableDateTimeString, getUserColor, parseWebSocketMessage } from './utils.js';
import { marked } from 'https://cdn.jsdelivr.net/npm/marked@15.0.0/+esm';

marked.setOptions({
  breaks: true,
  gfm: true,
});

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderMarkdown(text) {
  const escaped = escapeHtml(text);
  const restored = escaped
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
  return marked.parse(restored);
}

class ConnectionState {
  constructor() {
    this.ws = null;
    this.retries = 0;
    this.reconnectDelay = RECONNECT.minDelay;
    this.reconnectTimer = null;
    this.stopped = false;
  }

  reset() {
    this.retries = 0;
    this.reconnectDelay = RECONNECT.minDelay;
  }

  clearTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  closeWebSocket() {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  stop() {
    this.stopped = true;
    this.clearTimer();
    this.closeWebSocket();
  }

  scheduleReconnect(connectFn) {
    this.reconnectTimer = setTimeout(connectFn, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT.maxDelay);
  }
}

const state = {
  connection: "closed",
  channel: "general",
  messages: [],
  inputText: "",
  unsentQueue: [],
  reconnectAttempts: 0,
  nextBefore: null,
  isLoadingHistory: false,
  hasMoreHistory: true,
  seenKeys: new Set(),
};

const chatConn = new ConnectionState();
const visitorConn = new ConnectionState();

const lastPresenceByIp = new Map();

let chatInitialized = false;

function getMessageKey(msg) {
  const id = msg.visitor?.ip || msg.ip || msg.sender || "";
  const content = msg.text || msg.type || "";
  return `${msg.timestamp}|${id}|${content}`;
}

function isDuplicate(msg) {
  const key = getMessageKey(msg);
  if (state.seenKeys.has(key)) return true;
  state.seenKeys.add(key);
  return false;
}

function isRedundantPresence(event) {
  const isPresence = event.type === "join" || event.type === "leave";
  if (!isPresence) {
    lastPresenceByIp.clear();
    return false;
  }

  const ip = event.visitor?.ip || event.ip || "unknown";
  const lastType = lastPresenceByIp.get(ip);

  if (lastType === event.type) {
    return true;
  }

  lastPresenceByIp.set(ip, event.type);
  return false;
}

function getWsUrl(channel) {
  return `${WS_BASE_URL}/ws/chat/${encodeURIComponent(channel)}`;
}

function setConnection(status, showRetry = false) {
  state.connection = status;
  const statusEl = document.getElementById("chat-status");
  const sendBtn = document.getElementById("chat-send-btn");
  const retryBtn = document.getElementById("chat-retry-btn");
  if (statusEl) statusEl.textContent = status;
  if (sendBtn) sendBtn.disabled = status !== "open";
  if (retryBtn) retryBtn.style.display = showRetry ? "inline-block" : "none";
}

function setLoading(loading) {
  state.isLoadingHistory = loading;
  const loader = document.getElementById("chat-loader");
  if (loader) loader.style.display = loading ? "block" : "none";
}

function createMessageElement(msg) {
  const item = document.createElement("div");
  const isPresence = msg.type === "join" || msg.type === "leave";
  item.className = isPresence ? "chat-event" : "chat-msg";

  if (isPresence) {
    const ip = msg.visitor?.ip || msg.ip || "unknown";
    const action = msg.type === "join" ? "connected" : "disconnected";
    const time = getHumanReadableDateTimeString(
      msg.timestamp || msg.visitor?.connected_at || Date.now()
    );
    item.innerHTML = `<span style="color:${getUserColor(
      ip
    )}">${ip}</span> ${action} • ${time}`;
  } else {
    const sender = msg.sender ?? "unknown";
    const meta = document.createElement("div");
    meta.className = "chat-meta";
    meta.innerHTML = `<span style="color:${getUserColor(
      sender
    )}">${sender}</span> • ${getHumanReadableDateTimeString(
      msg.timestamp ?? Date.now()
    )}`;
    const text = document.createElement("div");
    text.className = "chat-text";
    text.innerHTML = renderMarkdown(msg.text || '');
    item.appendChild(meta);
    item.appendChild(text);
  }
  return item;
}

function renderMessageAtBottom(msg, autoScroll = true) {
  const msgsEl = document.getElementById("chat-messages");
  if (!msgsEl) return;
  const item = createMessageElement(msg);
  msgsEl.appendChild(item);
  if (autoScroll) msgsEl.scrollTop = msgsEl.scrollHeight;
}

function renderMessagesAtTop(messages) {
  const msgsEl = document.getElementById("chat-messages");
  if (!msgsEl) return;
  const prevScrollHeight = msgsEl.scrollHeight;
  const fragment = document.createDocumentFragment();
  messages.forEach((msg) => fragment.appendChild(createMessageElement(msg)));
  msgsEl.insertBefore(fragment, msgsEl.firstChild);
  msgsEl.scrollTop = msgsEl.scrollHeight - prevScrollHeight;
}

async function fetchHistory(initial = false) {
  if (state.isLoadingHistory || (!initial && !state.hasMoreHistory)) return;
  setLoading(true);

  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (state.nextBefore && !initial) params.set("before", state.nextBefore);

  try {
    const res = await getChatHistory(state.channel, params);

    const msgs = (res.messages || []).filter((m) => !isDuplicate(m));

    if (msgs.length === 0) {
      state.hasMoreHistory = false;
    } else {
      msgs.reverse();
      state.messages = [...msgs, ...state.messages];
      state.nextBefore = res.next_before || state.nextBefore;
      renderMessagesAtTop(msgs);
    }
  } catch (err) {
    console.error("Failed to fetch history:", err);
  } finally {
    setLoading(false);
  }
}

async function fetchPresenceEvents(before) {
  const params = new URLSearchParams({
    topic: "visitor_updates",
    limit: "100",
  });
  if (before) params.set("before", before);

  try {
    const events = (await getEvents(params)).events.map((e) => ({
      ...e,
      type: e.type,
      ip: e.payload?.visitor?.ip || e.payload?.ip || e.visitor?.ip || e.ip,
      timestamp: e.timestamp || e.payload?.visitor?.connected_at || e.visitor?.connected_at,
    }));
    return events
      .filter((e) => !isDuplicate(e))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  } catch (err) {
    console.error("Failed to fetch presence events:", err);
    return [];
  }
}

function handleScroll() {
  const msgsEl = document.getElementById("chat-messages");
  if (!msgsEl) return;
  if (
    msgsEl.scrollTop < 50 &&
    !state.isLoadingHistory &&
    state.hasMoreHistory
  ) {
    fetchHistory();
  }
}

function stopChat() {
  chatConn.stop();
  setConnection("failed - click retry", true);
}

function stopVisitors() {
  visitorConn.stop();
}

function connectChat() {
  if (chatConn.stopped) return;

  chatConn.clearTimer();
  chatConn.closeWebSocket();

  if (chatConn.retries >= RECONNECT.maxRetries) {
    stopChat();
    return;
  }

  const url = getWsUrl(state.channel);
  setConnection("connecting");
  chatConn.ws = new WebSocket(url);

  chatConn.ws.onopen = () => {
    if (chatConn.stopped) return;
    setConnection("open");
    chatConn.reset();
    while (state.unsentQueue.length > 0) {
      chatConn.ws.send(JSON.stringify({ text: state.unsentQueue.shift() }));
    }
  };

  chatConn.ws.onmessage = async (evt) => {
    if (chatConn.stopped) return;
    const data = await parseWebSocketMessage(evt.data);
    if (!data || data.type === "ping") return;
    if (data.type === "chat_message" && data.channel === state.channel) {
      if (!isDuplicate(data)) {
        lastPresenceByIp.clear();
        state.messages.push(data);
        renderMessageAtBottom(data);
      }
    }
  };

  chatConn.ws.onerror = () => {
    if (chatConn.stopped) return;
    setConnection("error");
  };

  chatConn.ws.onclose = () => {
    if (chatConn.stopped) return;
    chatConn.retries++;
    if (chatConn.retries >= RECONNECT.maxRetries) {
      stopChat();
      return;
    }
    setConnection(`closed (retry ${chatConn.retries}/${RECONNECT.maxRetries})`);
    chatConn.scheduleReconnect(connectChat);
  };
}

function connectVisitors() {
  if (visitorConn.stopped) return;

  visitorConn.clearTimer();
  visitorConn.closeWebSocket();

  if (visitorConn.retries >= RECONNECT.maxRetries) {
    stopVisitors();
    return;
  }

  visitorConn.ws = new WebSocket(`${WS_BASE_URL}/ws/visitors`);

  visitorConn.ws.onopen = () => {
    if (visitorConn.stopped) return;
    visitorConn.reset();
  };

  visitorConn.ws.onmessage = async (evt) => {
    if (visitorConn.stopped) return;
    const data = await parseWebSocketMessage(evt.data);
    if (!data || data.type === "ping") return;
    if (data.type === "join" || data.type === "leave") {
      const event = {
        ...data,
        ip: data.payload?.visitor?.ip || data.payload?.ip || data.visitor?.ip || data.ip,
        timestamp:
          data.timestamp ||
          data.visitor?.connected_at ||
          new Date().toISOString(),
      };
      if (!isDuplicate(event) && !isRedundantPresence(event)) {
        state.messages.push(event);
        renderMessageAtBottom(event);
      }
    }
  };

  visitorConn.ws.onerror = () => {
    if (visitorConn.stopped) return;
  };

  visitorConn.ws.onclose = () => {
    if (visitorConn.stopped) return;
    visitorConn.retries++;
    if (visitorConn.retries >= RECONNECT.maxRetries) {
      stopVisitors();
      return;
    }
    visitorConn.scheduleReconnect(connectVisitors);
  };
}

function sendMessage(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return;
  if (state.connection === "open" && chatConn.ws?.readyState === WebSocket.OPEN) {
    chatConn.ws.send(JSON.stringify({ text: trimmed }));
  } else {
    state.unsentQueue.push(trimmed);
  }
}

function retryConnections() {
  chatConn.stopped = false;
  visitorConn.stopped = false;
  chatConn.reset();
  visitorConn.reset();
  connectChat();
  connectVisitors();
}

function cleanup() {
  stopChat();
  stopVisitors();
}

async function initChat() {
  if (chatInitialized) return;
  chatInitialized = true;

  const formEl = document.getElementById("chat-form");
  const inputEl = document.getElementById("chat-input");
  const msgsEl = document.getElementById("chat-messages");
  const retryBtn = document.getElementById("chat-retry-btn");

  if (!formEl || !inputEl || !msgsEl) {
    chatInitialized = false;
    return;
  }

  window.addEventListener("beforeunload", cleanup);
  window.addEventListener("pagehide", cleanup);

  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage(inputEl.value);
    inputEl.value = "";
    state.inputText = "";
  });

  inputEl.addEventListener("input", (e) => {
    state.inputText = e.target.value;
  });

  if (retryBtn) {
    retryBtn.addEventListener("click", retryConnections);
  }

  msgsEl.addEventListener("scroll", handleScroll);

  await fetchHistory(true);
  const presenceEvents = await fetchPresenceEvents();

  const allItems = [...state.messages, ...presenceEvents];
  allItems.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  msgsEl.innerHTML = "";
  lastPresenceByIp.clear();
  for (const item of allItems) {
    if (!isRedundantPresence(item)) {
      msgsEl.appendChild(createMessageElement(item));
    }
  }
  msgsEl.scrollTop = msgsEl.scrollHeight;

  connectChat();
  connectVisitors();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initChat);
} else {
  initChat();
}

export { state, sendMessage, connectChat as connect };
