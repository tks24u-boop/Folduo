// Musical grid shared by visuals and the BGM generator (audio/bgm.py uses the same numbers).
// 128 BPM, 4/4. 24 bars == exactly 45.0 s.

export const BPM = 128;
export const SPB = 60 / BPM; // seconds per beat = 0.46875
export const BAR = SPB * 4; // seconds per bar  = 1.875

/** Time (s) of a musical position. bar is 1-indexed, beat is 0-indexed (may be fractional). */
export const B = (bar, beat = 0) => (bar - 1) * BAR + beat * SPB;

export const beatIndex = (t) => Math.floor(t / SPB + 1e-6);
export const barIndex = (t) => Math.floor(t / BAR + 1e-6) + 1;

/** Seconds since the most recent beat. */
export const sinceBeat = (t) => t - beatIndex(t) * SPB;

/** 1 on every beat, decaying exponentially. Use for pulsing glow / scale to the kick. */
export const beatPulse = (t, decay = 10) => Math.exp(-sinceBeat(t) * decay);

/** Pulse on every `div`-th of a beat (div = 2 -> eighth notes). */
export const subPulse = (t, div = 2, decay = 16) => {
  const step = SPB / div;
  const s = t - Math.floor(t / step + 1e-6) * step;
  return Math.exp(-s * decay);
};

/** True if the kick is playing at time t (used to only pulse inside drop sections). */
export const inRange = (t, a, b) => t >= a && t < b;
