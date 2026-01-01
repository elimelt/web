import { BASE_URL, WS_BASE_URL } from './config.js';

const fetchJson = (endpoint) =>
  fetch(`${BASE_URL}${endpoint}`)
    .then((response) => response.json())
    .catch((error) => {
      console.error(`Error fetching api ${endpoint}:`, error);
      return error;
    });

const getSystem = () => fetchJson('/system');

const getVisitors = () => fetchJson('/visitors');

const getWsVisitors = (callbacks = {}) => {
  const ws = new WebSocket(`${WS_BASE_URL}/ws/visitors`);

  const {
    onConnect = () => console.log('Connected to visitor tracking'),
    onVisitorJoin = (visitor) => console.log('Visitor joined:', visitor),
    onVisitorLeave = (ip) => console.log('Visitor left:', ip),
    onUpdate = (data) => console.log('Update:', data),
    onError = (error) => console.error('WebSocket error:', error),
    onDisconnect = () => console.log('Disconnected from visitor tracking'),
  } = callbacks;

  ws.onopen = onConnect;

  ws.onmessage = async (event) => {
    try {
      let text = event.data;
      if (event.data instanceof Blob) {
        text = await event.data.text();
      }
      const data = JSON.parse(text);

      if (data.type === 'ping') {
        ws.send('pong');
      } else if (data.type === 'join') {
        onVisitorJoin(data.visitor);
        onUpdate(data);
      } else if (data.type === 'leave') {
        onVisitorLeave(data.ip);
        onUpdate(data);
      } else {
        onUpdate(data);
      }
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  };

  ws.onerror = onError;

  ws.onclose = onDisconnect;

  return {
    ws,
    close: () => ws.close(),
    send: (data) => ws.send(JSON.stringify(data)),
  };
};
export { getSystem, getVisitors, getWsVisitors };
