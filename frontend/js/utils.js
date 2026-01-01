/**
 * Shared utility functions for the frontend modules.
 * @module utils
 */

/**
 * Formats a timestamp into a human-readable date/time string.
 * @param {number|string|Date} timestamp - The timestamp to format (ms, ISO string, or Date)
 * @returns {string} Formatted string like "Jan 1, 2024, 3:45 PM"
 */
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

/**
 * Generates a consistent HSL color based on a string identifier.
 * Uses a hash function to produce the same color for the same ID.
 * @param {string} id - The identifier to generate a color for
 * @returns {string} CSS color value (HSL or CSS variable)
 */
export function getUserColor(id) {
  if (!id) return "var(--text-secondary)";
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

/**
 * Parses a WebSocket message that could be either a Blob or a string.
 * Handles the common pattern of receiving data that may need text extraction.
 * @param {Blob|string} data - The raw message data from WebSocket event
 * @returns {Promise<Object|null>} Parsed JSON object, or null if parsing fails
 */
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

/**
 * Normalizes various timestamp formats to milliseconds.
 * Handles numbers (seconds or ms), ISO strings, and Date objects.
 * @param {number|string|Date|null} value - The timestamp value to normalize
 * @returns {number|null} Timestamp in milliseconds, or null if invalid
 */
export function toTimestampMs(value) {
  if (value == null) return null;
  if (typeof value === "number") {
    // Assume values < 1e12 are in seconds, otherwise milliseconds
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

/**
 * Creates a debounced version of a function that delays execution
 * until after the specified wait time has elapsed since the last call.
 * @param {Function} fn - The function to debounce
 * @param {number} wait - The delay in milliseconds
 * @returns {Function} Debounced function with a cancel() method
 */
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

