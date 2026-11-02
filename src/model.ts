// Core data model: a Scene is plain JSON so it can be saved, shared, undone and rebuilt.

export type PartType =
  | 'bowling'
  | 'basketball'
  | 'baseball'
  | 'balloon'
  | 'crate'
  | 'domino'
  | 'bucket'
  | 'wall'
  | 'conveyor'
  | 'trampoline'
  | 'seesaw'
  | 'needle'
  | 'fan'
  | 'hook'
  | 'pulley';

export interface Part {
  id: string;
  type: PartType;
  x: number;
  y: number;
  /** radians, y-down world so positive is clockwise on screen */
  angle: number;
  /** length along local x for resizable parts */
  length: number;
  flip: boolean;
  /** dynamic parts nailed in place (static body) */
  pinned?: boolean;
  /** placed by the level; player can't move or delete it */
  locked?: boolean;
}

export interface Rope {
  id: string;
  a: string;
  b: string;
  /** optional pulley part id the rope runs over */
  via?: string;
  locked?: boolean;
}

export interface Scene {
  parts: Part[];
  ropes: Rope[];
}

export interface Zone {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Goal =
  | { kind: 'inBucket'; target: string; bucket: string; label: string }
  | { kind: 'popped'; target: string; label: string }
  | { kind: 'inZone'; target: string; zone: Zone; label: string }
  | { kind: 'toppled'; targets: string[]; label: string };

export type Bin = Partial<Record<PartType | 'rope', number>>;

export interface Level {
  id: string;
  title: string;
  blurb: string;
  hint?: string;
  scene: Scene;
  bin: Bin;
  goals: Goal[];
  /** reference solution: parts/ropes added to the scene; verified by tests */
  solution: Scene;
}

export const BOARD_W = 40;
export const BOARD_H = 25;

let idCounter = 0;
export function newId(prefix = 'p'): string {
  idCounter++;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export function cloneScene(s: Scene): Scene {
  return JSON.parse(JSON.stringify(s));
}
