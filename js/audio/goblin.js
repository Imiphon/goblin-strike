import { GOBLIN_STATES } from "../constants.js";
// Playback relies on direct user interaction (button presses) to satisfy mobile autoplay rules.

let imgEl = null;
let currentAudio = null;
let primed = false;
let primePromise = null;
const audioCache = new Map();

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

function getAudio(name) {
  let audio = audioCache.get(name);
  if (!audio) {
    audio = new Audio(audioPath(name));
    audio.preload = "auto";
    audioCache.set(name, audio);
  }
  return audio;
}

export function primeGoblinAudio() {
  if (primed) return primePromise || Promise.resolve();
  if (primePromise) return primePromise;
  const ids = ["hello", "win", "lose", "waiting"];
  primePromise = Promise.all(
    ids.map((id) => {
      const audio = getAudio(id);
      audio.muted = true;
      audio.currentTime = 0;
      const playPromise = audio.play();
      const settle = () => {
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
      };
      if (playPromise && typeof playPromise.then === "function") {
        return playPromise.catch(() => {}).finally(settle);
      }
      settle();
      return Promise.resolve();
    })
  ).finally(() => {
    primed = true;
  });
  return primePromise;
}

export function stopGoblinAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}

export function showGoblin(stateId, { playAudio = true } = {}) {
  if (!primed) {
    primeGoblinAudio().catch(() => {});
  }
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
    const audio = getAudio(meta.audio);
    try {
      audio.pause();
    } catch {}
    audio.currentTime = 0;
    audio.muted = false;
    audio.volume = 1;
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
      audio.onended = null;
      audio.onerror = null;
      audio.onloadedmetadata = null;
      if (imgEl) {
        imgEl.classList.remove("is-animating");
      }
      resolve();
    }

    audio.onended = () => finish();
    audio.onerror = () => {
      if (currentAudio === audio) {
        currentAudio = null;
      }
      // Let fallback finish handle the rest
    };
    audio.onloadedmetadata = () => {
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
    };
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise.catch(() => {
        // Playback failed (likely autoplay policy). Keep the goblin visible until fallback triggers.
      });
    }
  });
}
