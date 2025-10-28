const MIN_SIGNAL_RMS = 3e-4;

export function detectPitchHz(timeDomain, sampleRate) {
  const size = timeDomain.length;
  let mean = 0;
  for (let i = 0; i < size; i += 1) mean += timeDomain[i];
  mean /= size;
  let rms = 0;
  for (let i = 0; i < size; i += 1) {
    const v = timeDomain[i] - mean;
    timeDomain[i] = v;
    rms += v * v;
  }
  rms = Math.sqrt(rms / size);
  if (rms < MIN_SIGNAL_RMS) return null;

  const maxLag = Math.floor(sampleRate / 50);
  const minLag = Math.floor(sampleRate / 1000);
  const ac = new Float32Array(maxLag);
  for (let lag = minLag; lag < maxLag; lag += 1) {
    let sum = 0;
    for (let i = 0; i < size - lag; i += 1) {
      sum += timeDomain[i] * timeDomain[i + lag];
    }
    ac[lag] = sum;
  }

  let bestLag = -1;
  let bestVal = 0;
  for (let lag = minLag + 1; lag < maxLag - 1; lag += 1) {
    if (ac[lag] > ac[lag - 1] && ac[lag] > ac[lag + 1] && ac[lag] > bestVal) {
      bestVal = ac[lag];
      bestLag = lag;
    }
  }
  if (bestLag <= 0) return null;

  const y1 = ac[bestLag - 1];
  const y2 = ac[bestLag];
  const y3 = ac[bestLag + 1];
  const shift = 0.5 * (y1 - y3) / (y1 - 2 * y2 + y3);
  const trueLag = bestLag + (Number.isFinite(shift) ? shift : 0);

  return sampleRate / trueLag;
}

const A4 = 440;
export function hzToMidi(hz) {
  return 69 + 12 * Math.log2(hz / A4);
}
export function midiToNoteName(midi, locale = "en") {
  const namesEN = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const namesDE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "H"];
  const names = locale === "de" ? namesDE : namesEN;
  const n = Math.round(midi);
  const name = names[(n % 12 + 12) % 12];
  const octave = Math.floor(n / 12) - 1;
  const cents = Math.round((midi - n) * 100);
  return { name, octave, cents };
}

export function hzToCentClass(hz) {
  const midi = hzToMidi(hz);
  const cents = (midi * 100) % 1200;
  return (cents + 1200) % 1200;
}
