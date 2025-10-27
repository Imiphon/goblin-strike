import { detectPitchHz, hzToMidi, midiToNoteName } from "../pitch.js";

let audioCtx;
let analyser;
let source;
let rafId;
let timeData;
let byteData;
let paused = true;
let active = false;
let handler = null;

export async function startMicrophone(onPitch) {
  handler = onPitch;
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Kein getUserMedia verfügbar – bitte HTTPS oder localhost nutzen.");
  }
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") {
    await audioCtx.resume();
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  source = audioCtx.createMediaStreamSource(stream);
  source.connect(analyser);
  timeData = new Float32Array(analyser.fftSize);
  active = true;
  paused = true;
  loop();
}

export function setMicrophonePaused(value) {
  paused = !!value;
}

export function stopMicrophone() {
  active = false;
  paused = true;
  if (rafId) cancelAnimationFrame(rafId);
  if (source?.mediaStream) {
    source.mediaStream.getTracks().forEach((track) => track.stop());
  }
  if (audioCtx) {
    audioCtx.close().catch(() => {});
  }
  handler = null;
}

function loop() {
  if (!active) return;
  if (analyser) {
    if (typeof analyser.getFloatTimeDomainData === "function") {
      analyser.getFloatTimeDomainData(timeData);
    } else {
      if (!byteData || byteData.length !== analyser.fftSize) {
        byteData = new Uint8Array(analyser.fftSize);
      }
      analyser.getByteTimeDomainData(byteData);
      if (!timeData || timeData.length !== analyser.fftSize) {
        timeData = new Float32Array(analyser.fftSize);
      }
      for (let i = 0; i < byteData.length; i += 1) {
        timeData[i] = (byteData[i] - 128) / 128;
      }
    }
    if (!paused && typeof handler === "function") {
      const hz = detectPitchHz(timeData.slice(), audioCtx.sampleRate);
      if (hz) {
        const midi = hzToMidi(hz);
        const note = midiToNoteName(midi, "en");
        handler({
          hz,
          midi,
          name: `${note.name}${note.octave}`,
          baseName: note.name,
          cents: note.cents,
        });
      } else {
        handler(null);
      }
    }
  }
  rafId = requestAnimationFrame(loop);
}
