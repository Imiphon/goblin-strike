import { KEY_RANGE, LEVELS, SOLFEGE, INTERVAL_NAMES } from "./constants.js";
import { linearNotes, pitchIndex, splitNote } from "./utils/notes.js";
import { randomInt } from "./utils/random.js";
import { buildKeyboard, setHighlights, clearHighlights } from "./keyboard.js";
import { preloadNotes, playNote } from "./audio/piano.js";
import { initGoblin, showGoblin, primeGoblinAudio } from "./audio/goblin.js";
import {
  startMicrophone,
  setMicrophonePaused,
  stopMicrophone,
} from "./audio/microphone.js";

const els = {
  orderText: document.getElementById("orderText"),
  toneNote: document.getElementById("toneNote"),
  toneSolfege: document.getElementById("toneSolfege"),
  toneInterval: document.getElementById("toneInterval"),
  octaveToggle: document.getElementById("octaveToggle"),
  streakBadge: document.getElementById("streakBadge"),
  streakCount: document.getElementById("streakCount"),
  btnStart: document.getElementById("btnStart"),
  btnAction: document.getElementById("btnAction"),
  btnLevel: document.getElementById("btnLevel"),
  keyboard: document.getElementById("keyboard"),
  goblinImg: document.getElementById("goblinImg"),
  tunerIndicator: document.getElementById("tunerIndicator"),
  tunerValue: document.getElementById("tunerValue"),
};

function createDetectionState() {
  return {
    matchStreak: 0,
    matchNote: null,
    wrongNote: null,
    wrongStreak: 0,
    lastMissedNote: null,
    missUntil: 0,
    successFlashUntil: 0,
    ignoreUntil: 0,
  };
}

const state = {
  running: false,
  level: LEVELS[0],
  stage: 0,
  currentTarget: null,
  previousNote: null,
  referenceNote: null,
  microphoneReady: false,
  listening: false,
  actionMode: "replay",
  detection: createDetectionState(),
  octaveStrict: false,
  streak: 0,
  notesReady: false,
};

const NOTES_IN_RANGE = linearNotes(KEY_RANGE.min, KEY_RANGE.max);
const INITIAL_REFERENCE_NOTE = "E2";
let notePreloadPromise = null;
let microphoneResumeTimeout = 0;
let tunerHoldUntil = 0;
let tunerHoldValue = null;
const TARGET_TOLERANCE_CENTS = 50;
const TARGET_TOLERANCE_OCTAVE_RELAXED = 1200; // allow any octave when toggle is off
const SUCCESS_FRAMES = 10;
const FAILURE_FRAMES = 14;
const LISTENING_RESUME_DELAY_MS = 220;
const DETECTION_GUARD_MS = 480;
const MIDI_OFFSET = 12;
const TUNER_MAX_CENTS = 300;
const TUNER_MAX_DEG = 70;
const TUNER_IN_HOLD_MS = 3200;
const A4_HZ = 440;
const ORDER_HIGHLIGHTS = [
  {
    regex: /Singe folgendes: ([^·]+) · ([^·]+) · ([^.]+)/,
    replacer: (_, part1, part2, part3) =>
      `Singe folgendes: <span class="text-highlight">${part1.trim()}</span> · <span class="text-highlight">${part2.trim()}</span> · <span class="text-highlight">${part3.trim()}</span>`,
  },
  { regex: /SUPER!/, className: "text-super" },
  { regex: /Ton(?= so oft du magst)/, className: "text-tone" },
  { regex: /Sing den gehörten Ton nach\. Der Ton wird auf dem Klavier gelb eingefärbt\./, className: "text-warning" },
  { regex: /vorherige Ton/, className: "text-tone" },
  { regex: /\bTon getroffen\b/gi, className: "text-success" },
  { regex: /\bfalscher Ton\b/gi, className: "text-danger" },
  { regex: /\bPunktabzug\b/gi, className: "text-danger" },
  { regex: /\bgeforderten Ton\b/gi, className: "text-warning" },
  { regex: /\bgelb eingefärbt\b/gi, className: "text-warning" },
];

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function applyOrderHighlights(text) {
  const source = typeof text === "string" ? text : String(text ?? "");
  let escaped = escapeHtml(source);
  ORDER_HIGHLIGHTS.forEach(({ regex, className, replacer }) => {
    if (typeof replacer === "function") {
      escaped = escaped.replace(regex, replacer);
      return;
    }
    escaped = escaped.replace(regex, (match) => {
      if (!className) return match;
      return `<span class="${className}">${match}</span>`;
    });
  });
  return escaped;
}

