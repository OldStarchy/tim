import { Body, Box, Circle, Polygon, RevoluteJoint, Vec2, World } from 'planck';
import type { Part, PartType } from './model';

export type Role = 'solid' | 'sharp' | 'tramp' | 'conveyor' | 'balloon';

export interface FixtureTag {
  inst: Inst;
  role: Role;
}

export interface Inst {
  part: Part;
  main: Body;
  bodies: Body[];
  removed: boolean;
}

export interface LocalBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PartDef {
  type: PartType;
  name: string;
  desc: string;
  /** dynamic by default (can be pinned) */
  dynamic: boolean;
  resize?: { min: number; max: number; def: number };
  rotate: boolean;
  flip: boolean;
  /** trail / accent color */
  color: string;
  /** circular hit area radius, else box */
  radius?: number;
  bounds(p: Part): LocalBox;
  /** rope attach point, local to the main body */
  ropeAnchor?: (p: Part) => { x: number; y: number };
  build(world: World, p: Part, inst: Inst): void;
  draw(g: CanvasRenderingContext2D, inst: Inst, t: number): void;
}

// ---------- helpers ----------

type G = CanvasRenderingContext2D;

function bodyDef(p: Part, dynamic: boolean, extra: Record<string, unknown> = {}) {
  return {
    type: dynamic && !p.pinned ? ('dynamic' as const) : ('static' as const),
    position: Vec2(p.x, p.y),
    angle: p.angle,
    ...extra,
  };
}

function tag(inst: Inst, role: Role = 'solid'): FixtureTag {
  return { inst, role };
}

function withBody(g: G, b: Body, fn: () => void) {
  const pos = b.getPosition();
  g.save();
  g.translate(pos.x, pos.y);
  g.rotate(b.getAngle());
  fn();
  g.restore();
}

