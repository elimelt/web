# elimelt

TypeScript client SDK for the [elimelt.com](https://elimelt.com) API.

## Installation

```bash
npm install elimelt
# or
yarn add elimelt
# or
pnpm add elimelt
```

## Quick Start

```typescript
import { Client } from 'elimelt';

const client = new Client('https://api.elimelt.com');

// Check API health
const health = await client.health();
console.log(health); // { status: 'ok', redis: 'connected' }

// Get system stats
const system = await client.system();
console.log(system.uptime);
```

## API Reference

### Initialization

```typescript
// Simple
const client = new Client('https://your-api-url.com');

// With options
const client = new Client({
  baseUrl: 'https://your-api-url.com',
  wsBaseUrl: 'wss://your-api-url.com', // Optional, derived from baseUrl
  timeout: 30000, // Request timeout in ms
  headers: { 'X-Custom-Header': 'value' },
});
```

### Health & System

```typescript
// Health check
const health = await client.health();

// System information
const system = await client.system();
```

### Visitors

```typescript
// Get active visitors and recent visits
const visitors = await client.visitors.list();
console.log(visitors.active_count);
console.log(visitors.active_visitors);
console.log(visitors.recent_visits);

// Get visitor analytics
const analytics = await client.visitors.analytics({
  start_date: '2024-01-01',
  end_date: '2024-12-31',
  limit: 100,
});

// Get analytics summary
const summary = await client.visitors.analyticsSummary();

// Real-time visitor updates
const subscription = client.visitors.subscribe({
  onJoin: (visitor) => console.log('New visitor:', visitor),
  onLeave: (ip) => console.log('Visitor left:', ip),
  onOpen: () => console.log('Connected'),
  onClose: () => console.log('Disconnected'),
});

// Later: close the connection
subscription.close();
```

### Chat

```typescript
// Get chat history
const history = await client.chat.history('general', {
  limit: 50,
  before: '2024-01-01T00:00:00Z',
});

// Get chat analytics
const analytics = await client.chat.analytics('general');
console.log(analytics.messages, analytics.senders);

// Real-time chat subscription
const subscription = client.chat.subscribe('general', {
  onMessage: (msg) => console.log(`${msg.sender}: ${msg.text}`),
  onPresence: (event) => console.log(event.type, event),
  onOpen: () => console.log('Connected to chat'),
});

// Send a message (via the WebSocket)
subscription.send({
  type: 'message',
  sender: 'username',
  text: 'Hello, world!',
});
```

### Notes

```typescript
// List all notes
const notes = await client.notes.list({ limit: 20, offset: 0 });

// Get a specific note
const note = await client.notes.get(123);
console.log(note.document.title, note.document.content);

// Search notes
const results = await client.notes.search({
  q: 'typescript',
  use_semantic: true,
});

// Get tags and categories
const tags = await client.notes.tags();
const categories = await client.notes.categories();

// Filter by category or tag
const byCategory = await client.notes.byCategory('programming');
const byTag = await client.notes.byTag('javascript');
```

### Events

```typescript
// Get event history
const events = await client.events.list({
  topic: 'visitors',
  type: 'join',
  limit: 100,
});
```

### When2Meet

```typescript
// Create a new event
const { id } = await client.when2meet.createEvent({
  name: 'Team Meeting',
  description: 'Weekly sync',
  dates: ['2024-03-01', '2024-03-02', '2024-03-03'],
  time_slots: ['09:00', '10:00', '11:00', '14:00', '15:00'],
  creator_name: 'Alice',
});

// Get event details
const event = await client.when2meet.getEvent(id);
console.log(event.event.name);
console.log(event.availabilities);
console.log(event.summary); // slot -> count mapping

// Set availability
await client.when2meet.setAvailability(id, {
  participant_name: 'Bob',
  available_slots: ['2024-03-01T09:00', '2024-03-01T10:00'],
});
```

## TypeScript Support

This package is written in TypeScript and includes full type definitions. All API responses are fully typed.

```typescript
import type {
  Visitor,
  ChatMessage,
  NoteDocument,
  VisitorAnalyticsResponse,
} from 'elimelt';
```

## License

MIT
