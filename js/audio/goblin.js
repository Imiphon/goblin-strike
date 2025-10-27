import { GOBLIN_STATES } from "../constants.js";

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
    return Promise.resolve();
  }

  stopGoblinAudio();

  return new Promise((resolve) => {
    const audio = new Audio(audioPath(meta.audio));
    currentAudio = audio;
    audio.addEventListener(
      "ended",
      () => {
        if (currentAudio === audio) {
          currentAudio = null;
        }
        if (imgEl) {
          imgEl.classList.remove("is-animating");
        }
        resolve();
      },
      { once: true }
    );
    audio.addEventListener(
      "error",
      () => {
        if (currentAudio === audio) {
          currentAudio = null;
        }
        if (imgEl) {
          imgEl.classList.remove("is-animating");
        }
        resolve();
      },
      { once: true }
    );
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise.catch(() => resolve());
    }
  });
}
