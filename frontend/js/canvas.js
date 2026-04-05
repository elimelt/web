/**
 * Collaborative Canvas with 2P-Set CRDT
 * Minimal, performant, stylized
 */

const CANVAS_WS_URL = 'wss://blink.tail8ab50a.ts.net/api/ws/canvas';
const COLORS = ['#fff', '#ff6b6b', '#4ecdc4', '#ffe66d', '#95e1d3', '#f38181', '#aa96da', '#fcbad3'];
const WIDTHS = [2, 4, 8, 16];

class CollaborativeCanvas {
  constructor(container) {
    this.container = container;
    this.canvas = null;
    this.ctx = null;
    this.ws = null;
    this.clientId = null;
    this.clock = 0;

    // State
    this.strokes = new Map();  // id -> stroke
    this.removed = new Set();  // removed stroke ids
    this.myStrokes = [];       // stack for undo
    this.cursors = new Map();  // author_id -> {x, y, color}

    // Drawing state
    this.isDrawing = false;
    this.currentStroke = null;
    this.color = COLORS[Math.floor(Math.random() * COLORS.length)];
    this.width = WIDTHS[1];

    // Performance
    this.needsRedraw = false;
    this.lastCursorBroadcast = 0;

    this.init();
  }

  init() {
    this.createDOM();
    this.setupCanvas();
    this.setupEvents();
    this.connect();
    this.startRenderLoop();
  }

  createDOM() {
    this.container.innerHTML = `
      <div class="canvas-wrapper">
        <canvas id="collab-canvas"></canvas>
        <div class="canvas-cursors"></div>
        <div class="canvas-toolbar">
          <div class="toolbar-colors"></div>
          <div class="toolbar-widths"></div>
          <div class="toolbar-actions">
            <button class="toolbar-btn" data-action="undo" title="Undo (Ctrl+Z)">↩</button>
            <button class="toolbar-btn" data-action="clear" title="Clear my strokes">✕</button>
          </div>
          <div class="toolbar-status">
            <span class="status-users">-</span>
            <span class="status-connection">●</span>
          </div>
        </div>
      </div>
    `;

    // Color buttons
    const colorsDiv = this.container.querySelector('.toolbar-colors');
    COLORS.forEach(c => {
      const btn = document.createElement('button');
      btn.className = 'color-btn' + (c === this.color ? ' active' : '');
      btn.style.background = c;
      btn.dataset.color = c;
      colorsDiv.appendChild(btn);
    });

    // Width buttons
    const widthsDiv = this.container.querySelector('.toolbar-widths');
    WIDTHS.forEach(w => {
      const btn = document.createElement('button');
      btn.className = 'width-btn' + (w === this.width ? ' active' : '');
      btn.innerHTML = `<span style="width:${w}px;height:${w}px"></span>`;
      btn.dataset.width = w;
      widthsDiv.appendChild(btn);
    });

    this.canvas = this.container.querySelector('#collab-canvas');
    this.cursorsEl = this.container.querySelector('.canvas-cursors');
    this.statusUsers = this.container.querySelector('.status-users');
    this.statusConn = this.container.querySelector('.status-connection');
  }

  setupCanvas() {
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    this.ctx.scale(dpr, dpr);
    this.needsRedraw = true;
  }

