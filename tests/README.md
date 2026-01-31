# DevStack Public API Integration Tests

Integration tests for the DevStack Public API at `https://blink.tail8ab50a.ts.net:443`.

## Requirements

- Node.js >= 18.0.0 (uses native `fetch`)
- Network access to the API endpoint

## Setup

```bash
cd tests
npm install
```

## Running Tests

```bash
node api.test.js
```

## Test Coverage

### Core Endpoints
| Endpoint | Tests |
|----------|-------|
| `GET /health` | Health check status |
| `GET /system` | System info, service fields |
| `GET /visitors` | Visitors data, location structure |
| `GET /events` | Pagination, filtering by topic |
| `GET /visitor-analytics` | Analytics data, metrics fields |
| `GET /chat/{channel}/history` | Chat history, message structure |

### Notes Endpoints
| Endpoint | Tests |
|----------|-------|
| `GET /notes` | Paginated list |
| `GET /notes/search` | Hybrid, fulltext, semantic modes; pagination; error handling |
| `GET /notes/tags` | Tags with counts |
| `GET /notes/categories` | Categories with counts |

### Error Handling
- 404 for unknown endpoints
- 422 for invalid query parameters
- Empty search query validation

### WebSocket
- `WS /ws/visitors` - Connection and message reception

## Read-Only Tests

All tests are read-only and do not create, modify, or delete any data on the server. This ensures:
- No side effects on production data
- Safe to run repeatedly
- No cleanup required

## Limitations

1. **Network dependency**: Tests require network access to the API. They will fail if the API is unreachable.

2. **Data-dependent assertions**: Some tests may fail if the database has no data (e.g., empty chat history).

3. **No authentication tests**: The API is public and doesn't require authentication.

## Exit Codes

- `0` - All tests passed
- `1` - One or more tests failed

