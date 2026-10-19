export function getHumanReadableDateTimeString(timestamp) {
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

export function getUserColor(id) {
  if (!id) return "var(--text-secondary)";
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  // Blend each stable identity hue toward the active theme's text color. This
  // keeps identities distinct without producing low-contrast midtones.
  return `color-mix(in srgb, hsl(${hue}, 80%, 50%) 35%, var(--text))`;
}

export async function parseWebSocketMessage(data) {
  try {
    let text = data;
    if (data instanceof Blob) {
      text = await data.text();
    }
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function toTimestampMs(value) {
  if (value == null) return null;
  if (typeof value === "number") {
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

export function debounce(fn, wait) {
  let timer = null;

  function debounced(...args) {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      fn.apply(this, args);
    }, wait);
  }

  debounced.cancel = function () {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return debounced;
}


// Visitors are identified by an opaque 16-char hex id from the API. Show a short
// friendly label instead of the raw id; other identities (e.g. "agent:codex")
// are shown as-is.
export function visitorLabel(id) {
  if (typeof id === 'string' && /^[0-9a-f]{16}$/.test(id)) return `Visitor ${id.slice(0, 6)}`;
  return id;
}
