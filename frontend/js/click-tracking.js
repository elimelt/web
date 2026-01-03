import { recordClickEvent, initAnalyticsDelivery } from './api.js';

(function () {
  "use strict";

  function getTextSnippet(el) {
    try {
      const txt = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      if (!txt) return "";
      return txt.length > 120 ? txt.slice(0, 117) + "..." : txt;
    } catch {
      return "";
    }
  }

  function getElementInfo(target) {
    if (!target || !(target instanceof Element)) {
      return { tag: 'unknown' };
    }
    const el = target;
    const rect = el.getBoundingClientRect();
    const role = el.getAttribute && el.getAttribute('role');
    const name = el.getAttribute && el.getAttribute('name');
    const ariaLabel = el.getAttribute && el.getAttribute('aria-label');
    const labeled = el.closest('[data-analytics],[data-analytics-id],[data-analytics-label]');
    const analytics = labeled
      ? {
          id: labeled.getAttribute('data-analytics-id') || "",
          label: labeled.getAttribute('data-analytics-label') || "",
          group: labeled.getAttribute('data-analytics-group') || "",
          type: labeled.getAttribute('data-analytics') || ""
        }
      : { id: "", label: "", group: "", type: "" };
    const domPath = (() => {
      try {
        const parts = [];
        let node = el;
        let depth = 0;
        while (node && depth < 6 && node.nodeType === 1) {
          const tag = (node.tagName || 'el').toLowerCase();
          const id = node.id ? `#${node.id}` : '';
          const cls = node.classList && node.classList.length
            ? '.' + Array.from(node.classList).slice(0, 2).join('.')
            : '';
          parts.unshift(`${tag}${id}${cls}`);
          node = node.parentElement;
          depth++;
        }
        return parts.join(' > ');
      } catch {
        return '';
      }
    })();
    return {
      tag: (el.tagName || 'unknown').toLowerCase(),
      id: el.id || "",
      classes: Array.from(el.classList || []).join(" "),
      role: role || "",
      name: name || "",
      ariaLabel: ariaLabel || "",
      text: getTextSnippet(el),
      analytics,
      domPath,
      rect: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };
  }

  function onClick(e) {
    try {
      const isPointer = typeof PointerEvent !== 'undefined' && e instanceof PointerEvent;
      const payload = {
        viewport: {
          width: window.innerWidth || 0,
          height: window.innerHeight || 0,
          scrollX: window.scrollX || 0,
          scrollY: window.scrollY || 0,
          dpr: window.devicePixelRatio || 1
        },
        pointer: {
          x: typeof e.clientX === 'number' ? Math.round(e.clientX) : null,
          y: typeof e.clientY === 'number' ? Math.round(e.clientY) : null,
          pageX: typeof e.pageX === 'number' ? Math.round(e.pageX) : null,
          pageY: typeof e.pageY === 'number' ? Math.round(e.pageY) : null,
          button: typeof e.button === 'number' ? e.button : null,
          buttons: typeof e.buttons === 'number' ? e.buttons : null,
          pointerType: isPointer ? e.pointerType : 'mouse',
          altKey: !!e.altKey,
          ctrlKey: !!e.ctrlKey,
          metaKey: !!e.metaKey,
          shiftKey: !!e.shiftKey
        },
        element: getElementInfo(e.target)
      };
      recordClickEvent(payload);
    } catch (err) {
      console.warn('click tracking failed:', err);
    }
  }

  function init() {
    initAnalyticsDelivery();
    document.addEventListener('click', onClick, { capture: true, passive: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
