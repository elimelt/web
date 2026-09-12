import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Geographic coordinates shared by coastlines and visitor markers.
function position(lat, lon, radius = 1.005) {
  const phi = lat * Math.PI / 180;
  const theta = lon * Math.PI / 180;
  return new THREE.Vector3(
    radius * Math.cos(phi) * Math.cos(theta),
    radius * Math.sin(phi),
    -radius * Math.cos(phi) * Math.sin(theta),
  );
}

export function createVisitorMap(onSelectVisitor) {
  const host = document.getElementById('visitor-map');
  const summary = document.getElementById('visitor-map-summary');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    host.textContent = '3D is unavailable in this browser. Switch to List to explore visitors.';
    return { update() {} };
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  host.append(renderer.domElement);
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', 'Visitor globe. Drag or use arrow keys to rotate; plus and minus to zoom.');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 20);
  camera.position.copy(position(24, -40, 3.3));
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enablePan = false;
  controls.minDistance = 1.7;
  controls.maxDistance = 5;
  controls.enableZoom = false;
  controls.rotateSpeed = 0.65;
  const ocean = new THREE.MeshBasicMaterial();
  const coast = new THREE.LineBasicMaterial();
  const grid = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.18 });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), ocean));
  function line(points, material) {
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    line(Array.from({ length: 181 }, (_, i) => position(lat, i * 2 - 180)), grid);
  }
  for (let lon = -180; lon < 180; lon += 30) {
    line(Array.from({ length: 91 }, (_, i) => position(i * 2 - 90, lon)), grid);
  }

  const overlay = document.createElement('div');
  overlay.className = 'globe-markers';
  const popup = document.createElement('div');
  popup.className = 'visitor-map-popup globe-popup';
  popup.hidden = true;
  host.append(overlay, popup);
  let markers = [];
  let disposed = false;
  let coastlineFailed = false;
  let counts = '';

  function render() {
    if (disposed || !host.clientWidth || !host.clientHeight) return;
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    renderer.render(scene, camera);
    const clusters = [];
    for (const marker of markers) {
      const projected = marker.point.clone().project(camera);
      const visible = marker.point.dot(camera.position.clone().sub(marker.point)) > 0
        && Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1;
      if (!visible) continue;
      const x = (projected.x + 1) * host.clientWidth / 2;
      const y = (1 - projected.y) * host.clientHeight / 2;
      const nearby = clusters.find(cluster => Math.hypot(cluster.x - x, cluster.y - y) < 42);
      if (nearby) nearby.group.push(...marker.group);
      else clusters.push({ x, y, group: [...marker.group] });
    }
    overlay.replaceChildren();
    for (const { x, y, group } of clusters) {
      const label = [...new Set(group.map(v => [v.location.city, v.location.country].filter(Boolean).join(', ') || 'Unknown location'))].join(' · ');
      const button = document.createElement('button');
      button.className = 'globe-marker';
      button.type = 'button';
      button.textContent = group.length;
      button.setAttribute('aria-label', `${group.length} visits: ${label}`);
      button.style.left = `${x}px`;
      button.style.top = `${y}px`;
      button.addEventListener('click', () => showVisits(group, label, button));
      overlay.append(button);
    }
  }
  function resize() {
    if (!host.clientWidth || !host.clientHeight) return;
    renderer.setSize(host.clientWidth, host.clientHeight);
    camera.aspect = host.clientWidth / host.clientHeight;
    camera.updateProjectionMatrix();
    render();
  }
  controls.addEventListener('change', render);
  const sizeObserver = new ResizeObserver(resize);
  sizeObserver.observe(host);
  function theme() {
    const dark = document.body.classList.contains('dark-mode');
    ocean.color.set(dark ? '#151e22' : '#edf0ed');
    coast.color.set(dark ? '#819791' : '#778b83');
    grid.color.set(dark ? '#b9c8bd' : '#647a70');
    render();
  }
  const themeObserver = new MutationObserver(theme);
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  theme();
  resize();

  function zoom(factor) {
    camera.position.setLength(THREE.MathUtils.clamp(camera.position.length() * factor, 1.7, 5));
    controls.update();
    render();
  }
  const zoomButtons = document.createElement('div');
  zoomButtons.className = 'globe-zoom';
  for (const [label, text, factor] of [['Zoom in', '+', 0.85], ['Zoom out', '−', 1.15]]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', () => zoom(factor));
    zoomButtons.append(button);
  }
  host.append(zoomButtons);
  renderer.domElement.addEventListener('keydown', event => {
    const spherical = new THREE.Spherical().setFromVector3(camera.position);
    if (event.key === 'ArrowLeft') spherical.theta -= 0.15;
    else if (event.key === 'ArrowRight') spherical.theta += 0.15;
    else if (event.key === 'ArrowUp') spherical.phi -= 0.15;
    else if (event.key === 'ArrowDown') spherical.phi += 0.15;
    else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(0.85); return; }
    else if (event.key === '-') { event.preventDefault(); zoom(1.15); return; }
    else return;
    event.preventDefault();
    spherical.makeSafe();
    camera.position.setFromSpherical(spherical);
    controls.update();
    render();
  });
  document.getElementById('visitor-map-reset').addEventListener('click', () => {
    camera.position.copy(position(24, -40, 3.3));
    popup.hidden = true;
    controls.update();
    render();
  });

  const request = new AbortController();
  fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json', { signal: request.signal })
    .then(response => { if (!response.ok) throw new Error('Coastlines unavailable'); return response.json(); })
    .then(topology => {
      if (disposed) return;
      const { scale, translate } = topology.transform;
      for (const arc of topology.arcs) {
        let x = 0, y = 0;
        line(arc.map(([dx, dy]) => {
          x += dx; y += dy;
          return position(y * scale[1] + translate[1], x * scale[0] + translate[0], 1.008);
        }), coast);
      }
      host.dataset.coastlines = 'ready';
      render();
    }).catch(() => {
      if (disposed) return;
      coastlineFailed = true;
      summary.textContent = `${counts} · Coastlines unavailable`;
    });

  function showVisits(group, label, sourceButton) {
    popup.replaceChildren();
    const close = document.createElement('button');
    close.textContent = 'Close';
    close.type = 'button';
    close.addEventListener('click', () => { popup.hidden = true; sourceButton.focus(); });
    const title = document.createElement('strong');
    title.textContent = label;
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
    popup.append(close, title, list);
    popup.hidden = false;
    close.focus();
  }
  window.addEventListener('pagehide', () => {
    disposed = true;
    request.abort();
    sizeObserver.disconnect();
    themeObserver.disconnect();
    controls.dispose();
    scene.traverse(object => object.geometry?.dispose());
    ocean.dispose(); coast.dispose(); grid.dispose(); renderer.dispose();
  }, { once: true });
  return {
    update(events) {
      const arrivals = events.filter(v => !v.type || v.type === 'join');
      const visits = arrivals.filter(v => v.location && Number.isFinite(v.location.lat)
        && Number.isFinite(v.location.lon) && Math.abs(v.location.lat) <= 90 && Math.abs(v.location.lon) <= 180);
      counts = `${visits.length} mapped visits · ${arrivals.length - visits.length} without coordinates · Locations approximate`;
      summary.textContent = counts + (coastlineFailed ? ' · Coastlines unavailable' : '');
      const groups = new Map();
      for (const visit of visits) {
        const key = `${Math.round(visit.location.lat / 5)}:${Math.round(visit.location.lon / 5)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(visit);
      }
      overlay.replaceChildren();
      popup.hidden = true;
      markers = [];
      for (const group of groups.values()) {
        const point = group.reduce((sum, v) => sum.add(position(v.location.lat, v.location.lon)), new THREE.Vector3()).normalize().multiplyScalar(1.015);
        markers.push({ point, group });
      }
      render();
    },
  };
}
