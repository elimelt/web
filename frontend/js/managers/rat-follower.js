"use strict";

export const RatFollower = {
  DEFAULTS: {
    imgSrc: "assets/grep/grep-top.png",
    size: 100,
    anchor: { x: 0, y: 0 },
    stiffness: 50,
    damping: 22,
    mass: 1,
    rotate: true,
    debug: false,
    angleOffset: 0,
  },

  IDLE_THRESHOLD_MS: 3000,
  HUNGER_DELAY_MS: 1200,
  SHRINK_PER_SECOND: 10,
  BONE_DESPAWN_MS: 5000,

  EAT_RADIUS: 6,
  MIN_GROWTH: 3,
  GROWTH_RATE: 0.06,
  MAX_MEATS: 8,

  create(options = {}) {
    const prefersReduced =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) return;

    const config = Object.assign({}, this.DEFAULTS, options);

    const state = {
      targetX: window.innerWidth / 2,
      targetY: window.innerHeight / 2,
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      vx: 0,
      vy: 0,
      lastTime: performance.now(),
      currentSize: config.size,
      baseSize: config.size,
      lastMoveAt: performance.now(),
      isIdle: false,
      currentSprite: "top",
      lastEatAt: performance.now(),
      destroyed: false,
      spawnTimerId: null,
      rafId: null,
      meats: [],
    };

    const img = this._createRatElement(config);
    const debug = config.debug ? this._createDebugOverlay() : null;

    const setTarget = (clientX, clientY) => {
      state.targetX = clientX;
      state.targetY = clientY;
    };

    const updateTargetFromEvent = (e) => {
      if (e.touches && e.touches.length > 0) {
        setTarget(e.touches[0].clientX, e.touches[0].clientY);
      } else if (
        typeof e.clientX === "number" &&
        typeof e.clientY === "number"
      ) {
        setTarget(e.clientX, e.clientY);
      }
      state.lastMoveAt = performance.now();
    };

    const onBlur = () => {
      state.x = state.targetX;
      state.y = state.targetY;
      state.vx = 0;
      state.vy = 0;
    };

    this._attachEventListeners(updateTargetFromEvent, onBlur);

    const spawnMeat = () => {
      if (state.destroyed) return;
      const size = 22 + Math.random() * 22;
      const radius = size / 2;
      const margin = 20 + radius;
      const posX = margin + Math.random() * (window.innerWidth - margin * 2);
      const posY = margin + Math.random() * (window.innerHeight - margin * 2);

      const el = document.createElement("div");
      el.className = "meat";
      el.textContent = "🥩";
      el.style.cssText = `
        position: fixed;
        left: ${posX - radius}px;
        top: ${posY - radius}px;
        width: ${size}px;
        height: ${size}px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: ${size * 0.85}px;
        line-height: 1;
        pointer-events: none;
        z-index: 9999;
        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.25));
      `;
      document.body.appendChild(el);

      state.meats.push({
        el,
        x: posX,
        y: posY,
        r: radius,
        createdAt: performance.now(),
        ttl: 15000 + Math.random() * 15000,
        state: "meat",
        eatenAt: 0,
      });
    };

    const scheduleNextSpawn = () => {
      const delay = 600 + Math.random() * 1400;
      state.spawnTimerId = setTimeout(() => {
        if (state.destroyed) return;
        if (state.meats.length < this.MAX_MEATS) spawnMeat();
        scheduleNextSpawn();
      }, delay);
    };

    scheduleNextSpawn();

    const tick = (now) => {
      if (state.destroyed) return;
      const dt = Math.min((now - state.lastTime) / 1000, 0.032);
      state.lastTime = now;

      const k = config.stiffness;
      const c = config.damping;
      const m = config.mass;

      const fx = -k * (state.x - state.targetX) - c * state.vx;
      const fy = -k * (state.y - state.targetY) - c * state.vy;

      const ax = fx / m;
      const ay = fy / m;

      state.vx += ax * dt;
      state.vy += ay * dt;
      state.x += state.vx * dt;
      state.y += state.vy * dt;

      if (
        state.currentSize > state.baseSize &&
        now - state.lastEatAt > this.HUNGER_DELAY_MS
      ) {
        state.currentSize = Math.max(
          state.baseSize,
          state.currentSize - this.SHRINK_PER_SECOND * dt
        );
      }

      const anchorOffsetX = config.anchor.x * state.currentSize;
      const anchorOffsetY = config.anchor.y * state.currentSize;
      const left = state.x - anchorOffsetX;
      const top = state.y - anchorOffsetY;

      const nowIdle = now - state.lastMoveAt > this.IDLE_THRESHOLD_MS;
      if (nowIdle !== state.isIdle) {
        state.isIdle = nowIdle;
        if (state.isIdle && state.currentSprite !== "full") {
          img.src = "assets/grep/grep.png";
          state.currentSprite = "full";
        } else if (!state.isIdle && state.currentSprite !== "top") {
          img.src = config.imgSrc;
          state.currentSprite = "top";
        }
      }

      let angle = 0;
      if (config.rotate && !state.isIdle) {
        angle =
          Math.atan2(state.targetY - state.y, state.targetX - state.x) +
          config.angleOffset;
      }

      img.style.width = `${state.currentSize}px`;
      img.style.transform = `translate(${left}px, ${top}px) rotate(${angle}rad)`;

      if (config.debug && debug) {
        this._updateDebugOverlay(debug, state);
      }

      this._processMeats(state, now);

      state.rafId = requestAnimationFrame(tick);
    };

    state.rafId = requestAnimationFrame(tick);

    const destroy = () => {
      state.destroyed = true;

      if (state.spawnTimerId) {
        clearTimeout(state.spawnTimerId);
        state.spawnTimerId = null;
      }
      if (state.rafId) {
        cancelAnimationFrame(state.rafId);
        state.rafId = null;
      }

      this._detachEventListeners(updateTargetFromEvent, onBlur);

      state.meats.forEach((m) => {
        if (m.el && m.el.parentNode) m.el.parentNode.removeChild(m.el);
      });
      state.meats.length = 0;

      if (img && img.parentNode) img.parentNode.removeChild(img);
      if (debug && debug.svg && debug.svg.parentNode) {
        debug.svg.parentNode.removeChild(debug.svg);
      }
    };

    return { destroy };
  },

  _createRatElement(config) {
    const img = document.createElement("img");
    img.src = config.imgSrc;
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    img.decoding = "async";
    img.loading = "lazy";
    img.className = "rat-follower";
    img.style.width = `${config.size}px`;
    img.style.transformOrigin = `${config.anchor.x * 100}% ${config.anchor.y * 100}%`;
    img.style.display = "block";
    document.body.appendChild(img);
    return img;
  },

  _createDebugOverlay() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("rat-debug-overlay");
    svg.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      z-index: 10001;
    `;

    const line = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "line"
    );
    line.setAttribute("stroke", "#ff3b6b");
    line.setAttribute("stroke-width", "2");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("stroke-dasharray", "6 6");

    const anchorDot = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "circle"
    );
    anchorDot.setAttribute("r", "4");
    anchorDot.setAttribute("fill", "#35e06f");
    anchorDot.setAttribute("stroke", "#0f8a3b");
    anchorDot.setAttribute("stroke-width", "1.5");

    const targetDot = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "circle"
    );
    targetDot.setAttribute("r", "3.5");
    targetDot.setAttribute("fill", "#3aa0ff");
    targetDot.setAttribute("stroke", "#1e6fd3");
    targetDot.setAttribute("stroke-width", "1.5");

    svg.appendChild(line);
    svg.appendChild(anchorDot);
    svg.appendChild(targetDot);
    document.body.appendChild(svg);

    return { svg, line, anchorDot, targetDot };
  },

  _attachEventListeners(updateTargetFromEvent, onBlur) {
    if ("onpointermove" in window) {
      window.addEventListener("pointerdown", updateTargetFromEvent, {
        passive: true,
      });
      window.addEventListener("pointermove", updateTargetFromEvent, {
        passive: true,
      });
    } else {
      window.addEventListener("mousemove", updateTargetFromEvent, {
        passive: true,
      });
      window.addEventListener("touchstart", updateTargetFromEvent, {
        passive: true,
      });
      window.addEventListener("touchmove", updateTargetFromEvent, {
        passive: true,
      });
    }
    window.addEventListener("blur", onBlur);
  },

  _detachEventListeners(updateTargetFromEvent, onBlur) {
    if ("onpointermove" in window) {
      window.removeEventListener("pointerdown", updateTargetFromEvent);
      window.removeEventListener("pointermove", updateTargetFromEvent);
    } else {
      window.removeEventListener("mousemove", updateTargetFromEvent);
      window.removeEventListener("touchstart", updateTargetFromEvent);
      window.removeEventListener("touchmove", updateTargetFromEvent);
    }
    window.removeEventListener("blur", onBlur);
  },

  _updateDebugOverlay(debug, state) {
    debug.line.setAttribute("x1", String(state.x));
    debug.line.setAttribute("y1", String(state.y));
    debug.line.setAttribute("x2", String(state.targetX));
    debug.line.setAttribute("y2", String(state.targetY));
    debug.anchorDot.setAttribute("cx", String(state.x));
    debug.anchorDot.setAttribute("cy", String(state.y));
    debug.targetDot.setAttribute("cx", String(state.targetX));
    debug.targetDot.setAttribute("cy", String(state.targetY));
  },

  _processMeats(state, now) {
    for (let i = state.meats.length - 1; i >= 0; i--) {
      const m = state.meats[i];

      if (m.state === "meat") {
        if (now - m.createdAt > m.ttl) {
          m.el.remove();
          state.meats.splice(i, 1);
          continue;
        }

        const dx = state.x - m.x;
        const dy = state.y - m.y;
        if (
          dx * dx + dy * dy <=
          (m.r + this.EAT_RADIUS) * (m.r + this.EAT_RADIUS)
        ) {
          m.state = "bone";
          m.eatenAt = now;
          m.el.textContent = "🦴";
          m.el.style.opacity = "0.95";
          m.r = 0;

          const growth = Math.max(
            this.MIN_GROWTH,
            Math.round(state.currentSize * this.GROWTH_RATE)
          );
          state.currentSize = state.currentSize + growth;
          state.lastEatAt = now;
        }
      } else if (m.state === "bone") {
        if (now - m.eatenAt > this.BONE_DESPAWN_MS) {
          m.el.remove();
          state.meats.splice(i, 1);
        }
      }
    }
  },
};

