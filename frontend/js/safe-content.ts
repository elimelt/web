import DOMPurify from './vendor/purify.js';
import { marked } from 'https://cdn.jsdelivr.net/npm/marked@15.0.0/+esm';
import { getUserColor } from './utils.js';

export function renderMarkdown(value: unknown): string {
  const escaped = document.createElement('div');
  escaped.textContent = typeof value === 'string' ? value : '';
  const html = marked.parse(escaped.innerHTML.replace(/&gt;/g, '>'), {
    async: false, breaks: true, gfm: true,
  });
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'del', 'blockquote', 'pre', 'code',
      'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['href', 'title'],
    ALLOWED_URI_REGEXP: /^https?:\/\//i,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
}

export function setIdentityText(container: HTMLElement, value: unknown, suffix: string): void {
  const identity = typeof value === 'string' ? value : 'unknown';
  const label = document.createElement('span');
  label.style.color = getUserColor(identity);
  label.textContent = identity;
  container.replaceChildren(label, document.createTextNode(suffix));
}
