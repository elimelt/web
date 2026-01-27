"use strict";

const SidebarManager = {
  leftSidebar: null,
  rightSidebar: null,
  mobileToggle: null,
  rightMenuToggle: null,
  mobileMenuIcon: null,
  rightMenuIcon: null,

  init() {
    this.mobileToggle = document.getElementById("mobile-menu-toggle");
    this.leftSidebar = document.getElementById("left-sidebar");
    this.rightMenuToggle = document.getElementById("right-menu-toggle");
    this.rightSidebar = document.getElementById("right-sidebar");
    this.mobileMenuIcon = document.getElementById("mobile-menu-icon");
    this.rightMenuIcon = document.getElementById("right-menu-icon");

    this._initMobileToggles();
    this._initResizeHandles();
    this.updateForScreenSize();
  },

  _updateToggleIcons() {
    if (this.mobileMenuIcon) {
      const leftOpen = this.leftSidebar?.classList.contains("mobile-open");
      this.mobileMenuIcon
        .querySelector("use")
        .setAttribute(
          "href",
          leftOpen ? "#icon-chevron-left" : "#icon-chevron-right",
        );
    }
    if (this.rightMenuIcon) {
      const rightOpen = this.rightSidebar?.classList.contains("mobile-open");
      this.rightMenuIcon
        .querySelector("use")
        .setAttribute(
          "href",
          rightOpen ? "#icon-chevron-right" : "#icon-chevron-left",
        );
    }
  },

  updateForScreenSize() {
    if (this.leftSidebar && this.mobileToggle) {
      if (window.innerWidth > 1024) {
        this.leftSidebar.classList.add("mobile-open");
        this.mobileToggle.classList.add("active");
      } else {
        this.leftSidebar.classList.remove("mobile-open");
        this.mobileToggle.classList.remove("active");
      }
    }
    if (this.rightSidebar && this.rightMenuToggle) {
      if (window.innerWidth > 1280) {
        this.rightSidebar.classList.add("mobile-open");
        this.rightMenuToggle.classList.add("active");
      } else {
        this.rightSidebar.classList.remove("mobile-open");
        this.rightMenuToggle.classList.remove("active");
      }
    }
    this._updateToggleIcons();
  },

  closeMobileMenus() {
    if (this.leftSidebar) {
      this.leftSidebar.classList.remove("mobile-open");
      this.mobileToggle.classList.remove("active");
    }
    if (this.rightSidebar) {
      this.rightSidebar.classList.remove("mobile-open");
      this.rightMenuToggle.classList.remove("active");
    }
    this._updateToggleIcons();
  },

  _initMobileToggles() {
    if (this.mobileToggle && this.leftSidebar) {
      this.mobileToggle.addEventListener("click", () => {
        this.leftSidebar.classList.toggle("mobile-open");
        this.mobileToggle.classList.toggle("active");
        this._updateToggleIcons();
      });
    }

    if (this.rightMenuToggle && this.rightSidebar) {
      this.rightMenuToggle.addEventListener("click", () => {
        this.rightSidebar.classList.toggle("mobile-open");
        this.rightMenuToggle.classList.toggle("active");
        this._updateToggleIcons();
      });
    }
  },

  _initResizeHandles() {
    const leftHandle = document.getElementById("left-resize-handle");
    const rightHandle = document.getElementById("right-resize-handle");

    this._initResize(leftHandle, this.leftSidebar, true);
    this._initResize(rightHandle, this.rightSidebar, false);
  },

  _initResize(handle, sidebar, isLeft) {
    if (!handle || !sidebar) return;

    let isResizing = false;
    let startX, startWidth;

    handle.addEventListener("mousedown", (e) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = sidebar.offsetWidth;
      handle.classList.add("dragging");
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!isResizing) return;
      const diff = isLeft ? e.clientX - startX : startX - e.clientX;
      const newWidth = Math.max(200, Math.min(600, startWidth + diff));
      sidebar.style.width = newWidth + "px";
      const varName = isLeft
        ? "--left-sidebar-width"
        : "--right-sidebar-width";
      document.documentElement.style.setProperty(varName, newWidth + "px");
    });

    document.addEventListener("mouseup", () => {
      if (isResizing) {
        isResizing = false;
        handle.classList.remove("dragging");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    });
  },
};

export { SidebarManager };

