import { getSystem } from './api.js';

const TABLE_STYLES = {
  table: 'width:100%; border-collapse: collapse;',
  th: 'text-align:left; padding: 6px 4px; border-bottom: 1px solid var(--border);'
};

const TABLE_COLUMNS = ['Service', 'Status', 'CPU', 'Memory'];

function formatPercent(value) {
  if (typeof value !== 'number' || isNaN(value)) return '—';
  const pct = value <= 1 ? value * 100 : value;
  return `${pct.toFixed(1)}%`;
}

function formatMb(value) {
  if (typeof value !== 'number' || isNaN(value)) return '—';
  return `${value.toFixed(1)} MB`;
}

function stripHealthy(uptime) {
  if (typeof uptime !== 'string') return uptime;
  return uptime.replace(/\(healthy\)/g, '').trim();
}

function serviceToRow(svc) {
  return [
    svc.name || 'unknown',
    stripHealthy(svc.status) || 'unknown',
    formatPercent(svc.cpu_percent),
    `${formatMb(svc.memory_mb)} (${formatPercent(svc.memory_percent)})`
  ];
}

function renderTableHeader() {
  const headers = TABLE_COLUMNS
    .map(col => `<th style="${TABLE_STYLES.th}">${col}</th>`)
    .join('');
  return `<thead><tr>${headers}</tr></thead>`;
}

function renderTableBody(services) {
  const rows = services
    .map(svc => {
      const cells = serviceToRow(svc).map(val => `<td>${val}</td>`).join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  return `<tbody>${rows}</tbody>`;
}

function renderTable(services) {
  return `
    <div class="services-table-wrap">
      <table class="services-table" style="${TABLE_STYLES.table}">
        ${renderTableHeader()}
        ${renderTableBody(services)}
      </table>
    </div>
  `;
}

function renderDescription(totalContainers) {
  return `<div class="section-description">Total containers: ${totalContainers}</div>`;
}

function renderLoading() {
  return '<div class="section-description">Loading services...</div>';
}

function renderEmpty(totalContainers) {
  return `${renderDescription(totalContainers)}<div>No services reported.</div>`;
}

function renderServices(data) {
  const services = Array.isArray(data.services) ? data.services : [];
  const totalContainers = typeof data.total_containers === 'number'
    ? data.total_containers
    : (services.length || '—');

  if (!services.length) {
    return renderEmpty(totalContainers);
  }

  return renderDescription(totalContainers) + renderTable(services);
}

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('services-content');
  if (!container) return;

  container.innerHTML = renderLoading();

  async function load() {
    try {
      const data = await getSystem();
      if (!data || typeof data !== 'object') {
        container.textContent = 'No data';
        return;
      }
      container.innerHTML = renderServices(data);
    } catch (e) {
      console.error('Failed to load system services:', e);
      container.textContent = 'Failed to load services';
    }
  }

  load();
  setInterval(load, 10000);
});