function rrect(g: G, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

const OUTLINE = '#141722';
const LW = 0.07;

function stroke(g: G, w = LW) {
  g.lineWidth = w;
  g.strokeStyle = OUTLINE;
  g.stroke();
}

function shadedBall(g: G, r: number, base: string, light: string) {
  const grad = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
  grad.addColorStop(0, light);
  grad.addColorStop(1, base);
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fillStyle = grad;
  g.fill();
  stroke(g);
}

function pinMark(g: G, inst: Inst) {
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

function ball(
  type: PartType,
  name: string,
  desc: string,
  r: number,
  props: { density: number; restitution: number; friction: number },
  color: string,
  paint: (g: G, r: number) => void,
): PartDef {
  return {
    type,
    name,
    desc,
    dynamic: true,
    rotate: false,
    flip: false,
    color,
    radius: r,
    bounds: () => ({ x0: -r, y0: -r, x1: r, y1: r }),
    ropeAnchor: () => ({ x: 0, y: 0 }),
    build(world, p, inst) {
      const b = world.createBody(bodyDef(p, true, { angularDamping: 0.1, bullet: true }));
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

// ---------- parts ----------

const bowling = ball(
  'bowling',
  'Bowling Ball',
  'Heavy and barely bounces. Knocks over almost anything.',
  0.5,
  { density: 3, restitution: 0.05, friction: 0.4 },
  '#7d6bd6',
  (g, r) => {
    shadedBall(g, r, '#2a2350', '#6b5bc4');
    g.fillStyle = '#0d0b1c';
    for (const [x, y] of [
      [-0.12, -0.2],
      [0.06, -0.24],
      [-0.02, -0.04],
    ]) {
      g.beginPath();
      g.arc(x, y, 0.065, 0, Math.PI * 2);
      g.fill();
    }
  },
);

const basketball = ball(
  'basketball',
  'Basketball',
  'Light and very bouncy.',
  0.45,
  { density: 0.4, restitution: 0.82, friction: 0.6 },
  '#f08a3c',
  (g, r) => {
    shadedBall(g, r, '#d0611c', '#f7a35c');
    g.beginPath();
    g.moveTo(-r, 0);
    g.lineTo(r, 0);
    g.moveTo(0, -r);
    g.lineTo(0, r);
    g.moveTo(-r * 0.6, -r * 0.8);
    g.quadraticCurveTo(-r * 0.1, 0, -r * 0.6, r * 0.8);
    g.moveTo(r * 0.6, -r * 0.8);
    g.quadraticCurveTo(r * 0.1, 0, r * 0.6, r * 0.8);
    stroke(g, 0.045);
  },
);

const baseball = ball(
  'baseball',
  'Baseball',
  'Small, quick and moderately bouncy.',
  0.25,
  { density: 1.5, restitution: 0.45, friction: 0.4 },
  '#f2eee2',
  (g, r) => {
    shadedBall(g, r, '#d9d3c2', '#ffffff');
    g.beginPath();
    g.arc(-r * 1.25, 0, r * 0.85, -0.7, 0.7);
    g.moveTo(r * 1.25 + Math.cos(Math.PI - 0.7) * r * 0.85, Math.sin(Math.PI - 0.7) * r * 0.85);
    g.arc(r * 1.25, 0, r * 0.85, Math.PI - 0.7, Math.PI + 0.7);
    g.lineWidth = 0.035;
    g.strokeStyle = '#d23b3b';
    g.stroke();
  },
);

export const BALLOON_LIFT = 22;

const balloon: PartDef = {
  type: 'balloon',
  name: 'Balloon',
  desc: 'Floats upward. Pops on anything sharp. Tie a rope to it to lift light things.',
  dynamic: true,
  rotate: false,
  flip: false,
  color: '#ff5d7a',
  radius: 0.55,
  bounds: () => ({ x0: -0.55, y0: -0.6, x1: 0.55, y1: 0.85 }),
  ropeAnchor: () => ({ x: 0, y: 0.72 }),
  build(world, p, inst) {
    const b = world.createBody(bodyDef(p, true, { linearDamping: 2.5, angularDamping: 3 }));
    b.createFixture({
      shape: new Circle(0.55),
      density: 0.5,
      restitution: 0.3,
      friction: 0.2,
      userData: tag(inst, 'balloon'),
    });
    inst.main = b;
    inst.bodies.push(b);
  },
  draw(g, inst) {
    withBody(g, inst.main, () => {
      g.beginPath();
      g.moveTo(0, 0.6);
      g.quadraticCurveTo(0.12, 0.72, 0, 0.84);
      g.lineWidth = 0.03;
      g.strokeStyle = '#ddd';
      g.stroke();
      g.save();
      g.scale(0.92, 1.08);
      shadedBall(g, 0.55, '#d8264a', '#ff8fa3');
      g.restore();
      g.beginPath();
      g.moveTo(-0.09, 0.66);
      g.lineTo(0.09, 0.66);
      g.lineTo(0, 0.56);
      g.closePath();
      g.fillStyle = '#b81d3c';
      g.fill();
      g.beginPath();
      g.ellipse(-0.2, -0.25, 0.08, 0.15, 0.5, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fill();
      pinMark(g, inst);
    });
  },
};

const crate: PartDef = {
  type: 'crate',
  name: 'Crate',
  desc: 'A sturdy wooden box. Good as a counterweight.',
  dynamic: true,
  rotate: true,
  flip: false,
  color: '#d9a057',
  bounds: () => ({ x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 }),
  ropeAnchor: () => ({ x: 0, y: -0.5 }),
  build(world, p, inst) {
    const b = world.createBody(bodyDef(p, true));
    b.createFixture({ shape: new Box(0.5, 0.5), density: 1.5, friction: 0.6, restitution: 0.05, userData: tag(inst) });
    inst.main = b;
    inst.bodies.push(b);
  },
  draw(g, inst) {
    withBody(g, inst.main, () => {
      rrect(g, -0.5, -0.5, 1, 1, 0.06);
      g.fillStyle = '#c98b42';
      g.fill();
      stroke(g);
      g.strokeStyle = '#8a5a26';
      g.lineWidth = 0.06;
      g.strokeRect(-0.38, -0.38, 0.76, 0.76);
      g.beginPath();
      g.moveTo(-0.38, -0.38);
      g.lineTo(0.38, 0.38);
      g.stroke();
      pinMark(g, inst);
    });
  },
};

const domino: PartDef = {
  type: 'domino',
  name: 'Domino',
  desc: 'Tall and tippy. Line them up for a chain reaction.',
  dynamic: true,
  rotate: true,
  flip: false,
  color: '#e8e4d8',
  bounds: () => ({ x0: -0.15, y0: -0.7, x1: 0.15, y1: 0.7 }),
  build(world, p, inst) {
    const b = world.createBody(bodyDef(p, true));
    b.createFixture({ shape: new Box(0.13, 0.7), density: 2, friction: 0.6, restitution: 0.05, userData: tag(inst) });
    inst.main = b;
    inst.bodies.push(b);
  },
  draw(g, inst) {
    withBody(g, inst.main, () => {
      rrect(g, -0.13, -0.7, 0.26, 1.4, 0.05);
      g.fillStyle = '#f1ecdc';
      g.fill();
      stroke(g, 0.05);
      g.fillStyle = '#1e1f2b';
      g.fillRect(-0.09, -0.01, 0.18, 0.02);
      for (const y of [-0.45, -0.25, 0.25, 0.45]) {
        g.beginPath();
        g.arc(0, y, 0.045, 0, Math.PI * 2);
        g.fill();
      }
    });
  },
};

const BUCKET_HW = 0.75; // half inner width + wall
const BUCKET_HH = 0.6;
const bucket: PartDef = {
  type: 'bucket',
  name: 'Bucket',
  desc: 'Catches things. Hang it from a rope or pin it in place.',
  dynamic: true,
  rotate: true,
  flip: false,
  color: '#8fb3cc',
  bounds: () => ({ x0: -BUCKET_HW - 0.05, y0: -1.15, x1: BUCKET_HW + 0.05, y1: BUCKET_HH }),
  ropeAnchor: () => ({ x: 0, y: -1.1 }),
  build(world, p, inst) {
    const b = world.createBody(bodyDef(p, true, { angularDamping: 1.5 }));
    const t = 0.1;
    const opts = { density: 0.6, friction: 0.5, restitution: 0.05, userData: tag(inst) };
    b.createFixture({ shape: new Box(BUCKET_HW, t, Vec2(0, BUCKET_HH - t), 0), ...opts });
    b.createFixture({ shape: new Box(t, BUCKET_HH, Vec2(-BUCKET_HW + t, 0), 0), ...opts });
    b.createFixture({ shape: new Box(t, BUCKET_HH, Vec2(BUCKET_HW - t, 0), 0), ...opts });
    inst.main = b;
    inst.bodies.push(b);
  },
  draw(g, inst) {
    withBody(g, inst.main, () => {
      // handle
      g.beginPath();
      g.moveTo(-BUCKET_HW + 0.08, -BUCKET_HH);
      g.quadraticCurveTo(0, -1.55, BUCKET_HW - 0.08, -BUCKET_HH);
      g.lineWidth = 0.05;
      g.strokeStyle = '#59636e';
      g.stroke();
      g.beginPath();
      g.moveTo(-BUCKET_HW, -BUCKET_HH);
      g.lineTo(BUCKET_HW, -BUCKET_HH);
      g.lineTo(BUCKET_HW - 0.12, BUCKET_HH);
      g.lineTo(-BUCKET_HW + 0.12, BUCKET_HH);
      g.closePath();
      const grad = g.createLinearGradient(-BUCKET_HW, 0, BUCKET_HW, 0);
      grad.addColorStop(0, '#5f7f96');
      grad.addColorStop(0.4, '#b9d2e2');
      grad.addColorStop(1, '#5f7f96');
      g.fillStyle = grad;
      g.fill();
      stroke(g);
      // dark inside rim
      g.beginPath();
      g.ellipse(0, -BUCKET_HH, BUCKET_HW - 0.06, 0.1, 0, 0, Math.PI * 2);
      g.fillStyle = '#2b3b48';
      g.fill();
      stroke(g, 0.04);
      for (const y of [-0.15, 0.25]) {
        g.beginPath();
        g.moveTo(-BUCKET_HW + 0.05, y);
        g.lineTo(BUCKET_HW - 0.05, y);
        g.lineWidth = 0.035;
        g.strokeStyle = 'rgba(20,23,34,0.5)';
        g.stroke();
      }
      pinMark(g, inst);
    });
  },
};

/** Is world point inside the bucket's interior? */
export function inBucket(bucketBody: Body, wx: number, wy: number): boolean {
  const lp = bucketBody.getLocalPoint(Vec2(wx, wy));
  return Math.abs(lp.x) < BUCKET_HW - 0.15 && lp.y > -BUCKET_HH - 0.05 && lp.y < BUCKET_HH;
}

const WALL_T = 0.25;
const wall: PartDef = {
  type: 'wall',
  name: 'Brick Wall',
  desc: 'A solid wall. Resize it and tilt it to make ramps.',
  dynamic: false,
  resize: { min: 1, max: 24, def: 4 },
  rotate: true,
  flip: false,
  color: '#c0563f',
  bounds: (p) => ({ x0: -p.length / 2, y0: -WALL_T, x1: p.length / 2, y1: WALL_T }),
  build(world, p, inst) {
    const b = world.createBody(bodyDef(p, false));
    b.createFixture({ shape: new Box(p.length / 2, WALL_T), friction: 0.6, restitution: 0.1, userData: tag(inst) });
    inst.main = b;
    inst.bodies.push(b);
  },
  draw(g, inst) {
    const L = inst.part.length;
    withBody(g, inst.main, () => {
      rrect(g, -L / 2, -WALL_T, L, WALL_T * 2, 0.04);
      g.fillStyle = '#b44c36';
      g.fill();
      g.save();
      g.clip();
      g.strokeStyle = '#7f2f20';
      g.lineWidth = 0.04;
      g.beginPath();
      g.moveTo(-L / 2, 0);
      g.lineTo(L / 2, 0);
      for (let row = 0; row < 2; row++) {
        const off = row ? 0.25 : 0;
        for (let x = -L / 2 + off; x < L / 2; x += 0.5) {
          const y0 = row ? 0 : -WALL_T;
          g.moveTo(x, y0);
          g.lineTo(x, y0 + WALL_T);
        }
      }
      g.stroke();
      g.restore();
      rrect(g, -L / 2, -WALL_T, L, WALL_T * 2, 0.04);
      stroke(g);
    });
  },
};

export const CONVEYOR_SPEED = 6;
const CONV_T = 0.28;
const conveyor: PartDef = {
  type: 'conveyor',
  name: 'Conveyor Belt',
  desc: 'Moves whatever sits on it. Flip (F) to reverse direction.',
  dynamic: false,
  resize: { min: 2, max: 20, def: 5 },
  rotate: true,
  flip: true,
  color: '#7dd3c0',
  bounds: (p) => ({ x0: -p.length / 2, y0: -CONV_T, x1: p.length / 2, y1: CONV_T + 0.15 }),
  build(world, p, inst) {
    const b = world.createBody(bodyDef(p, false));
    b.createFixture({
      shape: new Box(p.length / 2, CONV_T),
      friction: 0.9,
      restitution: 0,
      userData: tag(inst, 'conveyor'),
    });
    inst.main = b;
    inst.bodies.push(b);
  },
  draw(g, inst, t) {
    const L = inst.part.length;
    const dir = inst.part.flip ? -1 : 1;
    withBody(g, inst.main, () => {
      rrect(g, -L / 2, -CONV_T, L, CONV_T * 2, CONV_T);
      g.fillStyle = '#2c3140';
      g.fill();
      stroke(g);
      // moving tread
      g.save();
      rrect(g, -L / 2 + 0.05, -CONV_T + 0.05, L - 0.1, CONV_T * 2 - 0.1, CONV_T);
      g.clip();
      // it's a loop: the top runs one way, the underside comes back the other
      const wrap = (v: number) => ((v % 0.5) + 0.5) % 0.5;
      const topOff = wrap(t * CONVEYOR_SPEED * dir);
      const botOff = wrap(-t * CONVEYOR_SPEED * dir);
      g.strokeStyle = '#4fd1b6';
      g.lineWidth = 0.05;
      g.beginPath();
      for (let x = -L / 2 - 0.5 + topOff; x < L / 2 + 0.5; x += 0.5) {
        g.moveTo(x - 0.06 * dir, -CONV_T);
        g.lineTo(x + 0.06 * dir, -CONV_T + 0.1);
      }
      for (let x = -L / 2 - 0.5 + botOff; x < L / 2 + 0.5; x += 0.5) {
        g.moveTo(x + 0.06 * dir, CONV_T);
        g.lineTo(x - 0.06 * dir, CONV_T - 0.1);
      }
      g.stroke();
      g.restore();
      for (const x of [-L / 2 + CONV_T, L / 2 - CONV_T]) {
        g.save();
        g.translate(x, 0);
        g.rotate(t * CONVEYOR_SPEED * dir / CONV_T);
        g.beginPath();
        g.arc(0, 0, CONV_T * 0.6, 0, Math.PI * 2);
        g.fillStyle = '#9aa6b8';
        g.fill();
        stroke(g, 0.04);
        g.beginPath();
        g.moveTo(-CONV_T * 0.6, 0);
        g.lineTo(CONV_T * 0.6, 0);
        stroke(g, 0.04);
        g.restore();
      }
      // direction arrow
      g.fillStyle = '#4fd1b6';
      g.beginPath();
      g.moveTo(0.18 * dir, 0);
      g.lineTo(-0.1 * dir, -0.12);
      g.lineTo(-0.1 * dir, 0.12);
      g.closePath();
      g.fill();
    });
  },
};

/** outgoing speed along the mat normal = incoming × GAIN, clamped to [MIN, MAX] */
export const TRAMP_GAIN = 1.15;
export const TRAMP_MIN_BOUNCE = 14;
export const TRAMP_MAX_BOUNCE = 28;
const trampoline: PartDef = {
  type: 'trampoline',
  name: 'Trampoline',
  desc: 'Launches things that land on it with a guaranteed big bounce.',
  dynamic: false,
  resize: { min: 1.5, max: 6, def: 2.5 },
  rotate: true,
  flip: false,
  color: '#3cc9b4',
  bounds: (p) => ({ x0: -p.length / 2, y0: -0.25, x1: p.length / 2, y1: 0.6 }),
  build(world, p, inst) {
    const b = world.createBody(bodyDef(p, false));
    const hw = p.length / 2;
    b.createFixture({
      shape: new Box(hw - 0.05, 0.08, Vec2(0, -0.12), 0),
      friction: 0.3,
      restitution: 0.9,
      userData: tag(inst, 'tramp'),
    });
    b.createFixture({ shape: new Box(0.08, 0.35, Vec2(-hw + 0.08, 0.2), 0), friction: 0.5, userData: tag(inst) });
    b.createFixture({ shape: new Box(0.08, 0.35, Vec2(hw - 0.08, 0.2), 0), friction: 0.5, userData: tag(inst) });
    inst.main = b;
    inst.bodies.push(b);
  },
  draw(g, inst) {
    const hw = inst.part.length / 2;
    withBody(g, inst.main, () => {
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(s * (hw - 0.15), -0.12);
        g.lineTo(s * (hw - 0.05), 0.55);
        g.lineWidth = 0.1;
        g.strokeStyle = '#59606e';
        g.stroke();
      }
      g.beginPath();
      g.moveTo(-hw, -0.12);
      g.quadraticCurveTo(0, -0.02, hw, -0.12);
      g.lineWidth = 0.16;
      g.strokeStyle = OUTLINE;
      g.stroke();
      g.lineWidth = 0.1;
      g.strokeStyle = '#2fc0aa';
      g.stroke();
      // springs
      g.beginPath();
      for (let x = -hw + 0.3; x < hw - 0.2; x += 0.35) {
        g.moveTo(x, -0.06);
        g.lineTo(x + 0.06, 0.04);
        g.lineTo(x - 0.06, 0.12);
        g.lineTo(x, 0.2);
      }
      g.lineWidth = 0.025;
      g.strokeStyle = '#c3cad6';
      g.stroke();
      for (const s of [-1, 1]) {
        rrect(g, s * (hw - 0.08) - 0.1, -0.22, 0.2, 0.2, 0.05);
        g.fillStyle = '#e85d75';
        g.fill();
        stroke(g, 0.04);
      }
    });
  },
};

/** tilt so the low end rests level with the bottom of the fulcrum */
export function seesawLimit(length: number) {
  return Math.asin(Math.min(0.95, 0.95 / (length / 2)));
}
const seesaw: PartDef = {
  type: 'seesaw',
  name: 'Teeter-Totter',
  desc: 'Drop something on the high end to fling things off the other. Flip (F) to change which end is up.',
  dynamic: false,
  resize: { min: 3, max: 12, def: 6 },
  rotate: false,
  flip: true,
  color: '#e0aa62',
  bounds: (p) => ({ x0: -p.length / 2, y0: -0.4 - (Math.sin(seesawLimit(p.length)) * p.length) / 2, x1: p.length / 2, y1: 1.1 }),
  build(world, p, inst) {
    const base = world.createBody({ type: 'static', position: Vec2(p.x, p.y) });
    base.createFixture({
      shape: new Polygon([Vec2(0, 0.15), Vec2(-0.6, 1.1), Vec2(0.6, 1.1)]),
      friction: 0.6,
      userData: tag(inst),
    });
    const lim = seesawLimit(p.length);
    const tilt = p.flip ? lim : -lim;
    const plank = world.createBody({ type: 'dynamic', position: Vec2(p.x, p.y), angle: tilt, angularDamping: 0.2 });
    plank.createFixture({ shape: new Box(p.length / 2, 0.12), density: 1, friction: 0.7, userData: tag(inst) });
    // little lips at each end so a ball can sit on the low side
    for (const s of [-1, 1]) {
      plank.createFixture({
        shape: new Box(0.06, 0.13, Vec2(s * (p.length / 2 - 0.06), -0.24), 0),
        density: 1,
        friction: 0.7,
        userData: tag(inst),
      });
    }
    world.createJoint(
      new RevoluteJoint(
        { enableLimit: true, lowerAngle: -lim - tilt, upperAngle: lim - tilt },
        base,
        plank,
        Vec2(p.x, p.y),
      ),
    );
    inst.main = plank;
    inst.bodies.push(plank, base);
  },
  draw(g, inst) {
    const L = inst.part.length;
    withBody(g, inst.bodies[1], () => {
      g.beginPath();
      g.moveTo(0, 0.05);
      g.lineTo(-0.6, 1.1);
      g.lineTo(0.6, 1.1);
      g.closePath();
      g.fillStyle = '#7c5434';
      g.fill();
      stroke(g);
    });
    withBody(g, inst.main, () => {
      for (const s of [-1, 1]) {
        rrect(g, s * (L / 2 - 0.06) - 0.06, -0.37, 0.12, 0.3, 0.03);
        g.fillStyle = '#a8763c';
        g.fill();
        stroke(g, 0.04);
      }
      rrect(g, -L / 2, -0.12, L, 0.24, 0.06);
      g.fillStyle = '#e0aa62';
      g.fill();
      stroke(g);
      g.beginPath();
      for (let x = -L / 2 + 0.7; x < L / 2; x += 1.4) {
        g.moveTo(x, -0.06);
        g.lineTo(x + 0.4, -0.06);
      }
      g.lineWidth = 0.03;
      g.strokeStyle = '#a8763c';
      g.stroke();
      g.beginPath();
      g.arc(0, 0, 0.08, 0, Math.PI * 2);
      g.fillStyle = '#59606e';
      g.fill();
    });
  },
};

const needle: PartDef = {
  type: 'needle',
  name: 'Pin',
  desc: 'Sharp! Pops balloons. Rotate it to point anywhere.',
  dynamic: false,
  rotate: true,
  flip: false,
  color: '#c9ced6',
  bounds: () => ({ x0: -0.2, y0: -0.6, x1: 0.2, y1: 0.4 }),
  build(world, p, inst) {
    const b = world.createBody(bodyDef(p, false));
    b.createFixture({
      shape: new Polygon([Vec2(0, -0.6), Vec2(0.06, 0.2), Vec2(-0.06, 0.2)]),
      friction: 0.2,
      userData: tag(inst, 'sharp'),
    });
    b.createFixture({ shape: new Box(0.2, 0.1, Vec2(0, 0.3), 0), friction: 0.5, userData: tag(inst) });
    inst.main = b;
    inst.bodies.push(b);
  },
  draw(g, inst) {
    withBody(g, inst.main, () => {
      g.beginPath();
      g.moveTo(0, -0.6);
      g.lineTo(0.05, 0.2);
      g.lineTo(-0.05, 0.2);
      g.closePath();
      g.fillStyle = '#dfe4ec';
      g.fill();
      stroke(g, 0.035);
      rrect(g, -0.2, 0.2, 0.4, 0.2, 0.06);
      g.fillStyle = '#e8b931';
      g.fill();
      stroke(g, 0.04);
    });
  },
};

export const FAN_RANGE = 9;
export const FAN_HALF_H = 1.1;
export const FAN_STRENGTH = 10;
const fan: PartDef = {
  type: 'fan',
  name: 'Fan',
  desc: 'Blows a strong breeze. Light things fly, heavy things barely budge. Flip (F) to turn around.',
  dynamic: false,
  rotate: true,
  flip: true,
  color: '#7fc4f0',
  bounds: () => ({ x0: -0.6, y0: -0.7, x1: 0.6, y1: 0.75 }),
  build(world, p, inst) {
    const b = world.createBody(bodyDef(p, false));
    b.createFixture({ shape: new Box(0.5, 0.6), friction: 0.5, userData: tag(inst) });
    inst.main = b;
    inst.bodies.push(b);
  },
  draw(g, inst, t) {
    const dir = inst.part.flip ? -1 : 1;
    withBody(g, inst.main, () => {
      // airflow hint
      g.save();
      g.globalAlpha = 0.18;
      const grad = g.createLinearGradient(0, 0, FAN_RANGE * dir, 0);
      grad.addColorStop(0, '#9fd8ff');
      grad.addColorStop(1, 'rgba(159,216,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0.5 * dir, -0.5);
      g.lineTo(FAN_RANGE * dir, -FAN_HALF_H);
      g.lineTo(FAN_RANGE * dir, FAN_HALF_H);
      g.lineTo(0.5 * dir, 0.5);
      g.fill();
      g.globalAlpha = 0.35;
      g.strokeStyle = '#cdeeff';
      g.lineWidth = 0.04;
      for (let i = 0; i < 4; i++) {
        const ph = ((t * 1.6 + i / 4) % 1) * (FAN_RANGE - 1) + 0.8;
        const yy = ((i * 0.37) % 1) * 1.4 - 0.7;
        g.beginPath();
        g.moveTo(ph * dir, yy);
        g.lineTo((ph + 0.7) * dir, yy);
        g.stroke();
      }
      g.restore();
      // stand
      rrect(g, -0.45, 0.35, 0.9, 0.25, 0.05);
      g.fillStyle = '#3c4458';
      g.fill();
      stroke(g);
      rrect(g, -0.5, -0.6, 1.0, 1.0, 0.18);
      g.fillStyle = '#4b8fc9';
      g.fill();
      stroke(g);
      g.save();
      g.translate(0.05 * dir, -0.1);
      g.scale(0.45, 1);
      g.beginPath();
      g.arc(0, 0, 0.42, 0, Math.PI * 2);
      g.fillStyle = '#20324a';
      g.fill();
      g.rotate(t * 30);
      g.fillStyle = '#cfe7fa';
      for (let i = 0; i < 3; i++) {
        g.rotate((Math.PI * 2) / 3);
        g.beginPath();
        g.ellipse(0, -0.2, 0.08, 0.2, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    });
  },
};

const hook: PartDef = {
  type: 'hook',
  name: 'Hook',
  desc: 'A fixed anchor point to hang ropes from.',
  dynamic: false,
  rotate: false,
  flip: false,
  color: '#e8c547',
  radius: 0.25,
  bounds: () => ({ x0: -0.25, y0: -0.25, x1: 0.25, y1: 0.25 }),
  ropeAnchor: () => ({ x: 0, y: 0 }),
  build(world, p, inst) {
    const b = world.createBody(bodyDef(p, false));
    b.createFixture({ shape: new Circle(0.15), isSensor: true, userData: tag(inst) });
    inst.main = b;
    inst.bodies.push(b);
  },
  draw(g, inst) {
    withBody(g, inst.main, () => {
      g.beginPath();
      g.arc(0, 0, 0.2, 0, Math.PI * 2);
      g.fillStyle = '#e8c547';
      g.fill();
      stroke(g, 0.05);
      g.beginPath();
      g.arc(0, 0, 0.08, 0, Math.PI * 2);
      g.fillStyle = OUTLINE;
      g.fill();
    });
  },
};

export const PULLEY_R = 0.4;
const pulley: PartDef = {
  type: 'pulley',
  name: 'Pulley',
  desc: 'Run a rope over it: when one end goes down, the other goes up.',
  dynamic: false,
  rotate: false,
  flip: false,
  color: '#aeb7c2',
  radius: PULLEY_R + 0.1,
  bounds: () => ({ x0: -PULLEY_R, y0: -PULLEY_R - 0.4, x1: PULLEY_R, y1: PULLEY_R }),
  build(world, p, inst) {
    const b = world.createBody(bodyDef(p, false));
    b.createFixture({ shape: new Circle(PULLEY_R), friction: 0.3, userData: tag(inst) });
    inst.main = b;
    inst.bodies.push(b);
  },
  draw(g, inst, t) {
    withBody(g, inst.main, () => {
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(0, -PULLEY_R - 0.35);
      g.lineWidth = 0.1;
      g.strokeStyle = '#59606e';
      g.stroke();
      g.beginPath();
      g.arc(0, 0, PULLEY_R, 0, Math.PI * 2);
      g.fillStyle = '#aeb7c2';
      g.fill();
      stroke(g);
      g.save();
      g.rotate(t * 0); // rotation is driven by rope movement in sim (visual only)
      g.beginPath();
      g.arc(0, 0, PULLEY_R * 0.65, 0, Math.PI * 2);
      g.strokeStyle = '#7d8794';
      g.lineWidth = 0.05;
      g.stroke();
      g.restore();
      g.beginPath();
      g.arc(0, 0, 0.09, 0, Math.PI * 2);
      g.fillStyle = OUTLINE;
      g.fill();
    });
  },
};

export const PART_DEFS: Record<PartType, PartDef> = {
  bowling,
  basketball,
  baseball,
  balloon,
  crate,
  domino,
  bucket,
  wall,
  conveyor,
  trampoline,
  seesaw,
  needle,
  fan,
  hook,
  pulley,
};

export const BIN_ORDER: PartType[] = [
  'bowling',
  'basketball',
  'baseball',
  'balloon',
  'crate',
  'domino',
  'bucket',
  'wall',
  'conveyor',
  'trampoline',
  'seesaw',
  'needle',
  'fan',
  'hook',
  'pulley',
];

export function defaultPart(type: PartType, x: number, y: number, id: string): Part {
  const def = PART_DEFS[type];
  return { id, type, x, y, angle: 0, length: def.resize?.def ?? 1, flip: false };
}

/** world → part-local (ignores physics; uses the part's placed pose) */
export function toLocal(p: Part, wx: number, wy: number) {
  const dx = wx - p.x;
  const dy = wy - p.y;
  const c = Math.cos(-p.angle);
  const s = Math.sin(-p.angle);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

export function toWorld(p: Part, lx: number, ly: number) {
  const c = Math.cos(p.angle);
  const s = Math.sin(p.angle);
  return { x: p.x + lx * c - ly * s, y: p.y + lx * s + ly * c };
}

export function hitPart(p: Part, wx: number, wy: number, pad = 0.1): boolean {
  const def = PART_DEFS[p.type];
  if (def.radius) {
    return Math.hypot(wx - p.x, wy - p.y) <= def.radius + pad;
  }
  const l = toLocal(p, wx, wy);
  const b = def.bounds(p);
  return l.x >= b.x0 - pad && l.x <= b.x1 + pad && l.y >= b.y0 - pad && l.y <= b.y1 + pad;
}
