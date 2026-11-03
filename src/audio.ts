// Tiny synthesized sound effects (no assets needed). Music lives in music.ts.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
let lastPlay = 0;
let voices = 0;

/** shared AudioContext (created lazily; browsers only let it run after a user gesture) */
export function context(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.35;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function ac(): AudioContext | null {
  return muted ? null : context();
}

export function setMuted(m: boolean) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.35;
}
export function isMuted() {
  return muted;
}

function voice(fn: (c: AudioContext, out: GainNode, t: number) => number) {
  const c = ac();
  if (!c || !master) return;
  // throttle so a pile of dominoes doesn't become white noise
  const now = c.currentTime;
  if (voices > 10 || now - lastPlay < 0.012) return;
  lastPlay = now;
  const g = c.createGain();
  g.connect(master);
  voices++;
  const dur = fn(c, g, now);
  setTimeout(() => {
    voices--;
    g.disconnect();
  }, dur * 1000 + 50);
}

const PITCH: Record<string, number> = {
  bowling: 70,
  basketball: 160,
  baseball: 420,
  balloon: 300,
  crate: 120,
  domino: 900,
  bucket: 520,
  seesaw: 140,
  superball: 700,
  steelball: 380,
  beachball: 180,
  plank: 160,
  anvil: 50,
  tnt: 110,
  candle: 300,
  rocket: 260,
  cat: 140,
  rodent: 600,
};

export function impact(material: string, speed: number) {
  const vol = Math.min(1, speed / 18) * 0.8;
  if (vol < 0.08) return;
  voice((c, out, t) => {
    const o = c.createOscillator();
    const f = PITCH[material] ?? 200;
    o.type = material === 'domino' || material === 'bucket' || material === 'anvil' || material === 'steelball' ? 'square' : 'triangle';
    o.frequency.setValueAtTime(f * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    out.gain.setValueAtTime(vol * (material === 'domino' ? 0.25 : 0.6), t);
    out.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(out);
    o.start(t);
    o.stop(t + 0.13);
    return 0.13;
  });
}

export function boing() {
  voice((c, out, t) => {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(520, t + 0.18);
    const lfo = c.createOscillator();
    const lg = c.createGain();
    lfo.frequency.value = 28;
    lg.gain.value = 40;
    lfo.connect(lg).connect(o.frequency);
    out.gain.setValueAtTime(0.35, t);
    out.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(out);
    o.start(t);
    lfo.start(t);
    o.stop(t + 0.3);
    lfo.stop(t + 0.3);
    return 0.3;
  });
}

export function pop() {
  voice((c, out, t) => {
    const len = Math.floor(c.sampleRate * 0.12);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    out.gain.setValueAtTime(1, t);
    src.connect(f).connect(out);
    src.start(t);
    return 0.13;
  });
}

export function click() {
  voice((c, out, t) => {
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(880, t);
    out.gain.setValueAtTime(0.06, t);
    out.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    o.connect(out);
    o.start(t);
    o.stop(t + 0.05);
    return 0.05;
  });
}

export function fanfare() {
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((f, i) =>
    setTimeout(
      () =>
        voice((c, out, t) => {
          const o = c.createOscillator();
          o.type = 'square';
          o.frequency.value = f;
          out.gain.setValueAtTime(0.12, t);
          out.gain.exponentialRampToValueAtTime(0.001, t + (i === 3 ? 0.6 : 0.16));
          o.connect(out);
          o.start(t);
          o.stop(t + 0.62);
          return 0.62;
        }),
      i * 120,
    ),
  );
}

function noiseBurst(c: AudioContext, seconds: number, decay: number) {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  const src = c.createBufferSource();
  src.buffer = buf;
  return src;
}

export function boom() {
  voice((c, out, t) => {
    const src = noiseBurst(c, 0.9, 2.5);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(120, t + 0.8);
    out.gain.setValueAtTime(1.4, t);
    src.connect(f).connect(out);
    src.start(t);
    const o = c.createOscillator();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.5);
    const og = c.createGain();
    og.gain.setValueAtTime(0.8, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + 0.6);
    return 0.9;
  });
}

