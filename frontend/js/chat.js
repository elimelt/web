const BASE_URL = 'https://blink.tail8ab50a.ts.net:8443';
const PAGE_SIZE = 50;

function getUserColor(id) {
  if (!id) return "var(--text-secondary)";
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

function getHumanReadableDateTimeString(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
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

let ws = null;
let visitorWs = null;
const minDelay = 2000;
const maxDelay = 10000;
const maxRetries = 5;

let chatReconnectDelay = minDelay;
let chatRetries = 0;
let visitorRetries = 0;
let chatReconnectTimer = null;
let visitorReconnectTimer = null;
let chatStopped = false;
let visitorStopped = false;
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

function getWsUrl(channel) {
  return `wss://blink.tail8ab50a.ts.net:8443/ws/chat/${encodeURIComponent(
    channel
  )}`;
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
    text.textContent = msg.text;
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
    const res = await fetch(
      `${BASE_URL}/chat/${encodeURIComponent(state.channel)}/history?${params}`
    );
    const body = await res.json();
    const msgs = (body.messages || []).filter((m) => !isDuplicate(m));

    if (msgs.length === 0) {
      state.hasMoreHistory = false;
    } else {
      msgs.reverse();
      state.messages = [...msgs, ...state.messages];
      state.nextBefore = body.next_before || state.nextBefore;
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

  const results = [];
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
      }));
      results.push(...events);
    } catch (err) {
      console.error(`Failed to fetch ${type} events:`, err);
    }
  }
  return results
    .filter((e) => !isDuplicate(e))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
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
  chatStopped = true;
  if (chatReconnectTimer) {
    clearTimeout(chatReconnectTimer);
    chatReconnectTimer = null;
  }
  if (ws) {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  setConnection("failed - click retry", true);
}

function connectChat() {
  if (chatStopped) return;

  if (chatReconnectTimer) {
    clearTimeout(chatReconnectTimer);
    chatReconnectTimer = null;
  }

  if (ws) {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    ws.close();
    ws = null;
  }

  if (chatRetries >= maxRetries) {
    stopChat();
    return;
  }

  const url = getWsUrl(state.channel);
  setConnection("connecting");
  ws = new WebSocket(url);

  ws.onopen = () => {
    if (chatStopped) return;
    setConnection("open");
    chatRetries = 0;
    chatReconnectDelay = minDelay;
    while (state.unsentQueue.length > 0) {
      ws.send(JSON.stringify({ text: state.unsentQueue.shift() }));
    }
  };

  ws.onmessage = async (evt) => {
    if (chatStopped) return;
    let data;
    try {
      let text = evt.data;
      if (evt.data instanceof Blob) {
        text = await evt.data.text();
      }
      data = JSON.parse(text);
    } catch {
      return;
    }
    if (data.type === "ping") return;
    if (data.type === "chat_message" && data.channel === state.channel) {
      if (!isDuplicate(data)) {
        state.messages.push(data);
        renderMessageAtBottom(data);
      }
    }
  };

  ws.onerror = () => {
    if (chatStopped) return;
    setConnection("error");
  };

  ws.onclose = () => {
    if (chatStopped) return;
    chatRetries++;
    if (chatRetries >= maxRetries) {
      stopChat();
      return;
    }
    setConnection(`closed (retry ${chatRetries}/${maxRetries})`);
    chatReconnectTimer = setTimeout(connectChat, chatReconnectDelay);
    chatReconnectDelay = Math.min(chatReconnectDelay * 2, maxDelay);
  };
}

function stopVisitors() {
  visitorStopped = true;
  if (visitorReconnectTimer) {
    clearTimeout(visitorReconnectTimer);
    visitorReconnectTimer = null;
  }
  if (visitorWs) {
    visitorWs.onopen = null;
    visitorWs.onmessage = null;
    visitorWs.onerror = null;
    visitorWs.onclose = null;
    visitorWs.close();
    visitorWs = null;
  }
}

function connectVisitors() {
  if (visitorStopped) return;

  if (visitorReconnectTimer) {
    clearTimeout(visitorReconnectTimer);
    visitorReconnectTimer = null;
  }

  if (visitorWs) {
    visitorWs.onopen = null;
    visitorWs.onmessage = null;
    visitorWs.onerror = null;
    visitorWs.onclose = null;
    visitorWs.close();
    visitorWs = null;
  }

  if (visitorRetries >= maxRetries) {
    stopVisitors();
    return;
  }

  visitorWs = new WebSocket("wss://blink.tail8ab50a.ts.net:8443/ws/visitors");

  visitorWs.onopen = () => {
    if (visitorStopped) return;
    visitorRetries = 0;
  };

  visitorWs.onmessage = async (evt) => {
    if (visitorStopped) return;
    let data;
    try {
      let text = evt.data;
      if (evt.data instanceof Blob) {
        text = await evt.data.text();
      }
      data = JSON.parse(text);
    } catch {
      return;
    }
    if (data.type === "ping") return;
    if (data.type === "join" || data.type === "leave") {
      const event = {
        ...data,
        ip: data.visitor?.ip || data.ip,
        timestamp:
          data.timestamp ||
          data.visitor?.connected_at ||
          new Date().toISOString(),
      };
      if (!isDuplicate(event)) {
        state.messages.push(event);
        renderMessageAtBottom(event);
      }
    }
  };

  visitorWs.onerror = () => {
    if (visitorStopped) return;
  };

  visitorWs.onclose = () => {
    if (visitorStopped) return;
    visitorRetries++;
    if (visitorRetries >= maxRetries) {
      stopVisitors();
      return;
    }
    visitorReconnectTimer = setTimeout(connectVisitors, minDelay);
  };
}

function sendMessage(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return;
  if (state.connection === "open" && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ text: trimmed }));
  } else {
    state.unsentQueue.push(trimmed);
  }
}

function retryConnections() {
  chatStopped = false;
  visitorStopped = false;
  chatRetries = 0;
  chatReconnectDelay = minDelay;
  visitorRetries = 0;
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
  presenceEvents.forEach((e) => renderMessageAtBottom(e, false));
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

