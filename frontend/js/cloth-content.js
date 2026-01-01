import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import html2canvas from "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm";

// ============================================================================
// Physics Configuration Constants
// ============================================================================
const PHYSICS_CONFIG = {
  // Simulation parameters
  DAMPING: 0.97,
  GRAVITY: 0.0004,
  TIMESTEP_SQ: 0.5,
  CONSTRAINT_ITERATIONS: 4,

  // Restoration forces
  REST_FORCE_XY: 0.02,
  REST_FORCE_Z: 0.9,

  // Ceiling roll effect
  ROLL_RADIUS: 40,
  ROLL_Y_SCALE: 0.2,
  ROLL_Z_SCALE: 0.3,
  ROLL_Z_OFFSET: 10,
  ROLL_MAX_ANGLE: Math.PI * 0.8,

  // Interaction
  FIND_NEAREST_MAX_DIST: 100,
};

const CLOTH_CONTENT_CONFIG = {
  RECAPTURE_DELAY_MS: 2000,
  DEFAULT_WIDTH: 720,
  RESIZE_THRESHOLD: 10,
  DRAG_THRESHOLD: 10,
};

class ClothPhysics {
  /**
   * Creates a new cloth physics simulation.
   * @param {number} width - The width of the cloth
   * @param {number} height - The height of the cloth
   * @param {number} [segmentsX=20] - Number of horizontal segments
   */
  constructor(width, height, segmentsX = 20) {
    this.width = width;
    this.height = height;
    this.segmentsX = segmentsX;
    this.segmentsY = Math.round(segmentsX * (height / width));

    this.particles = [];
    this.constraints = [];

    // Pre-allocate reusable vectors to avoid garbage collection
    this._tempVel = new THREE.Vector3();
    this._tempDiff = new THREE.Vector3();
    this._tempCorrection = new THREE.Vector3();

    this._initParticles();
    this._initConstraints();
  }

  /**
   * Initializes particles in a grid formation.
   * @private
   */
  _initParticles() {
    const startX = -this.width / 2;
    const startY = this.height / 2;
    const segW = this.width / this.segmentsX;
    const segH = this.height / this.segmentsY;

    for (let y = 0; y <= this.segmentsY; y++) {
      for (let x = 0; x <= this.segmentsX; x++) {
        const px = startX + x * segW;
        const py = startY - y * segH;
        this.particles.push({
          pos: new THREE.Vector3(px, py, 0),
          prev: new THREE.Vector3(px, py, 0),
          restX: px,
          restY: py,
          pinned: y === 0,
          dragging: false,
        });
      }
    }
  }

  /**
   * Creates structural, shear, and bend constraints between particles.
   * @private
   */
  _initConstraints() {
    const cols = this.segmentsX + 1;
    const segW = this.width / this.segmentsX;
    const segH = this.height / this.segmentsY;
    const diag = Math.sqrt(segW * segW + segH * segH);

    for (let y = 0; y <= this.segmentsY; y++) {
      for (let x = 0; x <= this.segmentsX; x++) {
        const i = y * cols + x;
        if (x < this.segmentsX)
          this.constraints.push({ p1: i, p2: i + 1, rest: segW });
        if (y < this.segmentsY)
          this.constraints.push({ p1: i, p2: i + cols, rest: segH });
        if (x < this.segmentsX && y < this.segmentsY) {
          this.constraints.push({ p1: i, p2: i + cols + 1, rest: diag });
          this.constraints.push({ p1: i + 1, p2: i + cols, rest: diag });
        }
      }
    }
  }

  /**
   * Runs one simulation step: Verlet integration, boundary handling, and constraint solving.
   */
  simulate() {
    const ceilingY = this.height / 2;
    const floorY = -this.height / 2;

    // Verlet integration with forces
    this._integrateParticles(ceilingY, floorY);

    // Solve constraints iteratively
    this._solveConstraints();
  }

