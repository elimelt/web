const BASE_URL = 'https://blink.tail8ab50a.ts.net:443/api';
const WS_BASE_URL = 'wss://blink.tail8ab50a.ts.net:443/api';

const results = { passed: 0, failed: 0, skipped: 0, tests: [] };

async function test(name, fn) {
  try {
    await fn();
    results.passed++;
    results.tests.push({ name, status: 'PASS' });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.failed++;
    results.tests.push({ name, status: 'FAIL', error: err.message });
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
  }
}

function skip(name, _reason) {
  results.skipped++;
  results.tests.push({ name, status: 'SKIP' });
  console.log(`  ○ ${name} (skipped)`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertType(value, type, field) {
  const actualType = Array.isArray(value) ? 'array' : typeof value;
  if (type === 'array' && !Array.isArray(value)) {
    throw new Error(`Expected ${field} to be array, got ${actualType}`);
  } else if (type !== 'array' && actualType !== type) {
    throw new Error(`Expected ${field} to be ${type}, got ${actualType}`);
  }
}

async function fetchJson(endpoint) {
  const res = await fetch(`${BASE_URL}${endpoint}`);
  return { status: res.status, data: await res.json() };
}

console.log('\n=== DevStack Public API Integration Tests ===\n');

console.log('GET /health');
await test('returns ok status', async () => {
  const { status, data } = await fetchJson('/health');
  assert(status === 200, `Expected 200, got ${status}`);
  assert(data.status === 'ok', `Expected status ok, got ${data.status}`);
});

console.log('\nGET /system');
await test('returns system info with services', async () => {
  const { status, data } = await fetchJson('/system');
  assert(status === 200, `Expected 200, got ${status}`);
  assertType(data.services, 'array', 'services');
  assertType(data.total_containers, 'number', 'total_containers');
});

await test('each service has required fields', async () => {
  const { data } = await fetchJson('/system');
  const service = data.services[0];
  assert(service, 'Expected at least one service');
  assertType(service.name, 'string', 'service.name');
  assertType(service.status, 'string', 'service.status');
  assertType(service.image, 'string', 'service.image');
});

console.log('\nGET /visitors');
await test('returns visitors data', async () => {
  const { status, data } = await fetchJson('/visitors');
  assert(status === 200, `Expected 200, got ${status}`);
  assertType(data.active_count, 'number', 'active_count');
  assertType(data.active_visitors, 'array', 'active_visitors');
  assertType(data.recent_visits, 'array', 'recent_visits');
});

await test('recent visits have location data', async () => {
  const { data } = await fetchJson('/visitors');
  if (data.recent_visits.length > 0) {
    const visit = data.recent_visits[0];
    assertType(visit.ip, 'string', 'visit.ip');
    assertType(visit.location, 'object', 'visit.location');
    assertType(visit.timestamp, 'string', 'visit.timestamp');
  }
});

console.log('\nGET /events');
await test('returns events with pagination', async () => {
  const { status, data } = await fetchJson('/events?limit=5');
  assert(status === 200, `Expected 200, got ${status}`);
  assertType(data.events, 'array', 'events');
  assert(data.events.length <= 5, 'Should respect limit');
});

await test('events have required structure', async () => {
  const { data } = await fetchJson('/events?limit=1');
  if (data.events.length > 0) {
    const event = data.events[0];
    assertType(event.topic, 'string', 'event.topic');
    assertType(event.type, 'string', 'event.type');
    assertType(event.timestamp, 'string', 'event.timestamp');
    assertType(event.payload, 'object', 'event.payload');
  }
});

await test('filters events by topic', async () => {
  const { status, data } = await fetchJson('/events?topic=visitor_updates&limit=5');
  assert(status === 200, `Expected 200, got ${status}`);
  data.events.forEach(e => {
    assert(e.topic === 'visitor_updates', `Expected topic visitor_updates, got ${e.topic}`);
  });
});

console.log('\nGET /visitor-analytics');
await test('returns analytics data', async () => {
  const { status, data } = await fetchJson('/visitor-analytics?limit=3');
  assert(status === 200, `Expected 200, got ${status}`);
  assertType(data.visitors, 'array', 'visitors');
  assertType(data.count, 'number', 'count');
  assertType(data.filters, 'object', 'filters');
});

await test('analytics entries have metrics', async () => {
  const { data } = await fetchJson('/visitor-analytics?limit=1');
  if (data.visitors.length > 0) {
    const v = data.visitors[0];
    assertType(v.visitor_ip, 'string', 'visitor_ip');
    assertType(v.total_visits, 'number', 'total_visits');
    assertType(v.total_time_seconds, 'number', 'total_time_seconds');
  }
});

console.log('\nGET /chat/{channel}/history');
await test('returns chat history', async () => {
  const { status, data } = await fetchJson('/chat/general/history?limit=5');
  assert(status === 200, `Expected 200, got ${status}`);
  assertType(data.messages, 'array', 'messages');
});

await test('messages have required fields', async () => {
  const { data } = await fetchJson('/chat/general/history?limit=1');
  if (data.messages.length > 0) {
    const msg = data.messages[0];
    assertType(msg.type, 'string', 'message.type');
    assertType(msg.channel, 'string', 'message.channel');
    assertType(msg.sender, 'string', 'message.sender');
    assertType(msg.text, 'string', 'message.text');
    assertType(msg.timestamp, 'string', 'message.timestamp');
  }
});

console.log('\nGET /notes/search');
await test('hybrid search returns results', async () => {
  const { status, data } = await fetchJson('/notes/search?q=systems&mode=hybrid&limit=5');
  assert(status === 200, `Expected 200, got ${status}`);
  assert(data.query === 'systems', `Expected query 'systems', got ${data.query}`);
  assert(data.mode === 'hybrid', `Expected mode 'hybrid', got ${data.mode}`);
  assertType(data.results, 'array', 'results');
  assertType(data.total, 'number', 'total');
  assert(data.results.length <= 5, 'Should respect limit');
});

await test('fulltext search returns results', async () => {
  const { status, data } = await fetchJson('/notes/search?q=algorithms&mode=fulltext&limit=3');
  assert(status === 200, `Expected 200, got ${status}`);
  assert(data.mode === 'fulltext', `Expected mode 'fulltext', got ${data.mode}`);
  assertType(data.results, 'array', 'results');
});

await test('semantic search returns results', async () => {
  const { status, data } = await fetchJson('/notes/search?q=machine+learning&mode=semantic&limit=3');
  assert(status === 200, `Expected 200, got ${status}`);
  assert(data.mode === 'semantic', `Expected mode 'semantic', got ${data.mode}`);
  assertType(data.results, 'array', 'results');
});

await test('search results have required fields', async () => {
  const { data } = await fetchJson('/notes/search?q=systems&limit=1');
  if (data.results.length > 0) {
    const note = data.results[0];
    assertType(note.id, 'number', 'note.id');
    assertType(note.title, 'string', 'note.title');
    assertType(note.file_path, 'string', 'note.file_path');
    assertType(note.category, 'string', 'note.category');
  }
});

await test('search results include scores', async () => {
  const { data } = await fetchJson('/notes/search?q=distributed&mode=hybrid&limit=1');
  if (data.results.length > 0) {
    const note = data.results[0];
    assertType(note.scores, 'object', 'note.scores');
    assert(note.scores.hybrid !== undefined, 'Expected hybrid score');
  }
});

await test('pagination with offset works', async () => {
  const { data: page1 } = await fetchJson('/notes/search?q=systems&limit=2&offset=0');
  const { data: page2 } = await fetchJson('/notes/search?q=systems&limit=2&offset=2');
  assert(page1.results.length > 0, 'Page 1 should have results');
  assert(page2.results.length > 0, 'Page 2 should have results');
  if (page1.results[0] && page2.results[0]) {
    assert(page1.results[0].id !== page2.results[0].id, 'Pages should have different results');
  }
});

await test('empty query returns validation error', async () => {
  const { status, data } = await fetchJson('/notes/search?q=');
  assert(status === 422, `Expected 422 validation error, got ${status}`);
  assertType(data.detail, 'array', 'detail');
});

await test('invalid mode returns validation error', async () => {
  const { status } = await fetchJson('/notes/search?q=test&mode=invalid');
  assert(status === 422, `Expected 422, got ${status}`);
});

console.log('\nGET /notes');
await test('returns paginated notes list', async () => {
  const { status, data } = await fetchJson('/notes?limit=5');
  assert(status === 200, `Expected 200, got ${status}`);
  assertType(data.documents, 'array', 'documents');
  assert(data.documents.length <= 5, 'Should respect limit');
  assertType(data.total, 'number', 'total');
  assertType(data.has_more, 'boolean', 'has_more');
});

console.log('\nGET /notes/tags');
await test('returns tags with counts', async () => {
  const { status, data } = await fetchJson('/notes/tags');
  assert(status === 200, `Expected 200, got ${status}`);
  assertType(data.tags, 'array', 'tags');
  if (data.tags.length > 0) {
    assertType(data.tags[0].name, 'string', 'tag.name');
    assertType(data.tags[0].document_count, 'number', 'tag.document_count');
  }
});

console.log('\nGET /notes/categories');
await test('returns categories with counts', async () => {
  const { status, data } = await fetchJson('/notes/categories');
  assert(status === 200, `Expected 200, got ${status}`);
  assertType(data.categories, 'array', 'categories');
  if (data.categories.length > 0) {
    assertType(data.categories[0].name, 'string', 'category.name');
    assertType(data.categories[0].document_count, 'number', 'category.document_count');
  }
});

console.log('\n--- Error Handling Tests ---');

console.log('\nInvalid endpoints');
await test('returns 404 for unknown endpoint', async () => {
  const { status } = await fetchJson('/nonexistent-endpoint-12345');
  assert(status === 404, `Expected 404, got ${status}`);
});

await test('returns 422 for invalid query params', async () => {
  const { status } = await fetchJson('/events?limit=notanumber');
  assert(status === 422, `Expected 422, got ${status}`);
});

console.log('\nWebSocket /ws/visitors');
await test('connects and receives initial message', async () => {
  const { WebSocket } = await import('ws');
  const ws = new WebSocket(`${WS_BASE_URL}/ws/visitors`);

  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket connection timeout'));
    }, 5000);

    ws.on('open', () => {
      clearTimeout(timeout);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        ws.close();
        resolve(msg);
      } catch (e) {
        reject(e);
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  assert(result.type !== undefined, 'Should receive message with type');
});

console.log('\n=== Test Summary ===');
console.log(`Passed: ${results.passed}`);
console.log(`Failed: ${results.failed}`);
console.log(`Skipped: ${results.skipped}`);
console.log(`Total: ${results.passed + results.failed + results.skipped}`);

if (results.failed > 0) {
  console.log('\nFailed tests:');
  results.tests.filter(t => t.status === 'FAIL').forEach(t => {
    console.log(`  - ${t.name}: ${t.error}`);
  });
  process.exit(1);
}
