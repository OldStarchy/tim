// Shared types and drawing/physics helpers for part definitions.
// (Kept separate from parts.ts so part modules can import it without import cycles.)

import { Body, Circle, Vec2, World } from 'planck';
import type { Part, PartType } from './model';

export type Role = 'solid' | 'sharp' | 'tramp' | 'conveyor' | 'balloon' | 'pedal' | 'trigger' | 'bumper' | 'glass';

export interface FixtureTag {
  inst: Inst;
  role: Role;
}

export interface Inst {
  part: Part;
  main: Body;
  bodies: Body[];
  removed: boolean;
  /** per-run state a part keeps (spin phase, triggered flags, joints, ...) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  st: Record<string, any>;
}

export interface LocalBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type SimEvent =
  | { kind: 'pop'; x: number; y: number }
  | { kind: 'impact'; x: number; y: number; speed: number; material: string }
  | { kind: 'boing'; x: number; y: number }
  | { kind: 'snap'; x: number; y: number }
  | { kind: 'cut'; x: number; y: number }
  | { kind: 'boom'; x: number; y: number }
  | { kind: 'shatter'; x: number; y: number; angle: number; length: number }
  | { kind: 'ring'; x: number; y: number }
  | { kind: 'squeak'; x: number; y: number }
  | { kind: 'ignite'; x: number; y: number }
  | { kind: 'spark'; x: number; y: number }
  | { kind: 'launch'; x: number; y: number }
  | { kind: 'smoke'; x: number; y: number; vx: number; vy: number }
  | { kind: 'puff'; x: number; y: number }
  | { kind: 'burn'; x: number; y: number }
  | { kind: 'meow'; x: number; y: number };

/** what part behaviours may do to the running simulation */
export interface SimApi {
  world: World;
  time: number;
  insts: Map<string, Inst>;
  emit(e: SimEvent): void;
  remove(inst: Inst): void;
  /** cut every rope that passes within r of (x, y); returns how many */
  cutRopesNear(x: number, y: number, r: number): number;
  explode(x: number, y: number, radius: number, power: number, source: Inst): void;
  /** a power source switched on/off: recompute who's driven */
  powerChanged(): void;
  /** a short-lived flame (sparks, explosions): lights anything flammable within r */
  addHeat(x: number, y: number, r: number, seconds: number): void;
  pop(inst: Inst): void;
}

export interface HeatSpot {
  x: number;
  y: number;
  r: number;
}

export type Category = 'Balls' | 'Building' | 'Contraptions' | 'Fire & Light' | 'Power' | 'Critters';

export interface PartDef {
  type: PartType;
  name: string;
  desc: string;
  category: Category;
  /** dynamic by default (can be pinned) */
  dynamic: boolean;
  resize?: { min: number; max: number; def: number; step?: number };
  rotate: boolean;
  flip: boolean;
  /** trail / accent color */
  color: string;
  /** circular hit area radius, else box */
  radius?: number;
  /** attracted by magnets */
  metal?: boolean;
  bounds(p: Part): LocalBox;
  /** rope attach points, local to the main body */
  ropeAnchors?: (p: Part) => { x: number; y: number }[];
  /** belt hubs, local to the part's placed pose (powered parts are fixed in place) */
  drives?: (p: Part) => { x: number; y: number; r: number }[];
  /** flammable spot (local to the main body): a flame within r lights it */
  ignite?: (p: Part) => { x: number; y: number; r: number };
  onIgnite?: (api: SimApi, inst: Inst) => void;
  /** flames this part is giving off right now (world space) */
  heat?: (inst: Inst) => HeatSpot[];
  /** light this part is giving off right now (world space), for magnifying glasses */
  light?: (inst: Inst) => { x: number; y: number } | null;
  /** gears: pitch radius; two gears mesh when their pitch circles touch */
  gearR?: (p: Part) => number;
  /** power sources: angular speed produced right now (rad/s, + is clockwise) */
  source?: (inst: Inst) => number;
  /** powered parts: told their angular speed whenever the drive train changes */
  onPower?: (inst: Inst, omega: number) => void;
  /** a dynamic body began touching one of this part's fixtures */
  onContact?: (api: SimApi, inst: Inst, role: Role, other: Body, otherInst: Inst | undefined, speed: number) => void;
  onStep?: (api: SimApi, inst: Inst, dt: number) => void;
  build(world: World, p: Part, inst: Inst): void;
  draw(g: CanvasRenderingContext2D, inst: Inst, t: number): void;
}

// ---------- helpers ----------

export type G = CanvasRenderingContext2D;

export function bodyDef(p: Part, dynamic: boolean, extra: Record<string, unknown> = {}) {
  return {
    type: dynamic && !p.pinned ? ('dynamic' as const) : ('static' as const),
    position: Vec2(p.x, p.y),
    angle: p.angle,
    ...extra,
  };
}

export function tag(inst: Inst, role: Role = 'solid'): FixtureTag {
  return { inst, role };
}

export function tagOf(f: { getUserData(): unknown }): FixtureTag | undefined {
  return f.getUserData() as FixtureTag | undefined;
}

export function withBody(g: G, b: Body, fn: () => void) {
  const pos = b.getPosition();
  g.save();
  g.translate(pos.x, pos.y);
  g.rotate(b.getAngle());
  fn();
  g.restore();
}

/** draw in the part's placed frame (for static parts whose body may be gone) */
export function withPart(g: G, p: Part, fn: () => void) {
  g.save();
  g.translate(p.x, p.y);
  g.rotate(p.angle);
  fn();
  g.restore();
}

export function rrect(g: G, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export const OUTLINE = '#141722';
export const LW = 0.07;

export function stroke(g: G, w = LW) {
  g.lineWidth = w;
  g.strokeStyle = OUTLINE;
  g.stroke();
}

export function shadedBall(g: G, r: number, base: string, light: string) {
  const grad = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
  grad.addColorStop(0, light);
  grad.addColorStop(1, base);
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fillStyle = grad;
  g.fill();
  stroke(g);
}

export function pinMark(g: G, inst: Inst) {
  if (!inst.part.pinned) return;
  g.beginPath();
  g.arc(0, 0, 0.12, 0, Math.PI * 2);
  g.fillStyle = '#d8dde6';
  g.fill();
  stroke(g, 0.04);
  g.beginPath();
  g.moveTo(-0.07, 0);
  g.lineTo(0.07, 0);
  stroke(g, 0.035);
}

export function ball(
  type: PartType,
  name: string,
  desc: string,
  r: number,
  props: { density: number; restitution: number; friction: number },
  color: string,
  paint: (g: G, r: number) => void,
  extra: Record<string, unknown> = {},
): PartDef {
  return {
    type,
    name,
    desc,
    category: 'Balls',
    dynamic: true,
    rotate: false,
    flip: false,
    color,
    radius: r,
    bounds: () => ({ x0: -r, y0: -r, x1: r, y1: r }),
    ropeAnchors: () => [{ x: 0, y: 0 }],
    build(world, p, inst) {
      const b = world.createBody(bodyDef(p, true, { angularDamping: 0.1, bullet: true, ...extra }));
      b.createFixture({ shape: new Circle(r), ...props, userData: tag(inst) });
      inst.main = b;
      inst.bodies.push(b);
    },
    draw(g, inst) {
      withBody(g, inst.main, () => {
        paint(g, r);
        pinMark(g, inst);
      });
    },
  };
}

/** a gear-ish toothed wheel outline */
export function gearPath(g: G, r: number, teeth: number, depth = 0.12) {
  g.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const a0 = (i / (teeth * 2)) * Math.PI * 2;
    const a1 = ((i + 1) / (teeth * 2)) * Math.PI * 2;
    const rr = i % 2 ? r - depth : r + depth * 0.4;
    g.lineTo(Math.cos(a0) * rr, Math.sin(a0) * rr);
    g.lineTo(Math.cos(a1) * rr, Math.sin(a1) * rr);
  }
  g.closePath();
}

/** resting bodies fall asleep; a belt or gear that starts moving under them has to wake them */
export function wakeTouching(b: Body) {
  for (let ce = b.getContactList(); ce; ce = ce.next ?? null) {
    if (ce.contact.isTouching()) ce.other?.setAwake(true);
  }
}