  /**
   * Applies Verlet integration and boundary handling to all particles.
   * @private
   * @param {number} ceilingY - Upper boundary Y coordinate
   * @param {number} floorY - Lower boundary Y coordinate
   */
  _integrateParticles(ceilingY, floorY) {
    const { DAMPING, GRAVITY, TIMESTEP_SQ, REST_FORCE_XY, REST_FORCE_Z } =
      PHYSICS_CONFIG;
    const { ROLL_RADIUS, ROLL_Y_SCALE, ROLL_Z_SCALE, ROLL_Z_OFFSET, ROLL_MAX_ANGLE } =
      PHYSICS_CONFIG;

    for (const p of this.particles) {
      if (p.pinned || p.dragging) continue;

      // Calculate velocity using pre-allocated vector (avoid GC)
      this._tempVel.copy(p.pos).sub(p.prev).multiplyScalar(DAMPING);
      p.prev.copy(p.pos);
      p.pos.add(this._tempVel);

      // Apply gravity and restoration forces
      p.pos.y -= GRAVITY * TIMESTEP_SQ;
      p.pos.y += (p.restY - p.pos.y) * REST_FORCE_XY;
      p.pos.x += (p.restX - p.pos.x) * REST_FORCE_XY;
      p.pos.z *= REST_FORCE_Z;

      // Ceiling roll effect
      if (p.pos.y > ceilingY) {
        const excess = p.pos.y - ceilingY;
        const angle = Math.min(excess / ROLL_RADIUS, ROLL_MAX_ANGLE);
        p.pos.y = ceilingY + Math.sin(angle) * ROLL_RADIUS * ROLL_Y_SCALE;
        p.pos.z = -Math.cos(angle) * ROLL_RADIUS * ROLL_Z_SCALE - ROLL_Z_OFFSET;
      }

      // Floor collision
      if (p.pos.y < floorY) {
        p.pos.y = floorY;
        p.prev.y = floorY;
      }
    }
  }

  /**
   * Iteratively solves distance constraints to maintain cloth structure.
   * Uses pre-allocated vectors to minimize garbage collection.
   * @private
   */
  _solveConstraints() {
    const iterations = PHYSICS_CONFIG.CONSTRAINT_ITERATIONS;

    for (let iter = 0; iter < iterations; iter++) {
      for (const c of this.constraints) {
        const p1 = this.particles[c.p1];
        const p2 = this.particles[c.p2];
        if (p1.dragging && p2.dragging) continue;

        // Use pre-allocated vector for difference calculation
        this._tempDiff.copy(p2.pos).sub(p1.pos);
        const dist = this._tempDiff.length();
        if (dist === 0) continue;

        // Calculate correction using pre-allocated vector
        const correctionFactor = (dist - c.rest) / dist / 2;
        this._tempCorrection.copy(this._tempDiff).multiplyScalar(correctionFactor);

        if (!p1.pinned && !p1.dragging) p1.pos.add(this._tempCorrection);
        if (!p2.pinned && !p2.dragging) p2.pos.sub(this._tempCorrection);
      }
    }
  }

  /**
   * Finds the nearest non-pinned particle to a given point.
   * @param {number} x - X coordinate in world space
   * @param {number} y - Y coordinate in world space
   * @param {number} [maxDist] - Maximum distance to search (uses config default)
   * @returns {Object|null} The nearest particle, or null if none found within maxDist
   */
  findNearest(x, y, maxDist = PHYSICS_CONFIG.FIND_NEAREST_MAX_DIST) {
    let nearest = null;
    let minDistSq = maxDist * maxDist;

    for (const p of this.particles) {
      if (p.pinned) continue;
      const distSq = (p.pos.x - x) ** 2 + (p.pos.y - y) ** 2;
      if (distSq < minDistSq) {
        minDistSq = distSq;
        nearest = p;
      }
    }

    return nearest;
  }
}

/**
 * Handles Three.js rendering of the cloth simulation.
 * Creates and manages the WebGL renderer, scene, camera, and mesh.
 */
