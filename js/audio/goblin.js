import { GOBLIN_STATES } from "../constants.js";
// Playback relies on direct user interaction (button presses) to satisfy mobile autoplay rules.

let imgEl = null;
let currentAudio = null;

function audioPath(name) {
  return `./assets/audio/goblin/${name}.mp3`;
}

function imagePath(name) {
  return `./assets/images/goblin/${name}.png`;
}

export function initGoblin(imageElement) {
  imgEl = imageElement;
  if (imgEl) {
    imgEl.dataset.goblinState = "waiting";
    imgEl.src = imagePath(GOBLIN_STATES.waiting.img);
    imgEl.alt = GOBLIN_STATES.waiting.alt;
  }
}

export function stopGoblinAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}

export function showGoblin(stateId, { playAudio = true } = {}) {
  const meta = GOBLIN_STATES[stateId] || GOBLIN_STATES.waiting;
  if (imgEl) {
    imgEl.dataset.goblinState = stateId;
    imgEl.src = imagePath(meta.img);
    imgEl.alt = meta.alt;
    if (playAudio) {
      imgEl.classList.add("is-animating");
    } else {
      imgEl.classList.remove("is-animating");
    }
  }

  if (!playAudio) {
    stopGoblinAudio();
    return Promise.resolve();
  }

  stopGoblinAudio();

  return new Promise((resolve) => {
    const audio = new Audio(audioPath(meta.audio));
    currentAudio = audio;
    const fallbackMs = Math.max(0, meta.fallbackMs ?? 1200);
    let resolved = false;
    let fallbackId = window.setTimeout(() => {
      fallbackId = null;
      finish();
    }, fallbackMs);

    function finish() {
      if (resolved) return;
      resolved = true;
      if (fallbackId) {
        window.clearTimeout(fallbackId);
        fallbackId = null;
      }
      if (currentAudio === audio) {
        currentAudio = null;
      }
      if (imgEl) {
        imgEl.classList.remove("is-animating");
      }
      resolve();
    }

    audio.addEventListener(
      "ended",
      () => {
        finish();
      },
      { once: true }
    );
    audio.addEventListener(
      "error",
      () => {
        if (currentAudio === audio) {
          currentAudio = null;
        }
        // Let the fallback timer handle finish to keep the image visible a moment.
      },
      { once: true }
    );
    audio.addEventListener(
      "loadedmetadata",
      () => {
        if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
          return;
        }
        const durationMs = Math.ceil(audio.duration * 1000) + 200;
        if (fallbackId) {
          window.clearTimeout(fallbackId);
        }
        fallbackId = window.setTimeout(() => {
          fallbackId = null;
          finish();
        }, Math.max(durationMs, fallbackMs));
      },
      { once: true }
    );
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise.catch(() => {
        // Playback failed (likely autoplay policy). Keep the goblin visible until fallback triggers.
      });
    }
  });
}
