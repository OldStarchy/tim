import type { Scene } from './model';

const KEY = 'tim.v1';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`${KEY}.${key}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(`${KEY}.${key}`, JSON.stringify(value));
  } catch {
    /* storage full or blocked: progress just won't persist */
  }
}

export interface Prefs {
  snap: boolean;
  ghost: boolean;
  muted: boolean;
  music: boolean;
  musicVolume: number;
}

export const loadPrefs = (): Prefs => ({ snap: true, ghost: true, muted: false, music: true, musicVolume: 0.5, ...read<Partial<Prefs>>('prefs', {}) });
export const savePrefs = (p: Prefs) => write('prefs', p);

export const loadProgress = () => read<Record<string, boolean>>('solved', {});
export function markSolved(id: string) {
  write('solved', { ...loadProgress(), [id]: true });
}

export const loadLevelScene = (id: string) => read<Scene | null>(`level.${id}`, null);
export const saveLevelScene = (id: string, s: Scene) => write(`level.${id}`, s);

export const loadSandbox = () => read<Scene | null>('sandbox', null);
export const saveSandbox = (s: Scene) => write('sandbox', s);

// Share links: compact JSON (rounded numbers) in base64url.
export function encodeScene(s: Scene): string {
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const compact = {
    p: s.parts.map((p) => [p.id, p.type, round(p.x), round(p.y), round(p.angle), round(p.length), p.flip ? 1 : 0, p.pinned ? 1 : 0]),
    r: s.ropes.map((r) => [r.id, r.a, r.b, r.via ?? '']),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(compact));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeScene(code: string): Scene | null {
  try {
    const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const c = JSON.parse(new TextDecoder().decode(bytes)) as { p: unknown[][]; r: string[][] };
    return {
      parts: c.p.map(([id, type, x, y, angle, length, flip, pinned]) => ({
        id: String(id),
        type: type as Scene['parts'][number]['type'],
        x: Number(x),
        y: Number(y),
        angle: Number(angle),
        length: Number(length),
        flip: !!flip,
        pinned: !!pinned,
      })),
      ropes: c.r.map(([id, a, b, via]) => ({ id, a, b, via: via || undefined })),
    };
  } catch {
    return null;
  }
}
