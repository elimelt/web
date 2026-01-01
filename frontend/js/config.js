// Shared configuration constants

// =============================================================================
// API Base URLs
// =============================================================================
export const BASE_URL = 'https://blink.tail8ab50a.ts.net:8443';
export const WS_BASE_URL = 'wss://blink.tail8ab50a.ts.net:8443';

// =============================================================================
// Pagination
// =============================================================================
export const PAGE_SIZE = 50;

// =============================================================================
// WebSocket Reconnection Settings
// =============================================================================
export const RECONNECT = {
  minDelay: 2000,    // Minimum delay between reconnection attempts (ms)
  maxDelay: 10000,   // Maximum delay between reconnection attempts (ms)
  maxRetries: 5      // Maximum number of reconnection attempts
};
