import { writeFileSync } from 'node:fs';

const SR = 44100;
const DUR = 40;
const N = SR * DUR;
const L = new Float32Array(N);
const R = new Float32Array(N);

const chords = [
  { start: 0, dur: 10.4, notes: [110.00, 164.81, 261.63, 392.00] },
  { start: 9.2, dur: 10.4, notes: [87.31, 130.81, 220.00, 329.63] },
  { start: 18.4, dur: 10.4, notes: [130.81, 196.00, 329.63, 392.00] },
  { start: 27.6, dur: 12.4, notes: [98.00, 146.83, 246.94, 369.99] }
];

const TWO_PI = Math.PI * 2;
const smooth = (x) => {
  const p = Math.max(0, Math.min(1, x));
  return p * p * (3 - 2 * p);
};

for (const ch of chords) {
  const s0 = Math.floor(ch.start * SR);
  const s1 = Math.min(N, Math.floor((ch.start + ch.dur) * SR));
  for (let ni = 0; ni < ch.notes.length; ni++) {
    const f = ch.notes[ni];
    const amp = [0.16, 0.13, 0.10, 0.075][ni] ?? 0.08;
    const pan = [-0.28, 0.22, -0.12, 0.32][ni] ?? 0;
    const gl = Math.sqrt((1 - pan) / 2);
    const gr = Math.sqrt((1 + pan) / 2);
    const phase = ni * 1.37;
    for (let i = s0; i < s1; i++) {
      const t = i / SR;
      const local = t - ch.start;
      const env = smooth(local / 2.4) * smooth((ch.dur - local) / 2.0);
      const lfo = 0.86 + 0.14 * Math.sin(TWO_PI * 0.065 * t + phase);
      const base = Math.sin(TWO_PI * f * t + phase);
      const det = 0.46 * Math.sin(TWO_PI * f * 1.0027 * t + phase + 1.9);
      const h2 = 0.26 * Math.sin(TWO_PI * f * 2 * t + phase * 0.5);
      const h3 = 0.10 * Math.sin(TWO_PI * f * 3 * t + phase * 0.8);
      const v = (base + det + h2 + h3) * amp * env * lfo;
      L[i] += v * gl;
      R[i] += v * gr;
    }
  }
}

// low-frequency pulse, a quiet heartbeat under the pad
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const beat = 2.0;
  const ph = (t % beat) / beat;
  const env = Math.exp(-ph * 16) * 0.055;
  const v = Math.sin(TWO_PI * 55 * t) * env;
  L[i] += v * 0.5;
  R[i] += v * 0.5;
}

// soft thump at each cut
const cuts = [0, 4.6, 10.8, 17.6, 23.6, 29.2, 34.8];
for (const cut of cuts) {
  const s0 = Math.floor(cut * SR);
  const len = Math.floor(0.32 * SR);
  for (let j = 0; j < len; j++) {
    const i = s0 + j;
    if (i >= N) break;
    const t = j / SR;
    const env = Math.exp(-t * 14);
    const v = Math.sin(TWO_PI * 72 * t) * env * 0.11;
    L[i] += v;
    R[i] += v;
  }
}

// air: very low broadband texture
let seed = 1234567;
const noise = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return (seed / 4294967296) * 2 - 1;
};
let lp = 0;
for (let i = 0; i < N; i++) {
  const n = noise();
  lp += (n - lp) * 0.015;
  const t = i / SR;
  const env = smooth(t / 3) * smooth((DUR - t) / 4) * 0.007;
  L[i] += lp * env;
  R[i] += lp * env * 0.92;
}

// simple lowpass + highpass
function filter(channel) {
  let lpState = 0;
  let hpPrev = 0;
  let hpState = 0;
  const a = 1 - Math.exp(-TWO_PI * 1350 / SR);
  for (let i = 0; i < N; i++) {
    const x = channel[i];
    lpState += (x - lpState) * a;
    const hp = 0.996 * (hpState + lpState - hpPrev);
    hpPrev = lpState;
    hpState = hp;
    channel[i] = hp;
  }
}
filter(L);
filter(R);

// two-tap room: short feedback delays for width
function room(channel, delayMs, feedback, mix) {
  const d = Math.floor((delayMs / 1000) * SR);
  const buf = new Float32Array(d);
  let idx = 0;
  for (let i = 0; i < N; i++) {
    const delayed = buf[idx];
    const out = channel[i] + delayed * mix;
    buf[idx] = out * feedback;
    idx = (idx + 1) % d;
    channel[i] = out;
  }
}
room(L, 83, 0.26, 0.20);
room(R, 113, 0.24, 0.20);

// fades
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fade = smooth(t / 1.4) * smooth((DUR - t) / 2.8);
  L[i] *= fade;
  R[i] *= fade;
}

// normalize to a comfortable peak
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const gain = peak > 0 ? 0.62 / peak : 1;

const out = Buffer.alloc(44 + N * 4);
out.write('RIFF', 0);
out.writeUInt32LE(36 + N * 4, 4);
out.write('WAVE', 8);
out.write('fmt ', 12);
out.writeUInt32LE(16, 16);
out.writeUInt16LE(1, 20);
out.writeUInt16LE(2, 22);
out.writeUInt32LE(SR, 24);
out.writeUInt32LE(SR * 4, 28);
out.writeUInt16LE(4, 32);
out.writeUInt16LE(16, 34);
out.write('data', 36);
out.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  const l = Math.max(-1, Math.min(1, L[i] * gain));
  const r = Math.max(-1, Math.min(1, R[i] * gain));
  out.writeInt16LE(Math.round(l * 32767), 44 + i * 4);
  out.writeInt16LE(Math.round(r * 32767), 46 + i * 4);
}
writeFileSync('C:/Users/llyyt/Desktop/DayFlow/promo/assets/soundtrack.wav', out);
console.log('wrote soundtrack.wav', (out.length / 1024 / 1024).toFixed(2), 'MB', 'peak', peak.toFixed(3));
