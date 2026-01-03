(function () {
  "use strict";

  console.info("hi");

  const ThemeManager = {
    toggle: null,
    icon: null,

    init() {
      this.toggle = document.getElementById("theme-toggle");
      this.icon = document.getElementById("theme-icon");

      if (!this.toggle || !this.icon) return;

      if (localStorage.getItem("theme") === "dark") {
        document.body.classList.add("dark-mode");
        this.icon.querySelector("use").setAttribute("href", "#icon-sun");
        this.updateLogos();
      }

      this.toggle.addEventListener("click", () => {
        const isDark = document.body.classList.toggle("dark-mode");
        localStorage.setItem("theme", isDark ? "dark" : "light");
        this.icon
          .querySelector("use")
          .setAttribute("href", isDark ? "#icon-sun" : "#icon-moon");
        this.updateLogos();
      });
    },

    updateLogos() {
      const isDark = document.body.classList.contains("dark-mode");
      const toDark = (src) =>
        src.replace(".png", "-dark.png").replace(".svg", "-dark.svg");
      const toLight = (src) =>
        src.replace("-dark.png", ".png").replace("-dark.svg", ".svg");

      document.querySelectorAll(".timeline-logo").forEach((logo) => {
        logo.src = isDark ? toDark(logo.src) : toLight(logo.src);
      });
    },
  };

  const RatFollower = {
    DEFAULTS: {
      imgSrc: "assets/grep-top.png",
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
            img.src = "assets/grep.png";
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

  const SidebarManager = {
    leftSidebar: null,
    rightSidebar: null,
    mobileToggle: null,
    rightMenuToggle: null,

    init() {
      this.mobileToggle = document.getElementById("mobile-menu-toggle");
      this.leftSidebar = document.getElementById("left-sidebar");
      this.rightMenuToggle = document.getElementById("right-menu-toggle");
      this.rightSidebar = document.getElementById("right-sidebar");

      this._initMobileToggles();
      this._initResizeHandles();
      this.updateForScreenSize();
    },

    updateForScreenSize() {
      if (this.leftSidebar && this.mobileToggle) {
        if (window.innerWidth > 1024) {
          this.leftSidebar.classList.add("mobile-open");
          this.mobileToggle.classList.add("active");
        } else {
          this.leftSidebar.classList.remove("mobile-open");
          this.mobileToggle.classList.remove("active");
        }
      }
      if (this.rightSidebar && this.rightMenuToggle) {
        if (window.innerWidth > 1280) {
          this.rightSidebar.classList.add("mobile-open");
          this.rightMenuToggle.classList.add("active");
        } else {
          this.rightSidebar.classList.remove("mobile-open");
          this.rightMenuToggle.classList.remove("active");
        }
      }
    },

    closeMobileMenus() {
      if (this.leftSidebar) {
        this.leftSidebar.classList.remove("mobile-open");
        this.mobileToggle.classList.remove("active");
      }
      if (this.rightSidebar) {
        this.rightSidebar.classList.remove("mobile-open");
        this.rightMenuToggle.classList.remove("active");
      }
    },

    _initMobileToggles() {
      if (this.mobileToggle && this.leftSidebar) {
        this.mobileToggle.addEventListener("click", () => {
          this.leftSidebar.classList.toggle("mobile-open");
          this.mobileToggle.classList.toggle("active");
        });
      }

      if (this.rightMenuToggle && this.rightSidebar) {
        this.rightMenuToggle.addEventListener("click", () => {
          this.rightSidebar.classList.toggle("mobile-open");
          this.rightMenuToggle.classList.toggle("active");
        });
      }
    },

    _initResizeHandles() {
      const leftHandle = document.getElementById("left-resize-handle");
      const rightHandle = document.getElementById("right-resize-handle");

      this._initResize(leftHandle, this.leftSidebar, true);
      this._initResize(rightHandle, this.rightSidebar, false);
    },

    _initResize(handle, sidebar, isLeft) {
      if (!handle || !sidebar) return;

      let isResizing = false;
      let startX, startWidth;

      handle.addEventListener("mousedown", (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = sidebar.offsetWidth;
        handle.classList.add("dragging");
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        e.preventDefault();
      });

      document.addEventListener("mousemove", (e) => {
        if (!isResizing) return;
        const diff = isLeft ? e.clientX - startX : startX - e.clientX;
        const newWidth = Math.max(200, Math.min(600, startWidth + diff));
        sidebar.style.width = newWidth + "px";
        const varName = isLeft
          ? "--left-sidebar-width"
          : "--right-sidebar-width";
        document.documentElement.style.setProperty(varName, newWidth + "px");
      });

      document.addEventListener("mouseup", () => {
        if (isResizing) {
          isResizing = false;
          handle.classList.remove("dragging");
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
        }
      });
    },
  };

  const SmoothScrolling = {
    init() {
      document.querySelectorAll('a[href^="#"]').forEach((link) => {
        link.addEventListener("click", (e) => {
          e.preventDefault();
          const target = document.querySelector(link.getAttribute("href"));
          if (target) {
            history.pushState(null, null, link.getAttribute("href"));
            target.scrollIntoView({ behavior: "smooth", block: "start" });

            const leftSidebar = document.getElementById("left-sidebar");
            if (leftSidebar && leftSidebar.classList.contains("mobile-open")) {
              SidebarManager.closeMobileMenus();
            }
          }
        });
      });
    },
  };

  const NotesFetcher = {
    SOURCE_URL: "https://notes.elimelt.com",
    SEARCH_API: "https://blink.tail8ab50a.ts.net:8443/notes/search",
    originalNotesHTML: "",

    init() {
      const container = document.getElementById("notes-content");
      if (container) {
        this.fetchAndDisplay();
        this._initSearch();
      }
    },

    async fetchAndDisplay() {
      try {
        const response = await fetch(this.SOURCE_URL);
        if (!response.ok) {
          throw new Error(`Failed to fetch notes: ${response.statusText}`);
        }

        const text = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, "text/html");
        const notesContainer = doc.querySelector(".recent-posts");

        if (!notesContainer) {
          throw new Error("Notes container not found in fetched HTML");
        }

        const links = notesContainer.querySelectorAll("a");
        links.forEach((link) => {
          const href = link.getAttribute("href");
          if (href && !href.startsWith("http")) {
            link.setAttribute("href", this.SOURCE_URL + href);
          }
        });

        const container = document.getElementById("notes-content");
        container.innerHTML = notesContainer.innerHTML;
        this._styleNoteItems();
        this.originalNotesHTML = container.innerHTML;
      } catch (error) {
        console.error("Error fetching notes:", error);
        document.getElementById("notes-content").innerHTML =
          '<li class="note-item">Unable to load notes. Please try again later.</li>';
      }
    },

    _initSearch() {
      const input = document.getElementById("notes-search-input");
      const btn = document.getElementById("notes-search-btn");

      if (!input || !btn) return;

      const doSearch = () => this._search(input.value);

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") doSearch();
      });
      btn.addEventListener("click", doSearch);
    },

    async _search(query) {
      const container = document.getElementById("notes-content");
      if (!query.trim()) {
        if (this.originalNotesHTML) {
          container.innerHTML = this.originalNotesHTML;
        }
        return;
      }

      container.innerHTML = '<li class="note-item"><p class="notes-placeholder">Searching...</p></li>';

      try {
        const params = new URLSearchParams({ q: query, mode: "fulltext", limit: "20" });
        const response = await fetch(`${this.SEARCH_API}?${params}`);

        if (!response.ok) {
          throw new Error(`Search failed: ${response.statusText}`);
        }

        const data = await response.json();
        const results = data.results || [];

        if (results.length === 0) {
          container.innerHTML = '<li class="note-item"><p class="notes-error">No results found.</p></li>';
          return;
        }

        container.innerHTML = results.map((note) => `
          <li class="note-item">
            <a href="${this.SOURCE_URL}/${note.slug || note.id}" target="_blank" rel="noopener" class="note-link">${note.title}</a>
            <div class="note-meta">
              <span class="note-date">${note.created_at ? new Date(note.created_at).toLocaleDateString() : ""}</span>
              ${note.category ? `<span class="note-category">${note.category}</span>` : ""}
            </div>
          </li>
        `).join("");
      } catch (error) {
        console.error("Error searching notes:", error);
        container.innerHTML = '<li class="note-item"><p class="notes-error">Search failed. Please try again.</p></li>';
      }
    },

    _styleNoteItems() {
      const noteItems = document.querySelectorAll("#notes-content li");
      noteItems.forEach((item) => {
        item.classList.add("note-item");

        const link = item.querySelector("a");
        if (link) {
          link.classList.add("note-link");
          try {
            const href = link.getAttribute("href") || "";
            const text = (link.textContent || "").trim();
            link.setAttribute("data-analytics", "notes.link");
            if (href) link.setAttribute("data-analytics-id", `note:${href}`);
            if (text) link.setAttribute("data-analytics-label", text);
            link.setAttribute("data-analytics-group", "notes");
          } catch {}
        }

        const date = item.querySelector(".date");
        if (date) date.classList.add("note-date");

        const category = item.querySelector(".category");
        if (category) category.classList.add("note-category");

        if (date && category) {
          const metaDiv = document.createElement("div");
          metaDiv.classList.add("note-meta");

          date.parentNode.insertBefore(metaDiv, date);
          metaDiv.appendChild(date);
          metaDiv.appendChild(category);
        }
      });
    },
  };

  const MeatGameToggle = {
    toggle: null,
    ratController: null,

    RAT_CONFIG: {
      anchor: { x: 0.5, y: 0.0 },
      size: 76,
      angleOffset: Math.PI / 2,
    },

    init() {
      this.toggle = document.getElementById("meat-toggle");
      if (!this.toggle) return;

      const enabledByDefault = localStorage.getItem("meatGame") === "true";
      if (enabledByDefault) {
        this.ratController = RatFollower.create(this.RAT_CONFIG) || null;
      }

      this._updateUI(!!this.ratController);

      this.toggle.addEventListener("click", () => {
        const isEnabled = !!this.ratController;
        if (isEnabled) {
          this.ratController.destroy();
          this.ratController = null;
          localStorage.setItem("meatGame", "false");
          this._updateUI(false);
        } else {
          this.ratController = RatFollower.create(this.RAT_CONFIG) || null;
          localStorage.setItem("meatGame", "true");
          this._updateUI(!!this.ratController);
        }
      });
    },

    _updateUI(enabled) {
      if (!this.toggle) return;
      this.toggle.setAttribute("aria-pressed", enabled ? "true" : "false");
      this.toggle.title = enabled
        ? "Disable rat meat game"
        : "Enable rat meat game";
      this.toggle.classList.toggle("meat-active", !!enabled);
    },
  };

  document.addEventListener("DOMContentLoaded", () => {
    ThemeManager.init();
    SidebarManager.init();
    SmoothScrolling.init();
    NotesFetcher.init();
    MeatGameToggle.init();
  });
})();