export function shatter() {
  voice((c, out, t) => {
    const src = noiseBurst(c, 0.5, 4);
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 3500;
    out.gain.setValueAtTime(0.8, t);
    src.connect(f).connect(out);
    src.start(t);
    for (let i = 0; i < 5; i++) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = 3000 + Math.random() * 4000;
      const og = c.createGain();
      const t0 = t + Math.random() * 0.25;
      og.gain.setValueAtTime(0.08, t0);
      og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
      o.connect(og).connect(out);
      o.start(t0);
      o.stop(t0 + 0.13);
    }
    return 0.5;
  });
}

export function snap() {
  voice((c, out, t) => {
    const src = noiseBurst(c, 0.06, 6);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2500;
    out.gain.setValueAtTime(1.6, t);
    src.connect(f).connect(out);
    src.start(t);
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(600, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    const og = c.createGain();
    og.gain.setValueAtTime(0.15, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + 0.1);
    return 0.12;
  });
}

export function snip() {
  [0, 0.07].forEach((d) =>
    setTimeout(
      () =>
        voice((c, out, t) => {
          const src = noiseBurst(c, 0.05, 5);
          const f = c.createBiquadFilter();
          f.type = 'highpass';
          f.frequency.value = 5000;
          out.gain.setValueAtTime(1.2, t);
          src.connect(f).connect(out);
          src.start(t);
          return 0.06;
        }),
      d * 1000,
    ),
  );
}

export function ring() {
  voice((c, out, t) => {
    out.gain.setValueAtTime(0.25, t);
    out.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    for (const [f, a] of [
      [880, 1],
      [880 * 2.0, 0.5],
      [880 * 2.76, 0.35],
      [880 * 5.4, 0.15],
    ]) {
      const o = c.createOscillator();
      o.frequency.value = f;
      const og = c.createGain();
      og.gain.value = a;
      o.connect(og).connect(out);
      o.start(t);
      o.stop(t + 1.6);
    }
    return 1.6;
  });
}

export function squeak() {
  voice((c, out, t) => {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(2200, t);
    o.frequency.exponentialRampToValueAtTime(3400, t + 0.06);
    o.frequency.exponentialRampToValueAtTime(2600, t + 0.14);
    out.gain.setValueAtTime(0.12, t);
    out.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(out);
    o.start(t);
    o.stop(t + 0.17);
    return 0.17;
  });
}

export function ignite() {
  voice((c, out, t) => {
    const src = noiseBurst(c, 0.35, 1.5);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(2200, t + 0.3);
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.7, t + 0.08);
    out.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(f).connect(out);
    src.start(t);
    return 0.36;
  });
}

export function spark() {
  for (let i = 0; i < 4; i++)
    setTimeout(
      () =>
        voice((c, out, t) => {
          const src = noiseBurst(c, 0.03, 8);
          const f = c.createBiquadFilter();
          f.type = 'highpass';
          f.frequency.value = 4000 + Math.random() * 3000;
          out.gain.setValueAtTime(1.0, t);
          src.connect(f).connect(out);
          src.start(t);
          return 0.04;
        }),
      i * 35 + Math.random() * 20,
    );
}

export function launch() {
  voice((c, out, t) => {
    const src = noiseBurst(c, 2.2, 0.6);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(1400, t + 0.4);
    f.frequency.exponentialRampToValueAtTime(500, t + 2.2);
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.9, t + 0.15);
    out.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
    src.connect(f).connect(out);
    src.start(t);
    return 2.2;
  });
}

export function puff() {
  voice((c, out, t) => {
    const src = noiseBurst(c, 0.2, 2);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 700;
    out.gain.setValueAtTime(0.6, t);
    src.connect(f).connect(out);
    src.start(t);
    return 0.2;
  });
}

export function meow() {
  voice((c, out, t) => {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(520, t);
    o.frequency.linearRampToValueAtTime(780, t + 0.18);
    o.frequency.linearRampToValueAtTime(460, t + 0.5);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 4;
    f.frequency.setValueAtTime(900, t);
    f.frequency.linearRampToValueAtTime(1800, t + 0.15);
    f.frequency.linearRampToValueAtTime(800, t + 0.5);
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.5, t + 0.06);
    out.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    o.connect(f).connect(out);
    o.start(t);
    o.stop(t + 0.56);
    return 0.56;
  });
}