class ClothRenderer {
  /**
   * Creates a new cloth renderer.
   * @param {ShadowRoot} shadowRoot - The shadow DOM root to attach the canvas to
   * @param {HTMLCanvasElement} texture - The canvas to use as cloth texture
   * @param {ClothPhysics} physics - The physics simulation to render
   */
  constructor(shadowRoot, texture, physics) {
    this.shadowRoot = shadowRoot;
    this.physics = physics;
    this.scale = window.devicePixelRatio || 2;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(
      -physics.width / 2,
      physics.width / 2,
      physics.height / 2,
      -physics.height / 2,
      1,
      2000
    );
    this.camera.position.z = 500;

    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(this.scale);
    this.renderer.setSize(physics.width, physics.height);
    this.renderer.domElement.style.pointerEvents = "auto";
    shadowRoot.appendChild(this.renderer.domElement);

    this.texture = new THREE.CanvasTexture(texture);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;

    this.geometry = new THREE.PlaneGeometry(
      physics.width,
      physics.height,
      physics.segmentsX,
      physics.segmentsY
    );
    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      side: THREE.DoubleSide,
      transparent: true,
      alphaTest: 0.01,
    });
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.scene.add(this.mesh);
  }

  /**
   * Updates the mesh geometry from physics particles and renders the scene.
   */
  update() {
    const positions = this.geometry.attributes.position.array;
    for (let i = 0; i < this.physics.particles.length; i++) {
      positions[i * 3] = this.physics.particles[i].pos.x;
      positions[i * 3 + 1] = this.physics.particles[i].pos.y;
      positions[i * 3 + 2] = this.physics.particles[i].pos.z;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Updates the cloth texture with a new canvas.
   * @param {HTMLCanvasElement} canvas - The new texture canvas
   */
  updateTexture(canvas) {
    this.texture.image = canvas;
    this.texture.needsUpdate = true;
  }

  /**
   * Disposes of all Three.js resources.
   */
  dispose() {
    this.renderer.dispose();
    this.geometry.dispose();
    this.texture.dispose();
  }
}

// ============================================================================
// ClothContent Web Component
// ============================================================================

/**
 * A custom element that renders its content as an interactive cloth simulation.
 * Supports dragging, theme changes, and responsive resizing.
 *
 * @example
 * <cloth-content wiggle="true">
 *   <p>Content to render as cloth</p>
 * </cloth-content>
 */
class ClothContent extends HTMLElement {
  static get observedAttributes() {
    return ["wiggle"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.initialized = false;
  }

  // --------------------------------------------------------------------------
  // Lifecycle Methods
  // --------------------------------------------------------------------------

  connectedCallback() {
    this.wiggleEnabled = this.getAttribute("wiggle") === "true";
    this._init();
  }

  attributeChangedCallback(name, _old, val) {
    if (name === "wiggle" && this.initialized) this.setWiggle(val === "true");
  }

  disconnectedCallback() {
    this._cleanup();
    if (this.liveContent?.parentNode)
      this.liveContent.parentNode.removeChild(this.liveContent);
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  /**
   * Initializes the component, setting up content and styles.
   * @private
   */
  async _init() {
    this.width = this.offsetWidth || CLOTH_CONTENT_CONFIG.DEFAULT_WIDTH;
    this.liveContent = document.createElement("div");
    while (this.firstChild) this.liveContent.appendChild(this.firstChild);

    this._setupStyles();
    this._setupToggle();

    if (!this.wiggleEnabled) {
      this._showHTML();
      this.initialized = true;
      return;
    }

    await this._showCloth();
    this.initialized = true;
  }

  /**
   * Copies document stylesheets into the shadow DOM for proper rendering.
   * @private
   */
  _setupStyles() {
    for (const sheet of document.styleSheets) {
      try {
        if (sheet.href) {
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = sheet.href;
          this.shadowRoot.appendChild(link);
        } else if (sheet.cssRules) {
          const style = document.createElement("style");
          style.textContent = Array.from(sheet.cssRules)
            .map((r) => r.cssText)
            .join("\n");
          this.shadowRoot.appendChild(style);
        }
      } catch (e) {
        // CORS or other security restrictions may prevent accessing some stylesheets
      }
    }
  }

  /**
   * Creates the wiggle toggle checkbox for desktop users.
   * @private
   */
  _setupToggle() {
    const isMobile =
      /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints > 1 &&
        !window.matchMedia("(pointer: fine)").matches);
    if (isMobile) return;

    const label = document.createElement("label");
    label.className = "toggle";
    label.innerHTML = `<input type="checkbox" ${
      this.wiggleEnabled ? "checked" : ""
    }/> wiggle`;
    this.checkbox = label.querySelector("input");
    this.checkbox.addEventListener("change", () =>
      this.setWiggle(this.checkbox.checked)
    );
    this.shadowRoot.appendChild(label);
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Enables or disables the cloth simulation.
   * @param {boolean} enabled - Whether to enable the cloth effect
   */
  setWiggle(enabled) {
    this.wiggleEnabled = enabled;
    if (this.checkbox) this.checkbox.checked = enabled;
    enabled ? this._showCloth() : this._showHTML();
  }

  // --------------------------------------------------------------------------
  // Display Mode Switching
  // --------------------------------------------------------------------------

  /**
   * Switches to showing normal HTML content (no cloth simulation).
   * @private
   */
  _showHTML() {
    this._cleanup();
    this.shadowRoot.querySelector("canvas")?.remove();
    this.liveContent.style.cssText = "";
    this.liveContent.className = "content";
    if (this.liveContent.parentNode === document.body)
      document.body.removeChild(this.liveContent);
    this.shadowRoot.appendChild(this.liveContent);
  }

  /**
   * Switches to cloth simulation mode with full initialization.
   * @private
   */
  async _showCloth() {
    if (this.liveContent.parentNode === this.shadowRoot)
      this.shadowRoot.removeChild(this.liveContent);
    this._captureComputedColors();
    this._moveLiveContentOffscreen();

    await new Promise((r) => requestAnimationFrame(r));
    await document.fonts.ready;

    try {
      const canvas = await this._capture();
      this.physics = new ClothPhysics(this.contentWidth, this.contentHeight);
      this.clothRenderer = new ClothRenderer(
        this.shadowRoot,
        canvas,
        this.physics
      );
      this._setupInteraction();
      this._setupResizeObserver();
      this._setupThemeObserver();
      this._animate();
      setTimeout(() => this._recapture(), CLOTH_CONTENT_CONFIG.RECAPTURE_DELAY_MS);
    } catch (e) {
      console.error("Cloth failed:", e, {
        width: this.width,
        contentWidth: this.contentWidth,
        contentHeight: this.contentHeight,
      });
      this._showHTML();
    }
  }

  // --------------------------------------------------------------------------
  // Content Capture
  // --------------------------------------------------------------------------

  /**
   * Captures computed styles for proper color rendering in the texture.
   * @private
   */
  _captureComputedColors() {
    const self = getComputedStyle(this);
    this.computedColors = {
      text: self.color,
      font: self.fontFamily,
      fontSize: self.fontSize,
      lineHeight: self.lineHeight,
      links: [],
    };
    this.liveContent.querySelectorAll("a").forEach((a) => {
      this.computedColors.links.push({
        el: a,
        color: getComputedStyle(a).color,
      });
    });
  }

  /**
   * Moves the live content offscreen for capture without affecting layout.
   * @private
   */
  _moveLiveContentOffscreen() {
    this.liveContent.style.cssText = `
      position: fixed; left: -9999px; top: 0; width: ${
        this.width
      }px; padding: 0;
      background: transparent; color: ${this.computedColors.text};
      font-family: ${this.computedColors.font || "system-ui"};
      font-size: ${this.computedColors.fontSize || "16px"};
      line-height: ${this.computedColors.lineHeight || "1.5"};
    `;

    this.computedColors.links.forEach(({ el, color }) => {
      el.style.color = color;
    });

    if (!this.liveContent.parentNode)
      document.body.appendChild(this.liveContent);
  }

  /**
   * Captures the live content to a canvas for use as cloth texture.
   * @private
   * @returns {Promise<HTMLCanvasElement>} The captured canvas
   * @throws {Error} If the captured dimensions are zero
   */
  async _capture() {
    const canvas = await html2canvas(this.liveContent, {
      backgroundColor: null,
      scale: window.devicePixelRatio || 2,
      useCORS: true,
      logging: false,
    });
    this.contentWidth = this.liveContent.offsetWidth;
    this.contentHeight = this.liveContent.offsetHeight;
    if (!this.contentWidth || !this.contentHeight)
      throw new Error("Zero dimensions");
    return canvas;
  }

  /**
   * Re-captures the content to update the cloth texture.
   * Prevents concurrent recaptures with a guard flag.
   * @private
   */
  async _recapture() {
    if (this.isRecapturing || !this.clothRenderer) return;
    this.isRecapturing = true;
    try {
      const canvas = await this._capture();
      this.clothRenderer.updateTexture(canvas);
    } catch (e) {
      // Silently fail on recapture errors - the cloth continues with existing texture
    }
    this.isRecapturing = false;
  }

  // --------------------------------------------------------------------------
  // User Interaction
  // --------------------------------------------------------------------------

  /**
   * Sets up mouse and touch event handlers for cloth dragging.
   * @private
   */
  _setupInteraction() {
    const toWorld = (e) => {
      const rect = this.getBoundingClientRect();
      const cx = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
      const cy = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
      return {
        x: ((cx - rect.left) / rect.width - 0.5) * this.physics.width,
        y: (0.5 - (cy - rect.top) / rect.height) * this.physics.height,
      };
    };

    let dragP = null;
    this.addEventListener("mousedown", (e) => {
      dragP = this.physics.findNearest(toWorld(e).x, toWorld(e).y);
      if (dragP) dragP.dragging = true;
    });
    this.addEventListener("mousemove", (e) => {
      if (dragP) {
        const p = toWorld(e);
        dragP.pos.x = dragP.prev.x = p.x;
        dragP.pos.y = dragP.prev.y = p.y;
      }
    });
    const endMouse = () => {
      if (dragP) dragP.dragging = false;
      dragP = null;
    };
    this.addEventListener("mouseup", endMouse);
    this.addEventListener("mouseleave", endMouse);

    let touchP = null,
      touchStart = { x: 0, y: 0 },
      isTouchDrag = false;
    this.addEventListener(
      "touchstart",
      (e) => {
        touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        touchP = this.physics.findNearest(toWorld(e).x, toWorld(e).y);
        isTouchDrag = false;
      },
      { passive: true }
    );
    this.addEventListener(
      "touchmove",
      (e) => {
        if (!touchP) return;
        const dx = Math.abs(e.touches[0].clientX - touchStart.x),
          dy = Math.abs(e.touches[0].clientY - touchStart.y);
        if (!isTouchDrag && dx > CLOTH_CONTENT_CONFIG.DRAG_THRESHOLD && dx > dy) {
          isTouchDrag = true;
          touchP.dragging = true;
        }
        if (isTouchDrag) {
          e.preventDefault();
          const p = toWorld(e);
          touchP.pos.x = touchP.prev.x = p.x;
          touchP.pos.y = touchP.prev.y = p.y;
        }
      },
      { passive: false }
    );
    this.addEventListener("touchend", () => {
      if (touchP) touchP.dragging = false;
      touchP = null;
      isTouchDrag = false;
    });
  }

  // --------------------------------------------------------------------------
  // Observers and Event Handlers
  // --------------------------------------------------------------------------

  /**
   * Sets up a ResizeObserver to handle window/container resizing.
   * @private
   */
  _setupResizeObserver() {
    const target =
      document.querySelector(".main-content") || this.parentElement || this;
    this.resizeObserver = new ResizeObserver(() => {
      const newW = this.offsetWidth;
      if (newW > 0 && Math.abs(newW - this.width) > CLOTH_CONTENT_CONFIG.RESIZE_THRESHOLD) {
        this._handleResize();
      }
    });
    this.resizeObserver.observe(target);
  }

  /**
   * Sets up a MutationObserver to detect theme changes.
   * @private
   */
  _setupThemeObserver() {
    this.themeObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === "class" && this.wiggleEnabled) {
          this._handleThemeChange();
          break;
        }
      }
    });
    this.themeObserver.observe(document.body, { attributes: true });
  }

  /**
   * Handles theme changes by recapturing the content with new styles.
   * @private
   */
  async _handleThemeChange() {
    if (this.isChangingTheme || !this.clothRenderer) return;
    this.isChangingTheme = true;

    if (this.liveContent.parentNode === document.body) {
      document.body.removeChild(this.liveContent);
    }
    this.shadowRoot.appendChild(this.liveContent);
    this.liveContent.style.cssText = "";

    await new Promise((r) => requestAnimationFrame(r));
    this._captureComputedColors();
    this._moveLiveContentOffscreen();

    await new Promise((r) => requestAnimationFrame(r));
    try {
      const canvas = await this._capture();
      this.clothRenderer.updateTexture(canvas);
    } catch (e) {
      // Silently fail on theme change errors - the cloth continues with existing texture
    }
    this.isChangingTheme = false;
  }

  /**
   * Handles window/container resize by recreating the cloth simulation.
   * @private
   */
  async _handleResize() {
    if (this.isResizing) return;
    this.isResizing = true;
    this._cleanup();
    this.width = this.offsetWidth || CLOTH_CONTENT_CONFIG.DEFAULT_WIDTH;
    this.liveContent.style.width = this.width + "px";
    await new Promise((r) => requestAnimationFrame(r));
    try {
      const canvas = await this._capture();
      this.physics = new ClothPhysics(this.contentWidth, this.contentHeight);
      this.clothRenderer = new ClothRenderer(
        this.shadowRoot,
        canvas,
        this.physics
      );
      this._setupInteraction();
      this._animate();
    } catch (e) {
      // Silently fail on resize errors - component will remain in previous state
    }
    this.isResizing = false;
  }

  // --------------------------------------------------------------------------
  // Animation Loop
  // --------------------------------------------------------------------------

  /**
   * Main animation loop that runs the physics simulation and renders the cloth.
   * @private
   */
  _animate() {
    if (!this.isConnected || !this.physics) return;
    this.animationId = requestAnimationFrame(() => this._animate());
    this.physics.simulate();
    this.clothRenderer.update();
  }

  // --------------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------------

  /**
   * Cleans up all resources, observers, and animation frames.
   * @private
   */
  _cleanup() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.themeObserver) {
      this.themeObserver.disconnect();
      this.themeObserver = null;
    }
    if (this.clothRenderer) {
      this.clothRenderer.dispose();
      this.clothRenderer = null;
    }
    this.physics = null;
  }
}

customElements.define("cloth-content", ClothContent);
