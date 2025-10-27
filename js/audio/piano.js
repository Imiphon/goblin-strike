const htmlAudioCache = new Map();

function noteToFile(note) {
  const normalized = note.toLowerCase();
  const safe = encodeURIComponent(normalized);
  return `./assets/audio/piano/${safe}.mp3`;
}

function loadHtmlAudio(note) {
  if (htmlAudioCache.has(note)) {
    return htmlAudioCache.get(note);
  }
  const src = noteToFile(note);
  const audio = new Audio(src);
  audio.preload = "auto";
  htmlAudioCache.set(note, audio);
  return audio;
}

export function preloadNotes(notes) {
  const tasks = (notes || []).map(
    (note) =>
      new Promise((resolve) => {
        const audio = loadHtmlAudio(note);
        const cleanup = () => {
          audio.removeEventListener("canplaythrough", onReady);
          audio.removeEventListener("error", onReady);
        };
        const onReady = () => {
          cleanup();
          resolve();
        };
        audio.addEventListener("canplaythrough", onReady, { once: true });
        audio.addEventListener("error", onReady, { once: true });
        if (typeof audio.load === "function") {
          try {
            audio.load();
          } catch (_) {
            resolve();
          }
        }
      })
  );
  return Promise.all(tasks);
}

export function playNote(note, velocity = 1) {
  return new Promise((resolve, reject) => {
    try {
      const base = loadHtmlAudio(note);
      const instance = base.cloneNode();
      instance.volume = Math.max(0, Math.min(1, velocity));
      instance.addEventListener("ended", () => resolve(), { once: true });
      instance.addEventListener("error", () => resolve(), { once: true });
      const playPromise = instance.play();
      if (playPromise && typeof playPromise.then === "function") {
        playPromise.catch(() => resolve());
      }
    } catch (err) {
      reject(err);
    }
  });
}