function setTunerIdle() {
  tunerHoldUntil = 0;
  tunerHoldValue = null;
  updateTunerIndicator(null, { forceIdle: true });
}

function updateTunerIndicator(deltaCents, { forceIdle = false } = {}) {
  const indicator = els.tunerIndicator;
  const valueEl = els.tunerValue;
  if (!indicator || !valueEl) return;
  const classes = ["is-in", "is-high", "is-low", "is-idle"];
  classes.forEach((cls) => indicator.classList.remove(cls));
  const now = performance.now();
  const holdActive = tunerHoldUntil && now < tunerHoldUntil && tunerHoldValue;
  let finalRotation = "0deg";
  let finalLabel = "–";
  let stateClass = "is-idle";
  if (typeof deltaCents === "number" && Number.isFinite(deltaCents)) {
    const clamped = Math.max(-TUNER_MAX_CENTS, Math.min(TUNER_MAX_CENTS, deltaCents));
    const rotation = (clamped / TUNER_MAX_CENTS) * TUNER_MAX_DEG;
    const rounded = Math.round(deltaCents);
    const label = `${rounded > 0 ? "+" : ""}${rounded}¢`;
    if (Math.abs(deltaCents) <= TARGET_TOLERANCE_CENTS) {
      stateClass = "is-in";
      tunerHoldUntil = now + TUNER_IN_HOLD_MS;
      tunerHoldValue = { rotation: `${rotation}deg`, label };
      finalRotation = tunerHoldValue.rotation;
      finalLabel = tunerHoldValue.label;
    } else if (holdActive) {
      stateClass = "is-in";
      finalRotation = tunerHoldValue.rotation;
      finalLabel = tunerHoldValue.label;
    } else {
      stateClass = deltaCents > 0 ? "is-high" : "is-low";
      finalRotation = `${rotation}deg`;
      finalLabel = label;
      tunerHoldUntil = 0;
      tunerHoldValue = null;
    }
  } else if (holdActive && !forceIdle) {
    stateClass = "is-in";
    finalRotation = tunerHoldValue.rotation;
    finalLabel = tunerHoldValue.label;
  } else {
    tunerHoldUntil = 0;
    tunerHoldValue = null;
  }
  indicator.style.setProperty("--needle-rotation", finalRotation);
  valueEl.textContent = finalLabel;
  indicator.classList.add(stateClass);
}

