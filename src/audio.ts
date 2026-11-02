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
};

export function impact(material: string, speed: number) {
  const vol = Math.min(1, speed / 18) * 0.8;
  if (vol < 0.08) return;
  voice((c, out, t) => {
    const o = c.createOscillator();
    const f = PITCH[material] ?? 200;
    o.type = material === 'domino' || material === 'bucket' ? 'square' : 'triangle';
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
