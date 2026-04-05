class FrameManager {
  constructor() {
    this.frames = new Map();
    this.nextId = 1;
    this.activeFrameId = null;
  }

  createFrame(service) {
    const id = `frame-${this.nextId++}`;
    const frame = {
      id,
      service,
      url: service.url,
      element: null,
      loaded: false
    };
    
    this.frames.set(id, frame);
    return frame;
  }

  removeFrame(id) {
    const frame = this.frames.get(id);
    if (frame && frame.element) {
      frame.element.remove();
    }
    this.frames.delete(id);
    
    if (this.activeFrameId === id) {
      const remaining = Array.from(this.frames.keys());
      this.activeFrameId = remaining.length > 0 ? remaining[0] : null;
    }
  }

  getFrame(id) {
    return this.frames.get(id);
  }

  getAllFrames() {
    return Array.from(this.frames.values());
  }

  setActive(id) {
    this.activeFrameId = id;
  }

  getActive() {
    return this.activeFrameId ? this.frames.get(this.activeFrameId) : null;
  }

  clear() {
    this.frames.forEach(frame => {
      if (frame.element) {
        frame.element.remove();
      }
    });
    this.frames.clear();
    this.activeFrameId = null;
  }

  markLoaded(id) {
    const frame = this.frames.get(id);
    if (frame) {
      frame.loaded = true;
    }
  }

  getFrameCount() {
    return this.frames.size;
  }

  getNextFrame() {
    const ids = Array.from(this.frames.keys());
    if (ids.length === 0) return null;
    
    const currentIndex = ids.indexOf(this.activeFrameId);
    const nextIndex = (currentIndex + 1) % ids.length;
    return this.frames.get(ids[nextIndex]);
  }

  getPrevFrame() {
    const ids = Array.from(this.frames.keys());
    if (ids.length === 0) return null;
    
    const currentIndex = ids.indexOf(this.activeFrameId);
    const prevIndex = currentIndex <= 0 ? ids.length - 1 : currentIndex - 1;
    return this.frames.get(ids[prevIndex]);
  }
}

export default FrameManager;