function normalizeCents(value) {
  if (!Number.isFinite(value)) return 0;
  const normalized = ((value % 1200) + 1200) % 1200;
  return normalized > 600 ? normalized - 1200 : normalized;
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function setStartButtonBusy(busy) {
  if (!els.btnStart) return;
  els.btnStart.disabled = !!busy;
  if (busy) {
    els.btnStart.setAttribute("aria-busy", "true");
  } else {
    els.btnStart.removeAttribute("aria-busy");
  }
}

async function ensureNotesReady() {
  if (state.notesReady) return;
  if (!notePreloadPromise) {
    state.notesReady = true;
    return;
  }
  try {
    await notePreloadPromise;
  } catch {
    // ignore preload failures; we will attempt playback lazily.
  } finally {
    state.notesReady = true;
  }
}

function init() {
  initGoblin(els.goblinImg);
  buildKeyboard(els.keyboard, KEY_RANGE, { onNote: handleManualKey });
  notePreloadPromise = preloadNotes(NOTES_IN_RANGE)
    .catch(() => {})
    .then(() => {
      state.notesReady = true;
    });
  updateLevelButton();
  updateToneDisplay(null);
  els.btnAction.textContent = "Noch mal";
  els.btnStart.addEventListener("click", handleStart);
  els.btnAction.addEventListener("click", handleAction);
  els.btnLevel.addEventListener("click", handleLevelToggle);
  els.octaveToggle.addEventListener("click", handleOctaveToggle);
  setActionMode("replay", { disabled: true });
  setOrderText("Höre den ersten Ton und singe ihn nach. Der Ton wird auf dem Klavier gelb eingefärbt.");
  refreshOctaveToggle();
  updateStreakDisplay();
  setTunerIdle();
}

function updateLevelButton() {
  els.btnLevel.textContent = `Level: ${state.level.label}`;
  els.btnLevel.dataset.level = state.level.id;
  els.btnLevel.title = state.level.description;
}

async function ensureMicrophone() {
  if (state.microphoneReady) return;
  try {
    await startMicrophone(handlePitchUpdate);
    state.microphoneReady = true;
  } catch (error) {
    setOrderText(
      error?.message ||
        "Mikrofon konnte nicht gestartet werden. Bitte HTTPS oder localhost nutzen."
    );
    throw error;
  }
}

function setOrderText(text) {
  if (els.orderText) {
    const safe = applyOrderHighlights(text);
    els.orderText.innerHTML = safe;
  }
}

function setActionMode(mode, { disabled = false } = {}) {
  state.actionMode = mode;
  if (mode === "next") {
    els.btnAction.textContent = "Weiter";
  } else {
    els.btnAction.textContent = "Noch mal";
  }
  els.btnAction.classList.toggle("is-next", mode === "next");
  els.btnAction.classList.toggle("is-replay", mode !== "next");
  els.btnAction.disabled = disabled;
}

function noteBase(note) {
  if (!note) return null;
  return note.replace(/\d$/, "");
}

function intervalLabel(from, to) {
  if (!from || !to) return INTERVAL_NAMES[0];
  const diff = pitchIndex(to) - pitchIndex(from);
  const abs = Math.abs(diff);
  const name = INTERVAL_NAMES[abs] || `${abs} HT`;
  if (abs === 0) return name;
  const direction = diff > 0 ? "↑" : "↓";
  return `${name} ${direction}`;
}

function updateToneDisplay(note) {
  if (!note) {
    els.toneNote.textContent = "–";
    els.toneSolfege.textContent = "–";
    els.toneInterval.textContent = "–";
    updateKeyboardHighlights();
    refreshOctaveToggle();
    return;
  }
  const [base, octave] = splitNote(note);
  els.toneNote.textContent = `${base}${octave}`;
  els.toneSolfege.textContent = SOLFEGE[base] || "–";
  els.toneInterval.textContent = intervalLabel(state.previousNote, note);
  updateKeyboardHighlights();
  refreshOctaveToggle();
}

function resetStreak() {
  state.streak = 0;
  updateStreakDisplay();
}

function incrementStreak() {
  state.streak += 1;
  updateStreakDisplay();
}

function updateStreakDisplay() {
  if (!els.streakBadge || !els.streakCount) return;
  if (state.streak >= 2) {
    els.streakCount.textContent = state.streak.toString();
    els.streakBadge.hidden = false;
    els.streakBadge.style.display = "flex";
  } else {
    els.streakBadge.hidden = true;
    els.streakBadge.style.display = "none";
  }
}

function describeTarget(note) {
  if (!note) return "";
  const [base, octave] = splitNote(note);
  const solf = SOLFEGE[base] || base;
  const interval = intervalLabel(state.referenceNote, note);
  return `${solf} · ${base}${octave} · ${interval}`;
}

async function handleStart() {
  setStartButtonBusy(true);
  try {
    await primeGoblinAudio().catch(() => {});
    if (!state.notesReady) {
      setOrderText("Audios werden vorbereitet. Bitte einen Moment warten...");
      await ensureNotesReady();
    }
    if (state.running) {
      resetSession();
      await startSession();
      return;
    }
    await startSession();
  } finally {
    setStartButtonBusy(false);
  }
}

async function startSession() {
  setActionMode("replay", { disabled: true });
  setMicrophonePaused(true);
  state.listening = false;
  const helloPromise = showGoblin("hello");
  try {
    await ensureMicrophone();
  } catch {
    await helloPromise;
    showGoblin("waiting", { playAudio: false });
    return;
  }
  await helloPromise;
  state.running = true;
  state.stage = 0;
  state.previousNote = null;
  state.currentTarget = null;
  state.referenceNote = null;
  state.detection = createDetectionState();
  clearHighlights();
  updateToneDisplay(null);
  els.btnStart.textContent = "Neu";
  resetStreak();
  await ensureNotesReady();
  const initialNote = INITIAL_REFERENCE_NOTE;
  state.referenceNote = initialNote;
  state.currentTarget = initialNote;
  updateToneDisplay(state.currentTarget);
  updateKeyboardHighlights();
  await playReference(initialNote, { announce: true });
  setOrderText("Sing den gehörten Ton nach. Der Ton wird auf dem Klavier gelb eingefärbt.");
  state.stage = 0;
  prepareListening();
}

function resetSession() {
  setMicrophonePaused(true);
  if (microphoneResumeTimeout) {
    window.clearTimeout(microphoneResumeTimeout);
    microphoneResumeTimeout = 0;
  }
  state.listening = false;
  state.running = false;
  state.stage = 0;
  state.previousNote = null;
  state.currentTarget = null;
  state.referenceNote = null;
  state.detection = createDetectionState();
  els.btnStart.textContent = "Start";
  setActionMode("replay", { disabled: true });
  updateToneDisplay(null);
  clearHighlights();
  setOrderText(
    "Höre den ersten Ton und singe ihn nach. Der Ton wird auf dem Klavier gelb eingefärbt."
  );
  resetStreak();
  showGoblin("waiting", { playAudio: false });
  stopMicrophone();
  state.microphoneReady = false;
  setTunerIdle();
}

function prepareListening() {
  if (microphoneResumeTimeout) {
    window.clearTimeout(microphoneResumeTimeout);
    microphoneResumeTimeout = 0;
  }
  state.listening = false;
  state.detection = createDetectionState();
  setTunerIdle();
  const activateListening = () => {
    state.detection.ignoreUntil = performance.now() + DETECTION_GUARD_MS;
    state.listening = true;
    if (state.microphoneReady) {
      setMicrophonePaused(false);
    }
  };
  if (state.microphoneReady) {
    microphoneResumeTimeout = window.setTimeout(() => {
      microphoneResumeTimeout = 0;
      activateListening();
    }, LISTENING_RESUME_DELAY_MS);
  } else {
    activateListening();
  }
  setActionMode("replay", { disabled: false });
  updateKeyboardHighlights();
}

async function handleAction() {
  await primeGoblinAudio().catch(() => {});
  await replayReference({ penalize: false });
}

async function replayReference({ penalize = false } = {}) {
  if (!state.referenceNote) return;
  if (penalize) {
    setOrderText("Es erklingt nochmal der vorherige Ton (Punktabzug). Hör genau hin und sing erneut.");
    showGoblin("waiting", { playAudio: false });
    resetStreak();
  } else {
    setOrderText("Es erklingt nochmal der vorherige Ton. Hör genau hin und versuche es erneut.");
    showGoblin("hello", { playAudio: false });
    state.detection.lastMissedNote = null;
    state.detection.missUntil = 0;
  }
  setMicrophonePaused(true);
  await playReference(state.referenceNote, { announce: false });
  prepareListening();
}

async function advanceToNextTarget() {
  state.stage += 1;
  setActionMode("replay", { disabled: false });
  state.currentTarget = chooseNextTargetNote();
  state.referenceNote = state.previousNote;
  updateToneDisplay(state.currentTarget);
  setOrderText(
    `Singe folgendes: ${describeTarget(
      state.currentTarget
    )}. Der blaue Ton bleibt deine letzte Referenz.`
  );
  showGoblin("waiting", { playAudio: false });
  prepareListening();
}

function chooseNextTargetNote() {
  const baseNote = state.previousNote || "C2";
  const stage = Math.max(1, state.stage);
  const bounds = getLevelBounds(state.level, stage);
  const baseIdx = pitchIndex(baseNote);
  let candidates = NOTES_IN_RANGE.filter((note) => note !== baseNote);
  candidates = candidates.filter((note) => {
    const diff = Math.abs(pitchIndex(note) - baseIdx);
    return diff >= bounds.min && diff <= bounds.max;
  });
  if (candidates.length === 0) {
    const fallback = NOTES_IN_RANGE.filter((note) => note !== baseNote);
    if (fallback.length === 0) return baseNote;
    const diffs = fallback.map((note) => Math.abs(pitchIndex(note) - baseIdx));
    const minDiff = Math.min(...diffs);
    const fallbackCandidates = fallback.filter(
      (note) => Math.abs(pitchIndex(note) - baseIdx) === minDiff
    );
    return fallbackCandidates[randomInt(0, fallbackCandidates.length - 1)];
  }
  return candidates[randomInt(0, candidates.length - 1)];
}

function getLevelBounds(level, stage) {
  if (level.id === "beginner") {
    if (stage <= 0) return { min: 0, max: 0 };
    const idx = Math.min(stage - 1, level.growthSteps.length - 1);
    return { min: stage === 0 ? 0 : 2, max: level.growthSteps[idx] };
  }
  if (level.id === "advanced") {
    const idx = Math.min(stage - 1, level.growthSteps.length - 1);
    return { min: 1, max: level.growthSteps[idx] };
  }
  return { min: 1, max: level.baseMax };
}

async function playReference(note, { announce = false } = {}) {
  setMicrophonePaused(true);
  state.listening = false;
  const successActive = state.actionMode === "next" && state.currentTarget;
  const successNote = successActive ? state.currentTarget : null;
  setHighlights({
    target: announce ? note : (successActive ? null : state.currentTarget),
    reference: state.referenceNote,
    missed: state.detection.lastMissedNote,
    success: successNote,
  });
  await playNote(note);
}

function handleLevelToggle() {
  const currentIdx = LEVELS.findIndex((lvl) => lvl.id === state.level.id);
  const nextIdx = (currentIdx + 1) % LEVELS.length;
  state.level = LEVELS[nextIdx];
  updateLevelButton();
  if (!state.running) return;
  setOrderText(`Level geändert: ${state.level.label}. Starte neu für konsistente Aufgaben.`);
}

async function handleManualKey(note) {
  if (!state.running) return;
  const isReference = state.referenceNote && note === state.referenceNote;
  const referenceIsTarget = state.referenceNote && state.currentTarget && state.referenceNote === state.currentTarget;
  const referenceReplayAllowed = isReference && (!referenceIsTarget || state.actionMode === "next");
  if (referenceReplayAllowed) {
    const wasListening = state.listening;
    if (wasListening) {
      setMicrophonePaused(true);
    }
    await playNote(note);
    if (wasListening) {
      setMicrophonePaused(false);
      state.detection.matchStreak = 0;
      state.detection.matchNote = null;
      state.detection.wrongNote = null;
      state.detection.wrongStreak = 0;
      state.detection.ignoreUntil = performance.now() + DETECTION_GUARD_MS;
    }
    return;
  }
  setOrderText(
    "Den Zielton nicht vorher hören! Singe den geforderten Ton."
  );
  resetStreak();
  setMicrophonePaused(true);
  await playNote(note);
  setMicrophonePaused(false);
}

function handlePitchUpdate(info) {
  if (!state.currentTarget) {
    setTunerIdle();
    return;
  }
  if (!state.listening) {
    return;
  }
  const now = performance.now();
  if (state.detection.ignoreUntil && now < state.detection.ignoreUntil) {
    setTunerIdle();
    state.detection.matchStreak = 0;
    state.detection.matchNote = null;
    state.detection.wrongNote = null;
    state.detection.wrongStreak = 0;
    return;
  }
  state.detection.ignoreUntil = 0;
  if (!info) {
    setTunerIdle();
    state.detection.matchStreak = 0;
    state.detection.matchNote = null;
    state.detection.wrongNote = null;
    state.detection.wrongStreak = 0;
    return;
  }
  const targetMidi = pitchIndex(state.currentTarget) + MIDI_OFFSET;
  const targetHz = A4_HZ * Math.pow(2, (targetMidi - 69) / 12);
  let deltaCents = null;
  if (
    Number.isFinite(targetHz) &&
    targetHz > 0 &&
    Number.isFinite(info.hz) &&
    info.hz > 0
  ) {
    deltaCents = 1200 * Math.log2(info.hz / targetHz);
    if (!state.octaveStrict) {
      deltaCents = normalizeCents(deltaCents);
    }
  }
  updateTunerIndicator(deltaCents);
  const targetBase = noteBase(state.currentTarget);
  const noteName = info.baseName;
  if (noteName === targetBase) {
    const tolerance = state.octaveStrict ? TARGET_TOLERANCE_CENTS : TARGET_TOLERANCE_OCTAVE_RELAXED;
    if (Math.abs(info.cents) <= tolerance) {
      if (state.detection.matchNote !== noteName) {
        state.detection.matchNote = noteName;
        state.detection.matchStreak = 0;
      }
      state.detection.matchStreak += 1;
      state.detection.wrongNote = null;
      state.detection.wrongStreak = 0;
      if (state.detection.matchStreak >= SUCCESS_FRAMES) {
        handleSuccess();
      }
      return;
    }
    state.detection.matchNote = null;
    state.detection.matchStreak = 0;
    state.detection.wrongNote = null;
    state.detection.wrongStreak = 0;
    return;
  }
  if (noteName) {
    if (state.detection.wrongNote !== noteName) {
      state.detection.wrongNote = noteName;
      state.detection.wrongStreak = 0;
    }
    state.detection.wrongStreak += 1;
    if (state.detection.wrongStreak >= FAILURE_FRAMES) {
      handleFailure();
    }
  } else {
    state.detection.wrongNote = null;
    state.detection.wrongStreak = 0;
  }
}

async function handleSuccess() {
  state.listening = false;
  setMicrophonePaused(true);
  if (microphoneResumeTimeout) {
    window.clearTimeout(microphoneResumeTimeout);
    microphoneResumeTimeout = 0;
  }
  incrementStreak();
  state.previousNote = state.currentTarget;
  state.referenceNote = state.currentTarget;
  const successOrderText =
    "Spiele den Ton so oft du magst noch einmal. Es geht gleich weiter.";
  setActionMode("next", { disabled: true });
  setOrderText("SUPER!");
  await Promise.all([showGoblin("win"), delay(2000)]);
  setOrderText(successOrderText);
  showGoblin("hello", { playAudio: false });
  await delay(400);
  await advanceToNextTarget();
  state.detection.successFlashUntil = performance.now() + 1400;
  updateKeyboardHighlights();
  window.setTimeout(() => {
    updateKeyboardHighlights();
  }, 1500);
}

async function handleFailure() {
  state.listening = false;
  setMicrophonePaused(true);
  setTunerIdle();
  if (microphoneResumeTimeout) {
    window.clearTimeout(microphoneResumeTimeout);
    microphoneResumeTimeout = 0;
  }
  resetStreak();
  setOrderText("Das war ein falscher Ton. Der Kobold spielt den vorherigen Ton noch einmal.");
  state.detection.lastMissedNote = state.currentTarget;
  state.detection.missUntil = performance.now() + 2500;
  updateKeyboardHighlights();
  await showGoblin("lose");
  await delay(500);
  await replayReference({ penalize: false });
}

function updateKeyboardHighlights() {
  const now = performance.now();
  const missActive = state.detection.missUntil && now < state.detection.missUntil;
  const missed = missActive ? state.detection.lastMissedNote : null;
  const successActive = state.detection.successFlashUntil && now < state.detection.successFlashUntil;
  const success = successActive ? state.currentTarget : null;
  let target = state.actionMode === "next" ? null : state.currentTarget;
  if (successActive) {
    target = null;
  }
  let reference = state.referenceNote;
  if (successActive && reference === success) {
    reference = null;
  }
  if (missed && target === missed) {
    target = null;
  }
  if (missed && reference === missed) {
    reference = null;
  }
  if (reference && target && reference === target) {
    reference = null;
  }
  setHighlights({
    target,
    reference,
    missed,
    success,
  });
  if (!missActive) {
    state.detection.lastMissedNote = null;
    state.detection.missUntil = 0;
  }
  if (!successActive) {
    state.detection.successFlashUntil = 0;
  }
}

window.addEventListener("beforeunload", () => {
  stopMicrophone();
  if (microphoneResumeTimeout) {
    window.clearTimeout(microphoneResumeTimeout);
    microphoneResumeTimeout = 0;
  }
});

init();
function handleOctaveToggle() {
  state.octaveStrict = !state.octaveStrict;
  refreshOctaveToggle();
}

function refreshOctaveToggle() {
  if (!els.octaveToggle) return;
  const pressed = state.octaveStrict;
  const label = "OKTAVTREU";
  els.octaveToggle.setAttribute("aria-pressed", pressed ? "true" : "false");
  els.octaveToggle.classList.toggle("is-relaxed", !pressed);
  els.octaveToggle.title = "Oktavtreue umschalten";
  els.octaveToggle.textContent = label;
}
