"use strict";

/**
 * Main entry point for the application
 * Imports and initializes all manager modules
 */

import { ThemeManager } from './managers/theme.js';
import { SidebarManager } from './managers/sidebar.js';
import { SmoothScrolling } from './managers/smooth-scroll.js';
import { NotesFetcher } from './managers/notes.js';
import { MeatGameToggle } from './managers/meat-game.js';
import { ExperienceCarousel } from './managers/carousel.js';

console.info("hi");

function initDiceTrigger() {
  const trigger = document.getElementById("dice-toggle");
  if (!trigger) return;
  const overlay = document.getElementById("dice-overlay");
  if (overlay) overlay.hidden = true;

  // The dice is a novelty feature. Keep its WebGL runtime and photo textures
  // off the critical path until somebody explicitly asks to use it.
  trigger.style.display = "";
  let gamePromise = null;
  const activate = async () => {
    trigger.setAttribute("aria-busy", "true");
    try {
      gamePromise ??= import('./background-animation.js');
      const { DiceGame } = await gamePromise;
      DiceGame.init();
      DiceGame.roll();
    } catch (error) {
      gamePromise = null;
      console.error("Could not load the dice:", error);
    } finally {
      trigger.removeAttribute("aria-busy");
    }
  };

  trigger.addEventListener("click", activate);
  trigger.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activate();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  ThemeManager.init();
  SidebarManager.init();
  SmoothScrolling.init();
  NotesFetcher.init();
  MeatGameToggle.init();
  ExperienceCarousel.init();
  initDiceTrigger();
});
