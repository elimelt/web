import * as THREE from 'three';

class BackgroundAnimation {
  constructor() {
    this.animationFrameId = null;
    this.boundAnimate = this.animate.bind(this);
    this.boundResize = this.onResize.bind(this);
    this.init();
  }

  init() {
    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.z = 30;

    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.style.position = 'fixed';
    this.renderer.domElement.style.top = '0';
    this.renderer.domElement.style.left = '0';
    this.renderer.domElement.style.zIndex = '-1';
    this.renderer.domElement.style.pointerEvents = 'none';
    this.renderer.domElement.style.opacity = '0.03';
    document.body.insertBefore(this.renderer.domElement, document.body.firstChild);

    this.geometry = new THREE.TorusKnotGeometry(10, 3, 100, 16);
    this.material = new THREE.MeshPhongMaterial({ color: 0x0062ff });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.scene.add(this.mesh);

    const light1 = new THREE.PointLight(0xffffff, 1, 100);
    light1.position.set(20, 20, 20);
    this.scene.add(light1);

    const light2 = new THREE.PointLight(0x0062ff, 0.5, 100);
    light2.position.set(-20, -20, -20);
    this.scene.add(light2);

    window.addEventListener('resize', this.boundResize);

    this.time = 0;
    this.animate();
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  animate() {
    this.animationFrameId = requestAnimationFrame(this.boundAnimate);

    this.time += 0.005;

    this.mesh.rotation.x = this.time * 0.5;
    this.mesh.rotation.y = this.time * 0.3;

    this.camera.position.x = Math.sin(this.time * 0.3) * 20;
    this.camera.position.z = Math.cos(this.time * 0.3) * 20 + 30;
    this.camera.lookAt(0, 0, 0);

    this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    window.removeEventListener('resize', this.boundResize);

    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }

    this.geometry.dispose();
    this.material.dispose();
    this.renderer.dispose();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new BackgroundAnimation();
});
