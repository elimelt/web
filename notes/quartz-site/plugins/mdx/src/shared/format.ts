// Small formatting helpers shared by the figures' render.ts files. They run at
// build time and in the browser, so they must not touch the DOM.

/** Escapes text for an HTML attribute or element body. */
export const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A fixed-point number with a real minus sign (U+2212) instead of a hyphen. */
export const num = (value: number, digits: number): string => value.toFixed(digits).replace("-", "−");
