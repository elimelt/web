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
import { DiceGame } from './background-animation.js';

console.info("hi");

document.addEventListener("DOMContentLoaded", () => {
  ThemeManager.init();
  SidebarManager.init();
  SmoothScrolling.init();
  NotesFetcher.init();
  MeatGameToggle.init();
  ExperienceCarousel.init();
  DiceGame.init();
});
