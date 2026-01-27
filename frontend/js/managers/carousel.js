"use strict";

const ExperienceCarousel = {
  timeline: null,
  prevBtn: null,
  nextBtn: null,

  init() {
    this.timeline = document.querySelector("#experience .timeline");
    this.prevBtn = document.querySelector(".timeline-nav-prev");
    this.nextBtn = document.querySelector(".timeline-nav-next");

    if (!this.timeline || !this.prevBtn || !this.nextBtn) return;

    this.prevBtn.addEventListener("click", () => this._scroll(-1));
    this.nextBtn.addEventListener("click", () => this._scroll(1));
    this.timeline.addEventListener("scroll", () => this._updateButtons());

    this._updateButtons();
  },

  _scroll(direction) {
    const scrollAmount = this.timeline.clientWidth;
    this.timeline.scrollBy({
      left: direction * scrollAmount,
      behavior: "smooth",
    });
  },

  _updateButtons() {
    const { scrollLeft, scrollWidth, clientWidth } = this.timeline;
    this.prevBtn.disabled = scrollLeft <= 0;
    this.nextBtn.disabled = scrollLeft + clientWidth >= scrollWidth - 1;
  },
};

export { ExperienceCarousel };

