export function createVisitorMap(onSelectVisitor) {
  const host = document.getElementById('visitor-map');
  const summary = document.getElementById('visitor-map-summary');
  const gl = window.maplibregl;
  let map;
  try {
    map = new gl.Map({
      container: host,
      center: [-40, 24], zoom: 0.8, minZoom: 0, maxZoom: 19,
      style: {
        version: 8,
        projection: { type: 'globe' },
        sources: {
          streets: {
            type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256, maxzoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          },
        },
        layers: [{ id: 'streets', type: 'raster', source: 'streets', paint: { 'raster-saturation': -1 } }],
      },
    });
  } catch {
    host.textContent = 'Globe unavailable. Switch to List to explore visitors.';
    return { update() { } };
  }
  map.addControl(new gl.NavigationControl({ showCompass: true }), 'bottom-left');
  let visits = [];
  let markers = [];
  let popup = null;
  let missing = 0;
  function details(group, coordinates) {
    popup?.remove();
    const content = document.createElement('div');
    content.className = 'visitor-map-popup';
    const title = document.createElement('strong');
    title.textContent = [...new Set(group.map(v => [v.location.city, v.location.country].filter(Boolean).join(', ') || 'Unknown location'))].join(' | ');
    const zoom = document.createElement('button');
    zoom.type = 'button';
    zoom.className = 'visitor-street-zoom';
    zoom.innerHTML = '<svg width="18" height="18" aria-hidden="true"><use href="#icon-eye"></use></svg>';
    zoom.setAttribute('aria-label', 'Explore streets here');
    zoom.title = 'Explore streets here';
    zoom.addEventListener('click', () => {
      popup?.remove();
      map.flyTo({ center: coordinates, zoom: 16, essential: false });
    });
    const hint = document.createElement('p');
    hint.textContent = 'Approximate IP location, not a visitor’s address.';
    const list = document.createElement('ul');
    for (const visit of group) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      const ip = visit.ip || visit.address || visit.id;
      button.type = 'button';
      button.textContent = ip || 'Unknown visitor';
      button.disabled = !ip;
      button.addEventListener('click', () => onSelectVisitor(ip));
      const time = document.createElement('div');
      const date = new Date(visit.timestamp || visit.connected_at);
      time.textContent = Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString();
      item.append(button, time);
      list.append(item);
    }
    content.append(title, zoom, hint, list);
    popup = new gl.Popup({ maxWidth: '300px' }).setLngLat(coordinates).setDOMContent(content).addTo(map);
  }
  function draw() {
    markers.forEach(marker => marker.remove());
    markers = [];
    const groups = new Map();
    // Split geographic clusters as the user approaches street level.
    const step = 360 / 2 ** (map.getZoom() + 4);
    for (const visit of visits) {
      const { lat, lon } = visit.location;
      const key = `${Math.floor((lat + 90) / step)}:${Math.floor((lon + 180) / step)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(visit);
    }
    for (const group of groups.values()) {
      const coordinates = [
        group.reduce((n, v) => n + v.location.lon, 0) / group.length,
        group.reduce((n, v) => n + v.location.lat, 0) / group.length,
      ];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'world-visitor-marker';
      button.textContent = group.length;
      button.setAttribute('aria-label', `${group.length} visits near ${group[0].location.city || group[0].location.country || 'unknown location'}`);
      button.addEventListener('click', event => { event.stopPropagation(); details(group, coordinates); });
      markers.push(new gl.Marker({ element: button }).setLngLat(coordinates).addTo(map));
    }
    summary.textContent = `${visits.length} mapped visits | ${missing} without coordinates`;
  }
  map.on('zoomend', draw);
  const observer = new ResizeObserver(() => { if (host.clientWidth && host.clientHeight) map.resize(); });
  observer.observe(host);
  document.getElementById('visitor-map-reset').addEventListener('click', () => {
    popup?.remove();
    map.flyTo({ center: [-40, 24], zoom: 0.8, pitch: 0, bearing: 0, essential: false });
  });
  map.on('error', () => {
    summary.textContent = 'Some map details could not load. Visitor details remain available in List.';
  });
  window.addEventListener('pagehide', () => { observer.disconnect(); map.remove(); }, { once: true });
  return {
    update(events) {
      const arrivals = events.filter(v => !v.type || v.type === 'join');
      visits = arrivals.filter(v => v.location && Number.isFinite(v.location.lat)
        && Number.isFinite(v.location.lon) && Math.abs(v.location.lat) <= 90 && Math.abs(v.location.lon) <= 180);
      missing = arrivals.length - visits.length;
      popup?.remove();
      draw();
    },
  };
}
