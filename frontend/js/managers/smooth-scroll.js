"use strict";

import { SidebarManager } from './sidebar.js';

const SmoothScrolling = {
  init() {
    document.querySelectorAll('a[href^="#"]').forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const target = document.querySelector(link.getAttribute("href"));
        if (target) {
          history.pushState(null, null, link.getAttribute("href"));
          target.scrollIntoView({ behavior: "smooth", block: "start" });

          const leftSidebar = document.getElementById("left-sidebar");
          if (leftSidebar && leftSidebar.classList.contains("mobile-open")) {
            SidebarManager.closeMobileMenus();
          }
        }
      });
    });
  },
};

export { SmoothScrolling };

