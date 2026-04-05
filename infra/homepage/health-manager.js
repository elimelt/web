class HealthManager {
  constructor() {
    this.dot = null;
    this.text = null;
    this.healthUrl = '/api/health';
    this.pollInterval = 30000;
    this.intervalId = null;
  }

  init() {
    this.dot = document.getElementById('health-dot');
    this.text = document.getElementById('health-text');
    this.checkHealth();
    this.startPolling();
  }

  startPolling() {
    this.intervalId = setInterval(() => this.checkHealth(), this.pollInterval);
  }

  stopPolling() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async checkHealth() {
    this.setStatus('checking', 'checking...');

    try {
      const response = await fetch(this.healthUrl, {
        method: 'GET',
        cache: 'no-cache'
      });

      if (response.ok) {
        const data = await response.json();
        if (data.status === 'ok') {
          this.setStatus('healthy', 'connected');
        } else {
          this.setStatus('unhealthy', 'degraded');
        }
      } else {
        this.setStatus('unhealthy', 'error');
      }
    } catch (error) {
      this.setStatus('unhealthy', 'offline');
    }
  }

  setStatus(status, text) {
    this.dot.className = '';
    this.dot.classList.add(status);
    this.text.textContent = text;
  }
}

export default HealthManager;