  setupEvents() {
    // Drawing
    this.canvas.addEventListener('pointerdown', e => this.onPointerDown(e));
    this.canvas.addEventListener('pointermove', e => this.onPointerMove(e));
    this.canvas.addEventListener('pointerup', e => this.onPointerUp(e));
    this.canvas.addEventListener('pointerleave', e => this.onPointerUp(e));

    // Toolbar
    this.container.addEventListener('click', e => {
      const colorBtn = e.target.closest('.color-btn');
      if (colorBtn) {
        this.color = colorBtn.dataset.color;
        this.container.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
        colorBtn.classList.add('active');
      }
      const widthBtn = e.target.closest('.width-btn');
      if (widthBtn) {
        this.width = parseInt(widthBtn.dataset.width);
        this.container.querySelectorAll('.width-btn').forEach(b => b.classList.remove('active'));
        widthBtn.classList.add('active');
      }
      const actionBtn = e.target.closest('.toolbar-btn');
      if (actionBtn) {
        if (actionBtn.dataset.action === 'undo') this.undo();
        if (actionBtn.dataset.action === 'clear') this.clearMine();
      }
    });

    // Keyboard
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        this.undo();
      }
    });
  }

  // WebSocket
  connect() {
    this.ws = new WebSocket(CANVAS_WS_URL);
    this.ws.onopen = () => {
      this.statusConn.classList.add('connected');
      this.statusConn.title = 'Connected';
    };
    this.ws.onclose = () => {
      this.statusConn.classList.remove('connected');
      this.statusConn.title = 'Disconnected';
      setTimeout(() => this.connect(), 2000);
    };
    this.ws.onmessage = e => this.onMessage(JSON.parse(e.data));
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  onMessage(msg) {
    switch (msg.type) {
      case 'sync':
        this.clientId = msg.client_id;
        this.strokes.clear();
        this.removed.clear();
        msg.state.strokes.forEach(s => this.strokes.set(s.id, s));
        msg.state.removed.forEach(id => this.removed.add(id));
        this.statusUsers.textContent = msg.user_count + ' online';
        this.needsRedraw = true;
        break;
      case 'op':
        this.applyOp(msg.op);
        break;
      case 'cursor':
        this.updateCursor(msg.cursor);
        break;
      case 'user_count':
        this.statusUsers.textContent = msg.count + ' online';
        break;
      case 'ping':
        this.send({ type: 'pong' });
        break;
    }
  }

  applyOp(op) {
    if (op.type === 'add') {
      if (!this.removed.has(op.stroke.id)) {
        this.strokes.set(op.stroke.id, op.stroke);
        this.needsRedraw = true;
      }
    } else if (op.type === 'remove') {
      this.removed.add(op.stroke_id);
      this.needsRedraw = true;
    }
  }

  // Drawing
  getPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }

  onPointerDown(e) {
    this.isDrawing = true;
    this.canvas.setPointerCapture(e.pointerId);
    const pt = this.getPoint(e);
    this.currentStroke = {
      id: `${this.clientId}-${this.clock++}`,
      author_id: this.clientId,
      points: [pt],
      color: this.color,
      width: this.width,
      timestamp: Date.now(),
    };
  }

  onPointerMove(e) {
    const pt = this.getPoint(e);

    // Broadcast cursor
    const now = Date.now();
    if (now - this.lastCursorBroadcast > 50) {
      this.send({ type: 'cursor', cursor: { x: pt.x, y: pt.y, color: this.color } });
      this.lastCursorBroadcast = now;
    }

    if (!this.isDrawing || !this.currentStroke) return;
    this.currentStroke.points.push(pt);
    this.needsRedraw = true;
  }

  onPointerUp(e) {
    if (!this.isDrawing || !this.currentStroke) return;
    this.isDrawing = false;

    if (this.currentStroke.points.length > 1) {
      this.strokes.set(this.currentStroke.id, this.currentStroke);
      this.myStrokes.push(this.currentStroke.id);
      this.send({ type: 'add', stroke: this.currentStroke });
    }
    this.currentStroke = null;
    this.needsRedraw = true;
  }

  undo() {
    const id = this.myStrokes.pop();
    if (!id) return;
    this.removed.add(id);
    this.send({ type: 'remove', stroke_id: id, author_id: this.clientId });
    this.needsRedraw = true;
  }

  clearMine() {
    this.send({ type: 'clear', author_id: this.clientId });
    this.myStrokes.forEach(id => this.removed.add(id));
    this.myStrokes = [];
    this.needsRedraw = true;
  }

  // Cursors
  updateCursor(cursor) {
    this.cursors.set(cursor.author_id, cursor);
    this.renderCursors();
    setTimeout(() => {
      this.cursors.delete(cursor.author_id);
      this.renderCursors();
    }, 3000);
  }

  renderCursors() {
    this.cursorsEl.innerHTML = '';
    const rect = this.canvas.getBoundingClientRect();
    this.cursors.forEach((c, id) => {
      const el = document.createElement('div');
      el.className = 'cursor';
      el.style.left = (c.x * rect.width) + 'px';
      el.style.top = (c.y * rect.height) + 'px';
      el.style.background = c.color;
      this.cursorsEl.appendChild(el);
    });
  }

  // Rendering
  startRenderLoop() {
    const render = () => {
      if (this.needsRedraw) {
        this.draw();
        this.needsRedraw = false;
      }
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
  }

  draw() {
    const ctx = this.ctx;
    const w = this.canvas.width / (window.devicePixelRatio || 1);
    const h = this.canvas.height / (window.devicePixelRatio || 1);

    ctx.clearRect(0, 0, w, h);

    // Draw all visible strokes
    const visible = [...this.strokes.values()]
      .filter(s => !this.removed.has(s.id))
      .sort((a, b) => a.timestamp - b.timestamp);

    for (const stroke of visible) {
      this.drawStroke(stroke, w, h);
    }

    // Draw current stroke
    if (this.currentStroke) {
      this.drawStroke(this.currentStroke, w, h);
    }
  }

  drawStroke(stroke, w, h) {
    const ctx = this.ctx;
    const pts = stroke.points;
    if (pts.length < 2) return;

    ctx.beginPath();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.moveTo(pts[0].x * w, pts[0].y * h);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x * w, pts[i].y * h);
    }
    ctx.stroke();
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('canvas-section');
  if (container) {
    new CollaborativeCanvas(container);
  }
});
