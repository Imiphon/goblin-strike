export const NOTE_ORDER = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const KEY_RANGE = { min: "C2", max: "C4" };

export const GOBLIN_STATES = {
  hello: { img: "hello", audio: "hello", alt: "Goblin begrüßt dich", fallbackMs: 1400 },
  waiting: { img: "waiting", audio: "waiting", alt: "Goblin wartet gespannt", fallbackMs: 800 },
  win: { img: "win", audio: "win", alt: "Goblin sagt ok", fallbackMs: 2000 },
  lose: { img: "lose", audio: "lose", alt: "Goblin lacht", fallbackMs: 2000 },
};

export const LEVELS = [
  {
    id: "beginner",
    label: "Start",
    description: "Starte mit großen Sekunden, steigere Intervalle bis zur Tredezime.",
    baseMax: 2,
    growthSteps: [2, 4, 5, 7, 9, 12, 14, 17, 19, 21],
  },
  {
    id: "advanced",
    label: "Geübt",
    description: "Intervallsprünge bis zur Quinte auf oder ab.",
    baseMax: 7,
    growthSteps: [7, 9, 12, 14, 17],
  },
  {
    id: "pro",
    label: "Profi",
    description: "Kleine Sekunde bis Tredezime in beliebiger Richtung.",
    baseMax: 21,
    growthSteps: [21],
  },
];

export const SOLFEGE = {
  C: "Do",
  "C#": "Di",
  D: "Re",
  "D#": "Ri",
  E: "Mi",
  F: "Fa",
  "F#": "Fi",
  G: "So",
  "G#": "Si",
  A: "La",
  "A#": "Li",
  B: "Ti",
};

export const INTERVAL_NAMES = {
  0: "Prime",
  1: "kl. Sekunde",
  2: "gr. Sekunde",
  3: "kl. Terz",
  4: "gr. Terz",
  5: "Quart",
  6: "Tritonus",
  7: "Quinte",
  8: "kl. Sexte",
  9: "gr. Sexte",
  10: "kl. Septime",
  11: "gr. Septime",
  12: "Oktave",
  13: "kl. None",
  14: "gr. None",
  15: "kl. Dezime",
  16: "gr. Dezime",
  17: "Undezime",
  18: "kl. Duodezime",
  19: "gr. Duodezime",
  20: "kl. Tredezime",
  21: "gr. Tredezime",
};
