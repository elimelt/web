declare module '*?worker&url' {
  const url: string;
  export default url;
}

/** Set at build time from the LIVE_FEATURES environment variable (astro.config.mjs). */
declare const __LIVE_FEATURES__: boolean;
