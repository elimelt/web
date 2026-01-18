## Click Analytics Schema (frontend reference)

Endpoints:
- WebSocket (piggyback): `wss://.../ws/visitors`
  - Outbound message:
    - `type`: `analytics.batch`
    - `payload.topic`: `clicks`
    - `payload.events`: `ClickEvent[]`
- HTTP beacon fallback: `POST ${BASE_URL}/clicks/analytics`
  - Body: `{ topic: "clicks", events: ClickEvent[] }`

ClickEvent:
```json
{
  "type": "click",
  "ts": 1735707600000,
  "seq": 42,
  "session": { "pageId": "q2k7h1..." },
  "page": { "url": "https://...", "path": "/home", "title": "Page Title" },
  "viewport": { "width": 1440, "height": 900, "scrollX": 0, "scrollY": 128, "dpr": 2 },
  "pointer": {
    "x": 512, "y": 384,
    "pageX": 512, "pageY": 512,
    "button": 0, "buttons": 1,
    "pointerType": "mouse",
    "altKey": false, "ctrlKey": false, "metaKey": false, "shiftKey": false
  },
  "element": {
    "tag": "a",
    "id": "cta-link",
    "classes": "btn primary",
    "role": "link",
    "name": "",
    "ariaLabel": "Open details",
    "text": "Open details",
    "analytics": {
      "id": "nav:services",
      "label": "Services",
      "group": "navigation",
      "type": "nav.link"
    },
    "domPath": "a#cta-link.btn.primary",
    "rect": { "x": 100, "y": 200, "width": 120, "height": 40 }
  }
}
```

Notes:
- `seq` is per-page and increments with each click.
- `session.pageId` is generated once per page session (sessionStorage or fallback).
- `element.analytics` reflects the nearest ancestor with any of:
  - `data-analytics`, `data-analytics-id`, `data-analytics-label`, `data-analytics-group`.

