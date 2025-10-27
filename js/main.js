import { KEY_RANGE, LEVELS, SOLFEGE, INTERVAL_NAMES } from "./constants.js";
import { linearNotes, pitchIndex, splitNote } from "./utils/notes.js";
import { randomInt } from "./utils/random.js";
import { buildKeyboard, setHighlights, clearHighlights } from "./keyboard.js";
import { preloadNotes, playNote } from "./audio/piano.js";
import { initGoblin, showGoblin } from "./audio/goblin.js";
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
  scoreTotal: document.getElementById("scoreTotal"),
  scorePenalties: document.getElementById("scorePenalties"),
  btnStart: document.getElementById("btnStart"),
  btnAction: document.getElementById("btnAction"),
  btnLevel: document.getElementById("btnLevel"),
  keyboard: document.getElementById("keyboard"),
  goblinImg: document.getElementById("goblinImg"),
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
  };
}

const state = {
  running: false,
  level: LEVELS[0],
  stage: 0,
  currentTarget: null,
  previousNote: null,
  referenceNote: null,
  successes: 0,
  penalties: 0,
  microphoneReady: false,
  listening: false,
  actionMode: "replay",
  detection: createDetectionState(),
};

const NOTES_IN_RANGE = linearNotes(KEY_RANGE.min, KEY_RANGE.max);
const TARGET_TOLERANCE_CENTS = 35;
const SUCCESS_FRAMES = 10;
const FAILURE_FRAMES = 14;
const ORDER_HIGHLIGHTS = [
  { regex: /\bTon getroffen\b/gi, className: "text-success" },
  { regex: /\bfalscher Ton\b/gi, className: "text-danger" },
  { regex: /\bPunktabzug\b/gi, className: "text-danger" },
  { regex: /\bgeforderten Ton\b/gi, className: "text-warning" },
  { regex: /\beingefärbt\b/gi, className: "text-warning" },
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
  ORDER_HIGHLIGHTS.forEach(({ regex, className }) => {
    escaped = escaped.replace(regex, (match) => `<span class="${className}">${match}</span>`);
  });
  return escaped;
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function init() {
  initGoblin(els.goblinImg);
  buildKeyboard(els.keyboard, KEY_RANGE, { onNote: handleManualKey });
  preloadNotes(NOTES_IN_RANGE).catch(() => {});
  updateLevelButton();
  updateScore();
  updateToneDisplay(null);
  els.btnStart.addEventListener("click", handleStart);
  els.btnAction.addEventListener("click", handleAction);
  els.btnLevel.addEventListener("click", handleLevelToggle);
  setActionMode("replay", { disabled: true });
  setOrderText(
    "Höre den ersten Ton und singe ihn nach. Der Ton wird auf dem Klavier eingefärbt. Wenn du ihn vor dem Singen noch einmal spielst, gibt es einen Punktabzug."
  );
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
    els.btnAction.textContent = "Nächster Ton";
  } else {
    els.btnAction.textContent = "Noch mal";
  }
  els.btnAction.disabled = disabled;
}

function updateScore() {
  const total = Math.max(0, state.successes * 5 - state.penalties);
  els.scoreTotal.textContent = total.toString();
  els.scorePenalties.textContent = state.penalties.toString();
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
    return;
  }
  const [base, octave] = splitNote(note);
  els.toneNote.textContent = `${base}${octave}`;
  els.toneSolfege.textContent = SOLFEGE[base] || "–";
  els.toneInterval.textContent = intervalLabel(state.previousNote, note);
  updateKeyboardHighlights();
}

function describeTarget(note) {
  if (!note) return "";
  const [base, octave] = splitNote(note);
  const solf = SOLFEGE[base] || base;
  const interval = intervalLabel(state.referenceNote, note);
  return `${solf} · ${base}${octave} · ${interval}`;
}

async function handleStart() {
  if (state.running) {
    resetSession();
    await startSession();
    return;
  }
  await startSession();
}

