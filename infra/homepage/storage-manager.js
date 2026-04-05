class StorageManager {
  constructor() {
    this.storageKey = 'devstack-frames';
  }

  saveFrames(frames) {
    const data = frames.map(frame => ({
      service: frame.service,
      id: frame.id
    }));
    
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(data));
      return true;
    } catch (e) {
      console.error('Failed to save frames:', e);
      return false;
    }
  }

  loadFrames() {
    try {
      const data = localStorage.getItem(this.storageKey);
      if (!data) return [];
      
      return JSON.parse(data);
    } catch (e) {
      console.error('Failed to load frames:', e);
      return [];
    }
  }

  clearFrames() {
    try {
      localStorage.removeItem(this.storageKey);
      return true;
    } catch (e) {
      console.error('Failed to clear frames:', e);
      return false;
    }
  }

  saveActiveFrame(frameId) {
    try {
      localStorage.setItem('devstack-active-frame', frameId);
      return true;
    } catch (e) {
      return false;
    }
  }

  loadActiveFrame() {
    try {
      return localStorage.getItem('devstack-active-frame');
    } catch (e) {
      return null;
    }
  }
}

export default StorageManager;

