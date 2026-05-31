const API_DOCS_URL = 'https://api.elimelt.com';

function countEndpoints(openApiSpec) {
  const paths = openApiSpec.paths || {};
  let count = 0;
  for (const path of Object.values(paths)) {
    for (const method of Object.keys(path)) {
      if (['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method.toLowerCase())) {
        count++;
      }
    }
  }
  return count;
}

function renderStats(endpointCount) {
  return `${endpointCount} ${endpointCount === 1 ? 'endpoint' : 'endpoints'}`;
}

document.addEventListener('DOMContentLoaded', () => {
  const statsEl = document.getElementById('public-api-stats');
  if (!statsEl) return;

  statsEl.textContent = 'Loading...';

  async function load() {
    try {
      const response = await fetch(`${API_DOCS_URL}/openapi.json`);
      const spec = await response.json();
      const endpointCount = countEndpoints(spec);
      statsEl.textContent = renderStats(endpointCount);
    } catch (e) {
      console.error('Failed to load OpenAPI spec:', e);
      statsEl.textContent = 'API documentation';
    }
  }

  load();
});

