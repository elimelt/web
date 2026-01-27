"use strict";

import { RatFollower } from './rat-follower.js';

const MeatGameToggle = {
  toggle: null,
  ratController: null,

  RAT_CONFIG: {
    anchor: { x: 0.5, y: 0.0 },
    size: 76,
    angleOffset: Math.PI / 2,
  },

  init() {
    this.toggle = document.getElementById("meat-toggle");
    if (!this.toggle) return;

    const enabledByDefault = localStorage.getItem("meatGame") === "true";
    if (enabledByDefault) {
      this.ratController = RatFollower.create(this.RAT_CONFIG) || null;
    }

    this._updateUI(!!this.ratController);

    this.toggle.addEventListener("click", () => {
      const isEnabled = !!this.ratController;
      if (isEnabled) {
        this.ratController.destroy();
        this.ratController = null;
        localStorage.setItem("meatGame", "false");
        this._updateUI(false);
      } else {
        this.ratController = RatFollower.create(this.RAT_CONFIG) || null;
        localStorage.setItem("meatGame", "true");
        this._updateUI(!!this.ratController);
      }
    });
  },

  _updateUI(enabled) {
    if (!this.toggle) return;
    this.toggle.setAttribute("aria-pressed", enabled ? "true" : "false");
    this.toggle.title = enabled
      ? "Disable rat meat game"
      : "Enable rat meat game";
    this.toggle.classList.toggle("meat-active", !!enabled);
    document.body.classList.toggle("meat-game-active", !!enabled);
  },
};

export { MeatGameToggle };

