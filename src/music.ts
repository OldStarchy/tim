// Background music: a shuffled playlist of non-looping tracks, crossfaded end-to-start.
// While you're building, the music is muffled (low-pass) and a little quieter so it sits
// in the background; pressing Start opens it back up.

import { context } from './audio';

export interface Track {
  file: string;
  title: string;
}

/** add more tracks here (files go in public/music/) */
export const TRACKS: Track[] = [
  { file: 'workshop.mp3', title: 'Rube Goldberg Workshop' },
  { file: 'pixel-puzzle.mp3', title: 'Pixel Puzzle' },
  { file: 'clockwork-workshop.mp3', title: 'Clockwork Workshop' },
];

const CROSSFADE = 4;
const BUILD_CUTOFF = 1100;
const BUILD_GAIN = 0.7;

interface Deck {
  el: HTMLAudioElement;
  gain: GainNode;
}

let decks: Deck[] = [];
let bus: GainNode | null = null;
let filter: BiquadFilterNode | null = null;
let current = -1;
let trackIdx = -1;
let playing = false;
let volume = 0.5;
let muted = false;
let running = false;
let order: number[] = [];
let onTrackChange: ((t: Track) => void) | null = null;

function url(t: Track) {
  return `${import.meta.env.BASE_URL}music/${t.file}`;
}

function setup(): boolean {
  if (bus) return true;
  const c = context();
  if (!c) return false;
  bus = c.createGain();
  filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.5;
  bus.connect(filter).connect(c.destination);
  for (let i = 0; i < 2; i++) {
    const el = new Audio();
    el.preload = 'auto';
    const gain = c.createGain();
    gain.gain.value = 0;
    c.createMediaElementSource(el).connect(gain).connect(bus);
    el.addEventListener('timeupdate', () => {
      if (i !== current || !playing || !el.duration) return;
      if (el.duration - el.currentTime <= CROSSFADE) next();
    });
    // safety net if timeupdate fires too late for the crossfade
    el.addEventListener('ended', () => {
      if (i === current && playing) next();
    });
    decks.push({ el, gain });
  }
  applyLevels(true);
  return true;
}

function applyLevels(instant = false) {
  const c = context();
  if (!c || !bus || !filter) return;
  const t = c.currentTime;
  const target = muted ? 0 : volume * volume * (running ? 1 : BUILD_GAIN);
  const cutoff = running ? 18000 : BUILD_CUTOFF;
  const ramp = instant ? 0.01 : 0.8;
  bus.gain.cancelScheduledValues(t);
  bus.gain.setTargetAtTime(target, t, ramp / 3);
  filter.frequency.cancelScheduledValues(t);
  filter.frequency.setTargetAtTime(cutoff, t, ramp / 3);
}

function nextIndex(): number {
  if (!order.length) {
    order = TRACKS.map((_, i) => i).sort(() => Math.random() - 0.5);
    // don't play the same track twice in a row across reshuffles
    if (order.length > 1 && order[0] === trackIdx) order.push(order.shift()!);
  }
  return order.shift()!;
}

function next(fadeIn = CROSSFADE) {
  const c = context();
  if (!c || !TRACKS.length) return;
  const t = c.currentTime;
  const old = decks[current];
  if (old) {
    old.gain.gain.cancelScheduledValues(t);
    old.gain.gain.setValueAtTime(old.gain.gain.value, t);
    old.gain.gain.linearRampToValueAtTime(0, t + CROSSFADE);
    const el = old.el;
    setTimeout(() => {
      if (decks[current]?.el !== el) el.pause();
    }, CROSSFADE * 1000 + 100);
  }
  current = (current + 1) % 2;
  trackIdx = nextIndex();
  const d = decks[current];
  d.el.src = url(TRACKS[trackIdx]);
  d.el.currentTime = 0;
  d.gain.gain.cancelScheduledValues(t);
  d.gain.gain.setValueAtTime(0, t);
  d.gain.gain.linearRampToValueAtTime(1, t + fadeIn);
  void d.el.play().catch(() => {
    /* autoplay blocked: start() is retried on the next user gesture */
    playing = false;
  });
  onTrackChange?.(TRACKS[trackIdx]);
}

export function start() {
  if (playing || !TRACKS.length || !setup()) return;
  playing = true;
  next(1.5);
}

export function stop() {
  if (!playing) return;
  playing = false;
  const c = context();
  if (!c) return;
  for (const d of decks) {
    d.gain.gain.cancelScheduledValues(c.currentTime);
    d.gain.gain.setTargetAtTime(0, c.currentTime, 0.15);
    const el = d.el;
    setTimeout(() => !playing && el.pause(), 700);
  }
  current = -1;
}

export const isPlaying = () => playing;
export const getVolume = () => volume;

export function setVolume(v: number) {
  volume = Math.max(0, Math.min(1, v));
  applyLevels();
}

export function setMuted(m: boolean) {
  muted = m;
  applyLevels();
}

/** muffle while building, full mix while the machine runs */
export function setRunning(r: boolean) {
  running = r;
  applyLevels();
}

export function onTrack(fn: (t: Track) => void) {
  onTrackChange = fn;
}

/** console helper: jump near the end of the current track to hear the crossfade */
export function skipToEnd() {
  const d = decks[current];
  if (d?.el.duration) d.el.currentTime = d.el.duration - CROSSFADE - 1;
}

export function debugState() {
  return { current, trackIdx, decks: decks.map((d) => ({ t: d.el.currentTime, paused: d.el.paused, gain: d.gain.gain.value })) };
}
