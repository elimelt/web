interface Window {
  L: typeof import('leaflet');
}

declare module '*?worker&url' {
  const url: string;
  export default url;
}