async function startSession() {
  try {
    await ensureMicrophone();
  } catch {
    return;
  }
  state.running = true;
  state.stage = 0;
  state.successes = 0;
  state.penalties = 0;
  state.previousNote = null;
  state.currentTarget = null;
  state.referenceNote = null;
  state.detection = createDetectionState();
  updateScore();
  clearHighlights();
  updateToneDisplay(null);
  els.btnStart.textContent = "Restart";
  setActionMode("replay", { disabled: true });
  setMicrophonePaused(true);
  await showGoblin("hello");
  await playReference("C2", { announce: true });
  setOrderText("Sing den gehörten Ton nach. Der Kobold wartet gespannt!");
  state.referenceNote = "C2";
  state.currentTarget = "C2";
  state.previousNote = null;
  updateToneDisplay(state.currentTarget);
  updateKeyboardHighlights();
  state.stage = 0;
  prepareListening();
}

function resetSession() {
  setMicrophonePaused(true);
  state.running = false;
  state.stage = 0;
  state.successes = 0;
  state.penalties = 0;
  state.previousNote = null;
  state.currentTarget = null;
  state.referenceNote = null;
  state.detection = createDetectionState();
  els.btnStart.textContent = "Start";
  setActionMode("replay", { disabled: true });
  updateToneDisplay(null);
  updateScore();
  clearHighlights();
  setOrderText(
    "Höre den ersten Ton und singe ihn nach. Der Ton wird auf dem Klavier eingefärbt. Wenn du ihn vor dem Singen noch einmal spielst, gibt es einen Punktabzug."
  );
  showGoblin("waiting", { playAudio: false });
  stopMicrophone();
  state.microphoneReady = false;
}

function prepareListening() {
  state.listening = true;
  state.detection = createDetectionState();
  if (state.microphoneReady) {
    setMicrophonePaused(false);
  }
  setActionMode("replay", { disabled: false });
  updateKeyboardHighlights();
}

async function handleAction() {
  if (state.actionMode === "next") {
    await advanceToNextTarget();
    return;
  }
  await replayReference();
}

async function replayReference({ penalize = true } = {}) {
  if (!state.referenceNote) return;
  if (penalize) {
    state.penalties += 1;
    updateScore();
    setOrderText("Referenzton läuft (Punktabzug). Hör genau hin und sing erneut.");
    showGoblin("waiting", { playAudio: false });
  } else {
    setOrderText("Referenzton läuft. Hör genau hin und versuche es erneut.");
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
  const successActive = state.actionMode === "next" && state.currentTarget;
  const successNote = successActive ? state.currentTarget : null;
  setHighlights({
    target: announce ? note : (successActive ? null : state.currentTarget),
    reference: state.referenceNote,
    missed: state.detection.lastMissedNote,
    success: successNote,
  });
  await playNote(note);
  setMicrophonePaused(false);
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
    }
    return;
  }
  state.penalties += 1;
  updateScore();
  setOrderText(
    "Du hast die Taste gespielt. Punktabzug! Singe nun ohne weitere Hilfe den geforderten Ton."
  );
  setMicrophonePaused(true);
  await playNote(note);
  setMicrophonePaused(false);
}

function handlePitchUpdate(info) {
  if (!state.listening || !state.currentTarget) return;
  if (!info) {
    state.detection.matchStreak = 0;
    state.detection.matchNote = null;
    state.detection.wrongNote = null;
    state.detection.wrongStreak = 0;
    return;
  }
  const targetBase = noteBase(state.currentTarget);
  const noteName = info.baseName;
  if (noteName === targetBase && Math.abs(info.cents) <= TARGET_TOLERANCE_CENTS) {
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
  state.successes += 1;
  updateScore();
  state.previousNote = state.currentTarget;
  state.referenceNote = state.currentTarget;
  setOrderText(
    'Spiele den Ton so oft du magst noch einmal. Klicke auf "Nächster Ton" und singe ihn.'
  );
  await showGoblin("win");
  showGoblin("waiting", { playAudio: false });
  setActionMode("next", { disabled: false });
  state.detection.successFlashUntil = performance.now() + 1400;
  updateKeyboardHighlights();
  window.setTimeout(() => {
    updateKeyboardHighlights();
  }, 1500);
}

async function handleFailure() {
  state.listening = false;
  setMicrophonePaused(true);
  setOrderText("Das war ein falscher Ton. Der Kobold spielt den Referenzton noch einmal.");
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
});

init();
