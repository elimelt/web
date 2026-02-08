import * as THREE from 'three';

const PHOTOS = [
  'assets/grep/grep.png',
  'assets/grep/grep-top.png',
  'assets/grep/grep-cherish.png',
  'assets/grep/grep-curious.png',
  'assets/grep/grep-play.png',
  'assets/grep/grep-side.png',
];

const HALF = 3;
const SIDE = HALF * 2;
const MASS = 1;
const INERTIA = (MASS * SIDE * SIDE) / 6;
const INV_INERTIA = 1 / INERTIA;
const TEX_RES = 1024;
const GRAVITY = -80;
const FLOOR_Y = -5;
const RESTITUTION = 0.35;
const CONTACT_STIFFNESS = 1500;
const CONTACT_DAMPING_COEFF = 25;
const FRICTION_COEFF = 0.4;
const SETTLE_THRESHOLD = 0.15;
const WALL = 12;

const LOCAL_CORNERS = [];
for (let x = -1; x <= 1; x += 2)
  for (let y = -1; y <= 1; y += 2)
    for (let z = -1; z <= 1; z += 2)
      LOCAL_CORNERS.push(new THREE.Vector3(x * HALF, y * HALF, z * HALF));

export const DiceGame = {
  scene: null,
  camera: null,
  renderer: null,
  cube: null,
  geometry: null,
  rafId: null,
  rolling: false,
  vel: null,
  angVel: null,
  lastTime: 0,
  settleFrames: 0,

  init() {
    this.overlay = document.getElementById('dice-overlay');
    this.canvas = document.getElementById('dice-canvas');
    this.popup = document.getElementById('dice-popup');
    this.popupBtn = document.getElementById('dice-popup-btn');
    this.sidebarBtn = document.getElementById('dice-toggle');
    if (!this.overlay || !this.canvas) return;

    this._initThree();
    this._loadTextures();

    const hasRolled = localStorage.getItem('diceRolled') === 'true';

    if (hasRolled) {
      this.popup.style.display = 'none';
      this.sidebarBtn.style.display = '';
    } else {
      this.popup.style.display = '';
      this.sidebarBtn.style.display = 'none';
      this._showOverlay();
    }

    this.overlay.addEventListener('click', () => {
      if (this.popup.style.display !== 'none') {
        this._onFirstRoll();
      } else {
        this._hideOverlay();
      }
    });
    this.sidebarBtn.addEventListener('click', () => this._showAndRoll());
  },

  _initThree() {
    this.scene = new THREE.Scene();

    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 200);
    this.camera.position.set(0, 22, 36);
    this.camera.lookAt(0, 3, 0);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
    });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    window.addEventListener('resize', () => this._onResize());
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const ambient = new THREE.AmbientLight(0xffffff, 1.2);
    this.scene.add(ambient);

    const dir = new THREE.DirectionalLight(0xffffff, 1.5);
    dir.position.set(8, 20, 12);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.near = 1;
    dir.shadow.camera.far = 60;
    dir.shadow.camera.left = -15;
    dir.shadow.camera.right = 15;
    dir.shadow.camera.top = 15;
    dir.shadow.camera.bottom = -15;
    this.scene.add(dir);

    const floorGeo = new THREE.PlaneGeometry(60, 60);
    const floorMat = new THREE.ShadowMaterial({ opacity: 0.35 });
    this.floor = new THREE.Mesh(floorGeo, floorMat);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = FLOOR_Y;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    const placeholders = PHOTOS.map(
      () => new THREE.MeshStandardMaterial({ color: 0x222222 })
    );
    this.geometry = new THREE.BoxGeometry(HALF * 2, HALF * 2, HALF * 2);
    this.cube = new THREE.Mesh(this.geometry, placeholders);
    this.cube.castShadow = true;
    this.cube.position.set(0, 8, 0);
    this.scene.add(this.cube);

    this.vel = new THREE.Vector3();
    this.angVel = new THREE.Vector3();

    this.renderer.render(this.scene, this.camera);
  },

  _loadTextures() {
    PHOTOS.forEach((src, i) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = TEX_RES;
        canvas.height = TEX_RES;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#222222';
        ctx.fillRect(0, 0, TEX_RES, TEX_RES);

        const aspect = img.width / img.height;
        let dw, dh;
        if (aspect > 1) {
          dw = TEX_RES;
          dh = TEX_RES / aspect;
        } else {
          dh = TEX_RES;
          dw = TEX_RES * aspect;
        }
        ctx.drawImage(img, (TEX_RES - dw) / 2, (TEX_RES - dh) / 2, dw, dh);

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        const mat = new THREE.MeshStandardMaterial({ map: tex });
        const old = this.cube.material[i];
        this.cube.material[i] = mat;
        old.dispose();
        this.renderer.render(this.scene, this.camera);
      };
      img.src = src;
    });
  },

  _showOverlay() {
    this.overlay.classList.add('dice-visible');
  },

  _hideOverlay() {
    this.overlay.classList.remove('dice-visible');
    this._stopAnimation();
  },

  _onFirstRoll() {
    localStorage.setItem('diceRolled', 'true');
    this.popup.style.display = 'none';
    this.sidebarBtn.style.display = '';
    this._roll();
  },

  _showAndRoll() {
    this._showOverlay();
    this._roll();
  },

  _roll() {
    if (this.rolling) return;
    this.rolling = true;
    this.settleFrames = 0;

    this.cube.position.set(
      (Math.random() - 0.5) * 4,
      14 + Math.random() * 3,
      (Math.random() - 0.5) * 4
    );

    this.vel.set(
      (Math.random() - 0.5) * 20,
      12 + Math.random() * 8,
      (Math.random() - 0.5) * 20
    );

    this.angVel.set(
      (Math.random() - 0.5) * 30,
      (Math.random() - 0.5) * 30,
      (Math.random() - 0.5) * 30
    );

    this.cube.rotation.set(
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2
    );

    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(() => this._simulate());
  },

  _simulate() {
    const now = performance.now();
    const rawDt = Math.min((now - this.lastTime) / 1000, 0.033);
    this.lastTime = now;

    const substeps = 8;
    const dt = rawDt / substeps;

    for (let step = 0; step < substeps; step++) {
      this.vel.y += GRAVITY * dt;
      this.cube.position.addScaledVector(this.vel, dt);

      const q = this.cube.quaternion.clone();
      const dq = new THREE.Quaternion(
        this.angVel.x * dt * 0.5,
        this.angVel.y * dt * 0.5,
        this.angVel.z * dt * 0.5,
        0
      );
      dq.multiply(q);
      q.x += dq.x;
      q.y += dq.y;
      q.z += dq.z;
      q.w += dq.w;
      q.normalize();
      this.cube.quaternion.copy(q);

      const totalForce = new THREE.Vector3();
      const totalTorque = new THREE.Vector3();
      let contactCount = 0;

      for (const lc of LOCAL_CORNERS) {
        const wc = lc.clone().applyQuaternion(q).add(this.cube.position);
        const depth = FLOOR_Y - wc.y;
        if (depth <= 0) continue;
        contactCount++;

        const r = wc.clone().sub(this.cube.position);
        const cornerVel = this.vel.clone().add(
          new THREE.Vector3().crossVectors(this.angVel, r)
        );

        let fn = CONTACT_STIFFNESS * depth - CONTACT_DAMPING_COEFF * cornerVel.y;
        if (fn <= 0) continue;

        totalForce.y += fn;

        const tangentSpeed = Math.sqrt(
          cornerVel.x * cornerVel.x + cornerVel.z * cornerVel.z
        );
        if (tangentSpeed > 0.01) {
          const ft = Math.min(FRICTION_COEFF * fn, tangentSpeed * MASS / dt);
          totalForce.x -= (cornerVel.x / tangentSpeed) * ft;
          totalForce.z -= (cornerVel.z / tangentSpeed) * ft;
        }

        const contactForce = new THREE.Vector3(
          totalForce.x, fn, totalForce.z
        );
        totalTorque.add(new THREE.Vector3().crossVectors(r, contactForce));
      }

      this.vel.addScaledVector(totalForce, dt / MASS);
      this.angVel.addScaledVector(totalTorque, dt * INV_INERTIA);

      for (const axis of ['x', 'z']) {
        if (this.cube.position[axis] > WALL) {
          this.cube.position[axis] = WALL;
          this.vel[axis] = -Math.abs(this.vel[axis]) * RESTITUTION;
        } else if (this.cube.position[axis] < -WALL) {
          this.cube.position[axis] = -WALL;
          this.vel[axis] = Math.abs(this.vel[axis]) * RESTITUTION;
        }
      }

      if (contactCount > 0) {
        this.vel.x *= 0.998;
        this.vel.z *= 0.998;
        this.angVel.multiplyScalar(0.998);
      }
    }

    this.renderer.render(this.scene, this.camera);

    const speed = this.vel.length();
    const spin = this.angVel.length();
    const lowestCornerY = Math.min(
      ...LOCAL_CORNERS.map(
        (lc) => lc.clone().applyQuaternion(this.cube.quaternion)
          .add(this.cube.position).y
      )
    );
    const onFloor = lowestCornerY < FLOOR_Y + 0.3;

    if (onFloor && speed < SETTLE_THRESHOLD && spin < SETTLE_THRESHOLD) {
      this.settleFrames++;
      if (this.settleFrames > 30) {
        this.rolling = false;
        this.rafId = null;
        this._snapToFace();
        return;
      }
    } else {
      this.settleFrames = 0;
    }

    this.rafId = requestAnimationFrame(() => this._simulate());
  },

  _snapToFace() {
    const up = new THREE.Vector3(0, 1, 0);
    const axes = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, -1),
    ];

    let best = -Infinity;
    let bestIdx = 2;
    for (let i = 0; i < axes.length; i++) {
      const world = axes[i].clone().applyQuaternion(this.cube.quaternion);
      const dot = world.dot(up);
      if (dot > best) {
        best = dot;
        bestIdx = i;
      }
    }

    const worldUp = axes[bestIdx].clone().applyQuaternion(this.cube.quaternion);
    const correctionQ = new THREE.Quaternion().setFromUnitVectors(worldUp, up);
    const targetQ = correctionQ.multiply(this.cube.quaternion).normalize();

    const startQ = this.cube.quaternion.clone();
    const startTime = performance.now();
    const duration = 300;

    const snapAnimate = () => {
      const t = Math.min((performance.now() - startTime) / duration, 1);
      const ease = t * (2 - t);
      this.cube.quaternion.slerpQuaternions(startQ, targetQ, ease);
      this.renderer.render(this.scene, this.camera);
      if (t < 1) {
        this.rafId = requestAnimationFrame(snapAnimate);
      } else {
        this.rafId = null;
        this._downloadPhoto(bestIdx);
      }
    };
    this.rafId = requestAnimationFrame(snapAnimate);
  },

  _downloadPhoto(faceIdx) {
    const src = PHOTOS[faceIdx];
    const a = document.createElement('a');
    a.href = src;
    a.download = src.split('/').pop();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  },

  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  },

  _stopAnimation() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.rolling = false;
  },

  destroy() {
    this._stopAnimation();
    this.geometry.dispose();
    this.cube.material.forEach((m) => {
      if (m.map) m.map.dispose();
      m.dispose();
    });
    this.renderer.dispose();
  },
};
