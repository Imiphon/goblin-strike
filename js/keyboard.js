import { linearNotes } from "./utils/notes.js";
import { playNote } from "./audio/piano.js";

let keyboardContainer = null;
let noteClickHandler = null;
const highlightState = { target: null, reference: null, success: null };

function createKeyElement(note) {
  const key = document.createElement("div");
  key.className = note.includes("#") ? "key black" : "key white";
  key.dataset.note = note;
  const label = document.createElement("span");
  label.className = "key-label";
  label.textContent = note.toUpperCase();
  key.appendChild(label);
  return key;
}

function attachHandlers(container) {
  container.addEventListener("mousedown", handleInteraction);
  container.addEventListener("touchstart", handleInteraction, { passive: true });
}

function handleInteraction(event) {
  const key = event.target.closest(".key");
  if (!key) return;
  const note = key.dataset.note;
  key.classList.add("active");
  window.setTimeout(() => key.classList.remove("active"), 160);
  playNote(note).catch(() => {});
  if (typeof noteClickHandler === "function") {
    noteClickHandler(note);
  }
}

export function buildKeyboard(container, range, { onNote } = {}) {
  keyboardContainer = container;
  noteClickHandler = onNote;
  const notes = linearNotes(range.min, range.max);
  container.innerHTML = "";

  const whiteSlots = [];
  const fragment = document.createDocumentFragment();
  notes.forEach((note) => {
    if (note.includes("#")) return;
    const slot = document.createElement("div");
    slot.className = "key-slot";
    const whiteKey = createKeyElement(note);
    slot.appendChild(whiteKey);
    fragment.appendChild(slot);
    whiteSlots.push({ slot, whiteKey });
  });
  container.appendChild(fragment);

  container.style.setProperty("--white-key-count", whiteSlots.length.toString());

  notes.forEach((note, idx) => {
    if (!note.includes("#")) return;
    const prevWhiteIndex = findPreviousWhiteIndex(notes, idx);
    const entry = whiteSlots[prevWhiteIndex];
    if (!entry) return;
    const black = createKeyElement(note);
    entry.slot.appendChild(black);
    const freeze = () => entry.whiteKey.classList.add("freeze-hover");
    const unfreeze = () => entry.whiteKey.classList.remove("freeze-hover");
    black.addEventListener("mouseenter", freeze);
    black.addEventListener("mouseleave", unfreeze);
    black.addEventListener("touchstart", freeze, { passive: true });
    black.addEventListener("touchend", unfreeze);
    black.addEventListener("touchcancel", unfreeze);
  });

  attachHandlers(container);
}

function findPreviousWhiteIndex(notes, index) {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (!notes[i].includes("#")) {
      const whitesBefore =
        notes.slice(0, i + 1).filter((note) => !note.includes("#")).length - 1;
      return Math.max(0, whitesBefore);
    }
  }
  return 0;
}

export function setHighlights({
  target = null,
  reference = null,
  missed = null,
  success = null,
} = {}) {
  if (!keyboardContainer) return;
  const apply = (note, className) => {
    if (!note) return;
    const el = keyboardContainer.querySelector(`.key[data-note="${note}"]`);
    if (el) el.classList.add(className);
  };
  const clearClass = (className) => {
    keyboardContainer
      .querySelectorAll(`.key.${className}`)
      .forEach((key) => key.classList.remove(className));
  };

  if (highlightState.target !== target) {
    clearClass("target");
    highlightState.target = target;
    apply(target, "target");
  }
  if (highlightState.reference !== reference) {
    clearClass("reference");
    highlightState.reference = reference;
    apply(reference, "reference");
  }
  if (highlightState.success !== success) {
    clearClass("success");
    highlightState.success = success;
    apply(success, "success");
  }
  clearClass("missed");
  apply(missed, "missed");
}

export function clearHighlights() {
  if (!keyboardContainer) return;
  ["target", "reference", "success", "active", "playback-active", "missed"].forEach((className) => {
    keyboardContainer
      .querySelectorAll(`.key.${className}`)
      .forEach((el) => el.classList.remove(className));
  });
  highlightState.target = null;
  highlightState.reference = null;
  highlightState.success = null;
}
