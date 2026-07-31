"use strict";

import { BASE_URL } from "../config.js";

const NotesFetcher = {
  SOURCE_URL: "https://notes.elimelt.com",
  RSS_URL: "https://notes.elimelt.com/index.xml",
  SEARCH_API: `${BASE_URL}/notes/search`,
  originalNotesHTML: "",

  init() {
    const container = document.getElementById("notes-content");
    if (container) {
      this.fetchAndDisplay();
      this._initSearch();
    }
  },

  async fetchAndDisplay() {
    try {
      const response = await fetch(this.RSS_URL);
      if (!response.ok) {
        throw new Error(`Failed to fetch notes: ${response.statusText}`);
      }

      const xml = await response.text();
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      const parseError = doc.querySelector("parsererror");
      if (parseError) {
        throw new Error("Failed to parse notes RSS feed");
      }

      const rootUrl = `${this.SOURCE_URL}/`;
      const notes = Array.from(doc.querySelectorAll("item"))
        .map((item) => ({
          title: item.querySelector("title")?.textContent?.trim() || "Untitled",
          url: item.querySelector("link")?.textContent?.trim() || this.SOURCE_URL,
          description: item.querySelector("description")?.textContent?.trim() || "",
          last_modified: item.querySelector("pubDate")?.textContent?.trim() || "",
        }))
        .filter((note) => note.url !== this.SOURCE_URL && note.url !== rootUrl)
        .slice(0, 8);

      if (notes.length === 0) {
        throw new Error("No notes returned from RSS feed");
      }

      const container = document.getElementById("notes-content");
      this._renderNotes(container, notes);
      this.originalNotesHTML = container.innerHTML;
    } catch (error) {
      console.error("Error fetching notes:", error);
      document.getElementById("notes-content").innerHTML =
        '<li class="note-item">Unable to load notes. Please try again later.</li>';
    }
  },

  _initSearch() {
    const input = document.getElementById("notes-search-input");
    const btn = document.getElementById("notes-search-btn");

    if (!input || !btn) return;

    const doSearch = () => this._search(input.value);

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doSearch();
    });
    btn.addEventListener("click", doSearch);
  },

  async _search(query) {
    const container = document.getElementById("notes-content");
    if (!query.trim()) {
      if (this.originalNotesHTML) {
        container.innerHTML = this.originalNotesHTML;
      }
      return;
    }

    container.innerHTML =
      '<li class="note-item"><p class="notes-placeholder">Searching...</p></li>';

    try {
      const params = new URLSearchParams({
        q: query,
        mode: "fulltext",
        limit: "20",
      });
      const response = await fetch(`${this.SEARCH_API}?${params}`);

      if (!response.ok) {
        throw new Error(`Search failed: ${response.statusText}`);
      }

      const data = await response.json();
      const results = data.results || [];

      if (results.length === 0) {
        container.innerHTML =
          '<li class="note-item"><p class="notes-error">No results found.</p></li>';
        return;
      }

      this._renderNotes(container, results);
    } catch (error) {
      console.error("Error searching notes:", error);
      container.innerHTML =
        '<li class="note-item"><p class="notes-error">Search failed. Please try again.</p></li>';
    }
  },

  _noteUrl(note) {
    if (note.url) return note.url;
    if (!note.file_path) return `${this.SOURCE_URL}`;
    const urlPath = note.file_path
      .replace(/^content\//, "")
      .replace(/\.md$/, ".html")
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    return `${this.SOURCE_URL}/${urlPath}`;
  },

  _renderNotes(container, notes) {
    container.innerHTML = "";
    const fragment = document.createDocumentFragment();

    notes.forEach((note) => {
      const item = document.createElement("li");
      item.classList.add("note-item");

      const link = document.createElement("a");
      link.classList.add("note-link");
      link.href = this._noteUrl(note);
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = note.title || "Untitled";
      link.setAttribute("data-analytics", "notes.link");
      link.setAttribute("data-analytics-id", `note:${note.file_path || note.id}`);
      link.setAttribute("data-analytics-label", link.textContent);
      link.setAttribute("data-analytics-group", "notes");

      const meta = document.createElement("div");
      meta.classList.add("note-meta");

      if (note.last_modified) {
        const date = document.createElement("span");
        date.classList.add("note-date");
        date.textContent = new Date(note.last_modified).toLocaleDateString();
        meta.appendChild(date);
      }

      if (note.category) {
        const category = document.createElement("span");
        category.classList.add("note-category");
        category.textContent = note.category;
        meta.appendChild(category);
      }

      const previewBtn = document.createElement("button");
      previewBtn.classList.add("preview-btn");
      previewBtn.type = "button";
      previewBtn.setAttribute("aria-label", "Preview note");
      previewBtn.innerHTML = '<svg class="preview-icon"><use href="#icon-eye"></use></svg>';
      previewBtn.addEventListener("click", () => this._previewNote(item));
      meta.appendChild(previewBtn);

      item.appendChild(link);
      item.appendChild(meta);
      fragment.appendChild(item);
    });

    container.appendChild(fragment);
  },

  _styleNoteItems() {
    const noteItems = document.querySelectorAll("#notes-content li");
    noteItems.forEach((item) => {
      item.classList.add("note-item");

      const link = item.querySelector("a");
      if (link) {
        link.classList.add("note-link");
        try {
          const href = link.getAttribute("href") || "";
          const text = (link.textContent || "").trim();
          link.setAttribute("data-analytics", "notes.link");
          if (href) link.setAttribute("data-analytics-id", `note:${href}`);
          if (text) link.setAttribute("data-analytics-label", text);
          link.setAttribute("data-analytics-group", "notes");
        } catch {}
      }

      const date = item.querySelector(".date");
      if (date) date.classList.add("note-date");

      const category = item.querySelector(".category");
      if (category) category.classList.add("note-category");

      const previewBtn = item.querySelector(".preview-btn");
      if (previewBtn) {
        previewBtn.addEventListener("click", () => {
          this._previewNote(item);
        });
      }

      if (date && category) {
        const metaDiv = document.createElement("div");
        metaDiv.classList.add("note-meta");

        date.parentNode.insertBefore(metaDiv, date);
        metaDiv.appendChild(date);
        metaDiv.appendChild(category);
        metaDiv.appendChild(previewBtn);
      }
    });
  },

  _attachPreviewListeners(container) {
    container.querySelectorAll(".preview-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._previewNote(btn.closest(".note-item"));
      });
    });
  },

  _previewNote(item) {
    const link = item.querySelector("a");
    if (!link) return;

    const href = link.getAttribute("href");
    if (!href) return;

    const previewSection = document.getElementById("note-inline-preview");
    if (!previewSection) return;

    const titleEl = previewSection.querySelector(".note-inline-title");
    const contentEl = previewSection.querySelector(".note-inline-content");
    const closeBtn = previewSection.querySelector(".note-inline-close");

    titleEl.textContent = link.textContent || "Preview";
    contentEl.innerHTML = '<div class="note-inline-loading">Loading...</div>';
    previewSection.style.display = "";

    // On mobile, move preview to appear after the notes section
    const isMobile = window.innerWidth <= 768;
    const notesSection = document.getElementById("notes-preview");
    const originalParent = document.getElementById("right-col-stack");
    if (
      isMobile &&
      notesSection &&
      previewSection.parentElement !== notesSection.parentElement
    ) {
      notesSection.after(previewSection);
    }

    const closePreview = () => {
      previewSection.style.display = "none";
      contentEl.innerHTML =
        '<div class="note-inline-loading">Loading...</div>';
      // Move preview back to original location
      if (originalParent && previewSection.parentElement !== originalParent) {
        originalParent.prepend(previewSection);
      }
    };

    closeBtn.onclick = closePreview;

    contentEl.innerHTML = "";
    const iframe = document.createElement("iframe");
    iframe.classList.add("note-inline-iframe");

    const url = new URL(href);
    url.searchParams.set("embed", "true");
    url.searchParams.set(
      "theme",
      document.body.classList.contains("dark-mode") ? "dark" : "light",
    );
    iframe.src = url.toString();
    contentEl.appendChild(iframe);
  },
};

export { NotesFetcher };
