class KeyboardManager {
  declare handlers: Map<string, (event: KeyboardEvent) => void>;
  declare enabled: boolean;

  constructor() {
    this.handlers = new Map();
    this.enabled = true;
  }

  init() {
    document.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      
      const key = this.getKeyCombo(e);
      const handler = this.handlers.get(key);
      
      if (handler) {
        e.preventDefault();
        handler(e);
      }
    });
  }

  getKeyCombo(e: KeyboardEvent) {
    const parts = [];
    if (e.ctrlKey) parts.push('ctrl');
    if (e.altKey) parts.push('alt');
    if (e.shiftKey) parts.push('shift');
    parts.push(e.key.toLowerCase());
    return parts.join('+');
  }

  register(keyCombo: string, handler: (event: KeyboardEvent) => void) {
    this.handlers.set(keyCombo, handler);
  }

  unregister(keyCombo: string) {
    this.handlers.delete(keyCombo);
  }

  enable() {
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
  }

  clear() {
    this.handlers.clear();
  }
}

export default KeyboardManager;

