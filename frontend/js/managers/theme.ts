"use strict";

const ThemeManager = {
  toggle: null as HTMLElement | null,
  icon: null as HTMLElement | null,

  init() {
    this.toggle = document.getElementById("theme-toggle");
    this.icon = document.getElementById("theme-icon");

    if (!this.toggle || !this.icon) return;

    if (localStorage.getItem("theme") === "dark") {
      document.body.classList.add("dark-mode");
      this.icon.querySelector("use")?.setAttribute("href", "#icon-sun");
      this.updateLogos();
    }

    this.toggle.addEventListener("click", () => {
      const isDark = document.body.classList.toggle("dark-mode");
      localStorage.setItem("theme", isDark ? "dark" : "light");
      this.icon
        .querySelector("use")
        ?.setAttribute("href", isDark ? "#icon-sun" : "#icon-moon");
      this.updateLogos();
    });
  },

  updateLogos() {
    const isDark = document.body.classList.contains("dark-mode");
    const toDark = (src: string) =>
      src.replace(/(?<!-dark)\.(png|webp|svg)$/, "-dark.$1");
    const toLight = (src: string) =>
      src.replace(/-dark\.(png|webp|svg)$/, ".$1");

    document.querySelectorAll<HTMLImageElement>(".timeline-logo").forEach((logo) => {
      logo.src = isDark ? toDark(logo.src) : toLight(logo.src);
    });
  },
};

export { ThemeManager };

