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

function renderStats(totalContainers) {
  return `${totalContainers} ${totalContainers === 1 ? 'container' : 'containers'}`;
}

function renderServices(data) {
  const services = Array.isArray(data.services) ? data.services : [];

  if (!services.length) {
    return '<div>No services reported.</div>';
  }

  return renderTable(services);
}

document.addEventListener('DOMContentLoaded', () => {
  const statsEl = document.getElementById('services-stats');
  const container = document.getElementById('services-content');
  if (!container || !statsEl) return;

  async function load() {
    try {
      const data = await getSystem();
      if (!data || typeof data !== 'object') {
        statsEl.textContent = 'No data';
        container.innerHTML = '';
        return;
      }
      const services = Array.isArray(data.services) ? data.services : [];
      const totalContainers = typeof data.total_containers === 'number'
        ? data.total_containers
        : (services.length || 0);

      statsEl.textContent = renderStats(totalContainers);
      container.innerHTML = renderServices(data);
    } catch (e) {
      console.error('Failed to load system services:', e);
      statsEl.textContent = 'Failed to load';
      container.innerHTML = '';
    }
  }

  load();
  setInterval(load, 10000);
});
