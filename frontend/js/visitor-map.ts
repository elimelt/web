export function createVisitorMap(onSelectVisitor) {
  const host = (document.getElementById('visitor-map') as HTMLDivElement);
  const summary = document.getElementById('visitor-map-summary');
  if (!host || !window.L) {
    if (summary) summary.textContent = 'Map unavailable. Use the list to explore visitors.';
    return { update() { } };
  }
  const L = window.L;
  const map = L.map(host, {
    scrollWheelZoom: false, minZoom: 1, maxZoom: 12,
    worldCopyJump: true,
  }).setView([24, 0], 1);
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 12,
  }).addTo(map);
  tiles.on('tileerror', () => {
    summary.textContent = 'Basemap unavailable. Visitor markers and list are still available.';
  });
  const markers = L.layerGroup().addTo(map);
  let visits = [];
  let missing = 0;

  function draw() {
    markers.clearLayers();
    const groups = new Map();
    for (const visit of visits) {
      const { lat, lon } = visit.location;
      const p = map.project([lat, lon]);
      const key = `${Math.floor(p.x / 42)}:${Math.floor(p.y / 42)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(visit);
    }
    for (const group of groups.values()) {
      const lat = group.reduce((n, v) => n + v.location.lat, 0) / group.length;
      const lon = group.reduce((n, v) => n + v.location.lon, 0) / group.length;
      const locations = [...new Set(group.map(v => [v.location.city, v.location.country].filter(Boolean).join(', ') || 'Unknown location'))];
      const popup = document.createElement('div');
      popup.className = 'visitor-map-popup';
      const title = document.createElement('strong');
      title.textContent = locations.join(' | ');
      popup.append(title);
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
      popup.append(list);
      L.marker([lat, lon], {
        title: `${group.length} visits: ${locations.join(' | ')}`,
        keyboard: true,
        icon: L.divIcon({
          className: 'visitor-map-marker',
          html: `<span>${group.length}</span>`,
          iconSize: [32, 32], iconAnchor: [16, 16],
        }),
      }).bindPopup(popup, { maxWidth: 300 }).addTo(markers);
    }
    summary.textContent = `${visits.length} mapped visits | ${missing} without coordinates`;
  }
  map.on('zoomend', draw);
  const observer = new ResizeObserver(() => map.invalidateSize());
  observer.observe(host);
  (document.getElementById('visitor-map-reset') as HTMLButtonElement).addEventListener('click', () => map.setView([24, 0], 1));
  window.addEventListener('pagehide', () => { observer.disconnect(); map.remove(); }, { once: true });
  return {
    update(events) {
      const arrivals = events.filter(v => !v.type || v.type === 'join');
      visits = arrivals.filter(v => {
        const loc = v.location;
        return loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon)
          && Math.abs(loc.lat) <= 90 && Math.abs(loc.lon) <= 180;
      });
      missing = arrivals.length - visits.length;
      draw();
    },
  };
}
