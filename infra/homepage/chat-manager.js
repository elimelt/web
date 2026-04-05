class ChatManager {
  constructor() {
    this.panel = null;
    this.messagesContainer = null;
    this.input = null;
    this.sendButton = null;
    this.isOpen = false;
    this.isLoading = false;
    this.apiUrl = '/api/augment/chat';
  }

  init() {
    this.panel = document.getElementById('chat-panel');
    this.messagesContainer = document.getElementById('chat-messages');
    this.input = document.getElementById('chat-input');
    this.sendButton = document.getElementById('chat-send');
    
    this.setupEventListeners();
  }

  setupEventListeners() {
    const toggleBtn = document.getElementById('chat-toggle');
    const closeBtn = document.getElementById('chat-close');

    toggleBtn.addEventListener('click', () => this.toggle());
    closeBtn.addEventListener('click', () => this.close());

    this.sendButton.addEventListener('click', () => this.sendMessage());

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    this.input.addEventListener('input', () => {
      this.input.style.height = 'auto';
      this.input.style.height = Math.min(this.input.scrollHeight, 100) + 'px';
    });
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  open() {
    this.isOpen = true;
    this.panel.classList.add('open');
    this.input.focus();
  }

  close() {
    this.isOpen = false;
    this.panel.classList.remove('open');
  }

  async sendMessage() {
    const message = this.input.value.trim();
    if (!message || this.isLoading) return;

    this.addMessage(message, 'user');
    this.input.value = '';
    this.input.style.height = 'auto';
    this.setLoading(true);

    const messageEl = this.createStreamingMessage();

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, model: 'sonnet4.5' })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Request failed');
      }

      await this.processStream(response, messageEl);
    } catch (error) {
      messageEl.remove();
      this.addMessage(`Error: ${error.message}`, 'error');
    } finally {
      this.setLoading(false);
    }
  }

  createStreamingMessage() {
    const existingSystem = this.messagesContainer.querySelector('.chat-message.system');
    if (existingSystem) {
      existingSystem.remove();
    }

    const messageEl = document.createElement('div');
    messageEl.className = 'chat-message assistant streaming';
    messageEl.textContent = '';
    this.messagesContainer.appendChild(messageEl);
    this.scrollToBottom();
    return messageEl;
  }

  async processStream(response, messageEl) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullResponse = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data) {
            fullResponse += data;
            const displayText = this.parseAugmentResponse(fullResponse);
            messageEl.textContent = displayText;
            this.scrollToBottom();
          }
        } else if (line.startsWith('event: done')) {
          messageEl.classList.remove('streaming');
          const finalText = this.parseAugmentResponse(fullResponse);
          messageEl.textContent = finalText;
          return;
        }
      }
    }

    messageEl.classList.remove('streaming');
    const finalText = this.parseAugmentResponse(fullResponse);
    messageEl.textContent = finalText;
  }

  parseAugmentResponse(text) {
    const resultMatch = text.match(/<augment-agent-result>([\s\S]*?)(<\/augment-agent-result>|$)/);
    if (resultMatch) {
      return resultMatch[1].trim();
    }

    const messageMatch = text.match(/<augment-agent-message>([\s\S]*?)(<\/augment-agent-message>|$)/);
    if (messageMatch) {
      return messageMatch[1].trim();
    }

    return text
      .replace(/<augment-agent-message>[\s\S]*?<\/augment-agent-message>/g, '')
      .replace(/<augment-agent-type>[\s\S]*?<\/augment-agent-type>/g, '')
      .replace(/<augment-agent-result>/g, '')
      .replace(/<\/augment-agent-result>/g, '')
      .replace(/Indexing enabled for current workspace.*?\./g, '')
      .replace(/Augment would like to index.*?indexingAllowDirs.*?settings\.json\)\./gs, '')
      .replace(/Learn more at https:\/\/docs\.augmentcode\.com\/.*?\n/g, '')
      .replace(/Workspace: `\/tmp`/g, '')
      .replace(/To view the directories.*?settings\.json\)\./gs, '')
      .trim();
  }

  addMessage(text, type) {
    const existingSystem = this.messagesContainer.querySelector('.chat-message.system');
    if (existingSystem && type !== 'system') {
      existingSystem.remove();
    }

    const messageEl = document.createElement('div');
    messageEl.className = `chat-message ${type}`;
    messageEl.textContent = text;
    this.messagesContainer.appendChild(messageEl);
    this.scrollToBottom();
  }

  setLoading(loading) {
    this.isLoading = loading;
    this.sendButton.disabled = loading;
    this.input.disabled = loading;
  }

  scrollToBottom() {
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  clearMessages() {
    this.messagesContainer.innerHTML = 
      '<div class="chat-message system">Send a message to start chatting with the AI assistant.</div>';
  }
}

export default ChatManager;

