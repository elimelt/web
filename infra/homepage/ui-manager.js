class UIManager {
  constructor(frameManager, storageManager) {
    this.frameManager = frameManager;
    this.storageManager = storageManager;
    this.gridContainer = null;
    this.serviceList = null;
  }

  init() {
    this.gridContainer = document.getElementById('grid-container');
    this.serviceList = document.getElementById('service-list');
    this.setupServiceButtons();
  }

  setupServiceButtons() {
    const buttons = this.serviceList.querySelectorAll('button[data-name]');
    buttons.forEach(button => {
      button.addEventListener('click', () => {
        const service = {
          name: button.dataset.name,
          url: button.dataset.url,
          embeddable: button.dataset.embeddable === 'true'
        };

        if (service.embeddable) {
          this.addFrame(service);
        } else {
          window.open(service.url, '_blank');
        }
      });
    });
  }

  addFrame(service) {
    const frame = this.frameManager.createFrame(service);
    const element = this.createFrameElement(frame);
    frame.element = element;
    
    this.gridContainer.appendChild(element);
    this.updateGrid();
    this.frameManager.setActive(frame.id);
    this.updateActiveState();
    this.saveState();
  }

  createFrameElement(frame) {
    const container = document.createElement('div');
    container.className = 'frame-container';
    container.dataset.frameId = frame.id;

    const header = document.createElement('div');
    header.className = 'frame-header';

    const title = document.createElement('span');
    title.textContent = frame.service.name;

    const openBtn = document.createElement('button');
    openBtn.textContent = '↗';
    openBtn.className = 'open-btn';
    openBtn.title = 'Open in new tab';
    openBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.open(frame.url, '_blank');
    });

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'x';
    closeBtn.className = 'close-btn';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.removeFrame(frame.id);
    });

    header.appendChild(title);
    header.appendChild(openBtn);
    header.appendChild(closeBtn);

    const iframe = document.createElement('iframe');
    iframe.src = frame.url;
    iframe.className = 'service-frame';
    iframe.addEventListener('load', () => {
      this.frameManager.markLoaded(frame.id);
    });

    container.appendChild(header);
    container.appendChild(iframe);

    container.addEventListener('click', () => {
      this.frameManager.setActive(frame.id);
      this.updateActiveState();
      this.saveState();
    });

    return container;
  }

  removeFrame(id) {
    this.frameManager.removeFrame(id);
    this.updateGrid();
    this.updateActiveState();
    this.saveState();
  }

  updateGrid() {
    const count = this.frameManager.getFrameCount();
    
    if (count === 0) {
      this.gridContainer.style.gridTemplateColumns = '1fr';
      this.gridContainer.style.gridTemplateRows = '1fr';
    } else if (count === 1) {
      this.gridContainer.style.gridTemplateColumns = '1fr';
      this.gridContainer.style.gridTemplateRows = '1fr';
    } else if (count === 2) {
      this.gridContainer.style.gridTemplateColumns = '1fr 1fr';
      this.gridContainer.style.gridTemplateRows = '1fr';
    } else if (count === 3) {
      this.gridContainer.style.gridTemplateColumns = '1fr 1fr';
      this.gridContainer.style.gridTemplateRows = '1fr 1fr';
    } else if (count === 4) {
      this.gridContainer.style.gridTemplateColumns = '1fr 1fr';
      this.gridContainer.style.gridTemplateRows = '1fr 1fr';
    } else {
      const cols = Math.ceil(Math.sqrt(count));
      this.gridContainer.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
      this.gridContainer.style.gridTemplateRows = 'auto';
    }
  }

  updateActiveState() {
    const containers = this.gridContainer.querySelectorAll('.frame-container');
    containers.forEach(container => {
      container.classList.remove('active');
    });
    
    const activeFrame = this.frameManager.getActive();
    if (activeFrame && activeFrame.element) {
      activeFrame.element.classList.add('active');
    }
  }

  saveState() {
    const frames = this.frameManager.getAllFrames();
    this.storageManager.saveFrames(frames);
    
    const activeFrame = this.frameManager.getActive();
    if (activeFrame) {
      this.storageManager.saveActiveFrame(activeFrame.id);
    }
  }

  loadState() {
    const savedFrames = this.storageManager.loadFrames();
    savedFrames.forEach(savedFrame => {
      this.addFrame(savedFrame.service);
    });
    
    const activeFrameId = this.storageManager.loadActiveFrame();
    if (activeFrameId) {
      this.frameManager.setActive(activeFrameId);
      this.updateActiveState();
    }
  }

  clearAll() {
    this.frameManager.clear();
    this.gridContainer.innerHTML = '';
    this.storageManager.clearFrames();
    this.updateGrid();
  }

  focusNext() {
    const next = this.frameManager.getNextFrame();
    if (next) {
      this.frameManager.setActive(next.id);
      this.updateActiveState();
      this.saveState();
    }
  }

  focusPrev() {
    const prev = this.frameManager.getPrevFrame();
    if (prev) {
      this.frameManager.setActive(prev.id);
      this.updateActiveState();
      this.saveState();
    }
  }

  removeActive() {
    const active = this.frameManager.getActive();
    if (active) {
      this.removeFrame(active.id);
    }
  }
}

export default UIManager;

