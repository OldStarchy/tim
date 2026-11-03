// Fire & light (candle, magnifying glass, light bulb, flint, rocket) and critters (cat, mouse).

import { Body, Box, Circle, Polygon, Vec2 } from 'planck';
import type { Part, PartType } from './model';
import {
  type G,
  type Inst,
  type PartDef,
  type SimApi,
  OUTLINE,
  bodyDef,
  pinMark,
  rrect,
  stroke,
  tag,
  withBody,
} from './partkit';

const TAU = Math.PI * 2;
const fx = (p: Part) => (p.flip ? -1 : 1);

function flame(g: G, x: number, y: number, s: number, t: number, seed = 0) {
  const w = Math.sin(t * 23 + seed) * 0.04 + Math.sin(t * 37 + seed * 2) * 0.03;
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  const glow = g.createRadialGradient(0, -0.1, 0, 0, -0.1, 0.9);
  glow.addColorStop(0, 'rgba(255,200,90,0.35)');
  glow.addColorStop(1, 'rgba(255,200,90,0)');
  g.fillStyle = glow;
  g.beginPath();
  g.arc(0, -0.1, 0.9, 0, TAU);
  g.fill();
  g.beginPath();
  g.moveTo(0, 0.05);
  g.quadraticCurveTo(0.18, -0.05, w * 2, -0.42 + w);
  g.quadraticCurveTo(-0.18, -0.05, 0, 0.05);
  g.fillStyle = '#ffb02e';
  g.fill();
  g.beginPath();
  g.moveTo(0, 0.03);
  g.quadraticCurveTo(0.08, -0.04, w, -0.24 + w);
  g.quadraticCurveTo(-0.08, -0.04, 0, 0.03);
  g.fillStyle = '#fff3b0';
  g.fill();
  g.restore();
}

function worldOf(inst: Inst, x: number, y: number) {
  return inst.main.getWorldPoint(Vec2(x, y));
}

// ================================================================= candle

const CANDLE_WICK = -0.62;
const candle: PartDef = {
  type: 'candle',
  name: 'Candle',
  desc: 'Light it with a flame, sparks or a magnifying glass (or press F to place it already lit). Its flame lights candles, rockets and TNT, pops balloons and burns through ropes. A fan blows it out.',
  category: 'Fire & Light',
  dynamic: true,
  rotate: true,
  flip: true,
  color: '#ffe3a3',
  bounds: () => ({ x0: -0.3, y0: -0.95, x1: 0.3, y1: 0.55 }),
  ignite: () => ({ x: 0, y: CANDLE_WICK, r: 0.25 }),
  onIgnite(api, inst) {
    inst.st.lit = true;
    const p = worldOf(inst, 0, CANDLE_WICK);
    api.emit({ kind: 'ignite', x: p.x, y: p.y });
  },
  heat: (inst) => {
    if (!inst.st.lit) return [];
    const p = worldOf(inst, 0, CANDLE_WICK - 0.2);
    return [{ x: p.x, y: p.y, r: 0.5 }];
  },
  light: (inst) => (inst.st.lit ? worldOf(inst, 0, CANDLE_WICK - 0.2) : null),
  build(world, p, inst) {
    const b = world.createBody(bodyDef(p, true, { angularDamping: 0.5 }));
    b.createFixture({ shape: new Box(0.13, 0.5, Vec2(0, -0.05), 0), density: 1, friction: 0.6, userData: tag(inst) });
    b.createFixture({ shape: new Box(0.3, 0.06, Vec2(0, 0.48), 0), density: 2, friction: 0.7, userData: tag(inst) });
    inst.main = b;
    inst.bodies.push(b);
    // a candle placed lit (flip) starts burning
    if (p.flip) inst.st.lit = true;
  },
  draw(g, inst, t) {
    withBody(g, inst.main, () => {
      rrect(g, -0.3, 0.42, 0.6, 0.12, 0.04);
      g.fillStyle = '#c99a55';
      g.fill();
      stroke(g, 0.04);
      rrect(g, -0.13, -0.55, 0.26, 1.0, 0.05);
      const grad = g.createLinearGradient(-0.13, 0, 0.13, 0);
      grad.addColorStop(0, '#f6e7c8');
      grad.addColorStop(0.4, '#fffaf0');
      grad.addColorStop(1, '#e8d4ad');
      g.fillStyle = grad;
      g.fill();
      stroke(g, 0.04);
      g.beginPath();
      g.moveTo(0, -0.55);
      g.lineTo(0.01, CANDLE_WICK - 0.05);
      g.lineWidth = 0.03;
      g.strokeStyle = '#2a2a2a';
      g.stroke();
      pinMark(g, inst);
    });
    if (inst.st.lit) {
      const p = worldOf(inst, 0, CANDLE_WICK);
      flame(g, p.x, p.y, 1, t, inst.part.x);
    }
  },
};

// ================================================================= magnifying glass

export const LENS_FOCUS = 3;
export const LENS_RANGE = 10;
const lens: PartDef = {
  type: 'lens',
  name: 'Magnifying Glass',
  desc: `Focuses light from a candle or bulb behind it into a hot spot ${LENS_FOCUS} squares in front, lighting whatever is there. Rotate to aim; flip (F) to turn it around.`,
  category: 'Fire & Light',
  dynamic: false,
  rotate: true,
  flip: true,
  color: '#bfe6ff',
  bounds: () => ({ x0: -0.2, y0: -0.65, x1: 0.2, y1: 1.3 }),
  build(world, p, inst) {
    const b = world.createBody(bodyDef(p, false));
    b.createFixture({ shape: new Box(0.12, 0.6), friction: 0.4, userData: tag(inst) });
    inst.main = b;
    inst.bodies.push(b);
  },
  onStep(api, inst, dt) {
    // light from behind (local -x, or +x when flipped), roughly on axis
    const f = fx(inst.part);
    let src: { x: number; y: number } | null = null;
    let best = Infinity;
    for (const other of api.insts.values()) {
      if (other.removed || other === inst) continue;
      const L = PARTS_FIRE_LIGHT(other);
      if (!L) continue;
      const lp = inst.main.getLocalPoint(Vec2(L.x, L.y));
      const back = -lp.x * f;
      if (back < 0.3 || back > LENS_RANGE) continue;
      if (Math.abs(Math.atan2(lp.y, back)) > 0.45) continue;
      if (back < best) {
        best = back;
        src = L;
      }
    }
    inst.st.src = src;
    inst.st.focus = Math.max(0, Math.min(1.5, ((inst.st.focus as number) ?? 0) + (src ? dt : -dt * 2)));
  },
  heat: (inst) => {
    if (((inst.st.focus as number) ?? 0) < 0.6) return [];
    const p = worldOf(inst, LENS_FOCUS * fx(inst.part), 0);
    return [{ x: p.x, y: p.y, r: 0.5 }];
  },
  draw(g, inst, t) {
    const f = fx(inst.part);
    const focus = (inst.st.focus as number) ?? 0;
    const src = inst.st.src as { x: number; y: number } | null;
    if (src && focus > 0) {
      const a = Math.min(1, focus);
      // light arriving at the lens
      const top = worldOf(inst, 0, -0.55);
      const bot = worldOf(inst, 0, 0.55);
      g.beginPath();
      g.moveTo(src.x, src.y);
      g.lineTo(top.x, top.y);
      g.lineTo(bot.x, bot.y);
      g.closePath();
      g.fillStyle = `rgba(255,236,170,${0.08 * a})`;
      g.fill();
      // focused cone
      const fp = worldOf(inst, LENS_FOCUS * f, 0);
      g.beginPath();
      g.moveTo(top.x, top.y);
      g.lineTo(fp.x, fp.y);
      g.lineTo(bot.x, bot.y);
      g.closePath();
      g.fillStyle = `rgba(255,236,170,${0.22 * a})`;
      g.fill();
      if (focus >= 0.6) {
        const r = 0.15 + Math.sin(t * 30) * 0.03;
        g.beginPath();
        g.arc(fp.x, fp.y, r, 0, TAU);
        g.fillStyle = '#fff6c9';
        g.fill();
      }
    }
    if (!src) {
      // show where it would focus, so it can be aimed
      const fp = worldOf(inst, LENS_FOCUS * f, 0);
      const o = worldOf(inst, 0.2 * f, 0);
      g.save();
      g.setLineDash([0.12, 0.14]);
      g.lineWidth = 0.035;
      g.strokeStyle = 'rgba(255,214,102,0.35)';
      g.beginPath();
      g.moveTo(o.x, o.y);
      g.lineTo(fp.x, fp.y);
      g.stroke();
      g.setLineDash([]);
      g.beginPath();
      g.arc(fp.x, fp.y, 0.2, 0, TAU);
      g.stroke();
      g.restore();
    }
    withBody(g, inst.main, () => {
      // handle
      rrect(g, -0.07, 0.62, 0.14, 0.68, 0.05);
      g.fillStyle = '#7a4b2a';
      g.fill();
      stroke(g, 0.04);
      // rim and lens, seen edge-on
      g.beginPath();
      g.ellipse(0, 0, 0.16, 0.62, 0, 0, TAU);
      g.fillStyle = '#3a4152';
      g.fill();
      stroke(g, 0.05);
      g.beginPath();
      g.ellipse(0, 0, 0.09, 0.54, 0, 0, TAU);
      g.fillStyle = 'rgba(190,230,255,0.75)';
      g.fill();
      g.beginPath();
      g.ellipse(-0.02 * f, -0.18, 0.025, 0.16, 0, 0, TAU);
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.fill();
      // little arrow showing which way it focuses
      g.fillStyle = 'rgba(255,214,102,0.8)';
      g.beginPath();
      g.moveTo(0.42 * f, 0);
      g.lineTo(0.26 * f, -0.09);
      g.lineTo(0.26 * f, 0.09);
      g.closePath();
      g.fill();
    });
  },
};

// ================================================================= light bulb

export const BULB_HUB = { x: 0, y: 0.55, r: 0.25 };
const bulb: PartDef = {
  type: 'bulb',
  name: 'Light Bulb',
  desc: 'A dynamo lamp: belt it to a motor, mouse motor or gear and it lights up. Its light is cool, but a magnifying glass can focus it.',
  category: 'Fire & Light',
  dynamic: false,
  rotate: true,
  flip: false,
  color: '#fff3a0',
  bounds: () => ({ x0: -0.45, y0: -0.75, x1: 0.45, y1: 0.85 }),
  drives: () => [BULB_HUB],
  onPower(inst, omega) {
    inst.st.on = omega !== 0;
  },
  light: (inst) => (inst.st.on ? worldOf(inst, 0, -0.25) : null),
  build(world, p, inst) {
    const b = world.createBody(bodyDef(p, false));
    b.createFixture({ shape: new Circle(Vec2(0, -0.25), 0.42), friction: 0.3, userData: tag(inst) });
    b.createFixture({ shape: new Box(0.3, 0.38, Vec2(0, 0.45), 0), friction: 0.5, userData: tag(inst) });
    inst.main = b;
    inst.bodies.push(b);
  },
  draw(g, inst, t) {
    const on = !!inst.st.on;
    withBody(g, inst.main, () => {
      if (on) {
        const flick = 0.92 + Math.sin(t * 50) * 0.04;
        const glow = g.createRadialGradient(0, -0.25, 0, 0, -0.25, 2.2);
        glow.addColorStop(0, `rgba(255,245,170,${0.5 * flick})`);
        glow.addColorStop(1, 'rgba(255,245,170,0)');
        g.fillStyle = glow;
        g.beginPath();
        g.arc(0, -0.25, 2.2, 0, TAU);
        g.fill();
      }
      // dynamo housing
      rrect(g, -0.32, 0.25, 0.64, 0.6, 0.08);
      g.fillStyle = '#4b8fc9';
      g.fill();
      stroke(g, 0.05);
      // screw base
      g.fillStyle = '#aeb7c2';
      g.fillRect(-0.18, 0.05, 0.36, 0.22);
      g.beginPath();
      g.rect(-0.18, 0.05, 0.36, 0.22);
      stroke(g, 0.04);
      g.beginPath();
      g.moveTo(-0.18, 0.12);
      g.lineTo(0.18, 0.12);
      g.moveTo(-0.18, 0.19);
      g.lineTo(0.18, 0.19);
      g.lineWidth = 0.03;
      g.strokeStyle = '#6b7482';
      g.stroke();
      // glass
      g.beginPath();
      g.arc(0, -0.28, 0.42, Math.PI * 0.78, Math.PI * 2.22);
      g.lineTo(0.15, 0.05);
      g.lineTo(-0.15, 0.05);
      g.closePath();
      g.fillStyle = on ? '#fff6b8' : 'rgba(210,225,240,0.55)';
      g.fill();
      stroke(g, 0.05);
      // filament
      g.beginPath();
      g.moveTo(-0.08, 0.02);
      g.lineTo(-0.1, -0.25);
      g.quadraticCurveTo(0, -0.42, 0.1, -0.25);
      g.lineTo(0.08, 0.02);
      g.lineWidth = 0.03;
      g.strokeStyle = on ? '#ff9a2e' : '#59606e';
      g.stroke();
      if (!on) {
        g.beginPath();
        g.ellipse(-0.17, -0.42, 0.05, 0.12, 0.5, 0, TAU);
        g.fillStyle = 'rgba(255,255,255,0.7)';
        g.fill();
      }
    });
    const c = Math.cos(inst.part.angle);
    const s = Math.sin(inst.part.angle);
    const hx = inst.part.x + BULB_HUB.x * c - BULB_HUB.y * s;
    const hy = inst.part.y + BULB_HUB.x * s + BULB_HUB.y * c;
    g.beginPath();
    g.arc(hx, hy, BULB_HUB.r, 0, TAU);
    g.fillStyle = '#3a4152';
    g.fill();
    stroke(g, 0.04);
  },
};

// ================================================================= flint

const flint: PartDef = {
  type: 'flint',
  name: 'Flint',
  desc: 'A flint striker. Hit it hard and it throws sparks that light candles, rockets and TNT close by.',
  category: 'Fire & Light',
  dynamic: false,
  rotate: true,
  flip: false,
  color: '#9aa3ad',
  bounds: () => ({ x0: -0.55, y0: -0.4, x1: 0.55, y1: 0.35 }),
  build(world, p, inst) {
    const b = world.createBody(bodyDef(p, false));
    b.createFixture({
      shape: new Polygon([Vec2(-0.5, 0.3), Vec2(-0.35, -0.25), Vec2(0.05, -0.38), Vec2(0.45, -0.18), Vec2(0.52, 0.3)]),
      friction: 0.5,
      restitution: 0.3,
      userData: tag(inst),
    });
    inst.main = b;
    inst.bodies.push(b);
  },
  onContact(api, inst, _role, other, otherInst, speed) {
    if (speed < 4 || otherInst === inst) return;
    if (api.time - ((inst.st.lastSpark as number) ?? -1) < 0.2) return;
    inst.st.lastSpark = api.time;
    // sparks fly from where it was struck
    const c = other.getWorldCenter();
    const top = worldOf(inst, 0, -0.3);
    const x = (c.x + top.x) / 2;
    const y = (c.y + top.y) / 2;
    api.addHeat(x, y, 1.8, 0.3);
    api.emit({ kind: 'spark', x, y });
  },
  draw(g, inst) {
    withBody(g, inst.main, () => {
      g.beginPath();
      g.moveTo(-0.5, 0.3);
      g.lineTo(-0.35, -0.25);
      g.lineTo(0.05, -0.38);
      g.lineTo(0.45, -0.18);
      g.lineTo(0.52, 0.3);
      g.closePath();
      const grad = g.createLinearGradient(-0.4, -0.4, 0.4, 0.3);
      grad.addColorStop(0, '#c4ccd6');
      grad.addColorStop(1, '#5e6773');
      g.fillStyle = grad;
      g.fill();
      stroke(g);
      g.beginPath();
      g.moveTo(-0.3, -0.15);
      g.lineTo(-0.05, 0.05);
      g.lineTo(0.2, -0.2);
      g.moveTo(0.1, 0.15);
      g.lineTo(0.35, 0.05);
      g.lineWidth = 0.03;
      g.strokeStyle = 'rgba(255,255,255,0.45)';
      g.stroke();
    });
  },
};

// ================================================================= rocket

export const ROCKET_BURN = 2.5;
export const ROCKET_THRUST = 3.2; // × its own weight
const rocket: PartDef = {
  type: 'rocket',
  name: 'Rocket',
  desc: 'Light the fuse at the tail and it blasts off nose-first for a few seconds. Tie a rope to it to haul things. Its exhaust lights things too.',
  category: 'Fire & Light',
  dynamic: true,
  rotate: true,
  flip: false,
  color: '#ff6b5e',
  bounds: () => ({ x0: -0.45, y0: -0.85, x1: 0.45, y1: 0.95 }),
  ropeAnchors: () => [{ x: 0, y: 0.1 }],
  ignite: () => ({ x: 0, y: 0.85, r: 0.3 }),
  onIgnite(api, inst) {
    inst.st.burn = ROCKET_BURN;
    const p = worldOf(inst, 0, 0.8);
    api.emit({ kind: 'launch', x: p.x, y: p.y });
  },
  onStep(api, inst, dt) {
    const burn = (inst.st.burn as number) ?? 0;
    if (burn <= 0 || !inst.main.isDynamic()) return;
    inst.st.burn = burn - dt;
    const b = inst.main;
    const dir = b.getWorldVector(Vec2(0, -1));
    b.applyForceToCenter(Vec2.mul(dir, b.getMass() * 25 * ROCKET_THRUST), true);
    // fins keep it pointing where it's going
    b.setAngularVelocity(b.getAngularVelocity() * 0.9);
    inst.st.puff = ((inst.st.puff as number) ?? 0) - dt;
    if (inst.st.puff <= 0) {
      inst.st.puff = 0.04;
      const tail = worldOf(inst, 0, 0.9);
      const v = b.getLinearVelocity();
      api.emit({ kind: 'smoke', x: tail.x, y: tail.y, vx: -dir.x * 4 + v.x * 0.2, vy: -dir.y * 4 + v.y * 0.2 });
    }
  },
  heat: (inst) => {
    if (!(((inst.st.burn as number) ?? 0) > 0)) return [];
    const p = worldOf(inst, 0, 1.15);
    return [{ x: p.x, y: p.y, r: 0.45 }];
  },
  light: (inst) => ((((inst.st.burn as number) ?? 0) > 0 ? worldOf(inst, 0, 1.1) : null)),
  build(world, p, inst) {
    const b = world.createBody(bodyDef(p, true, { angularDamping: 2 }));
    b.createFixture({ shape: new Box(0.2, 0.5, Vec2(0, 0.1), 0), density: 1, friction: 0.5, userData: tag(inst) });
    b.createFixture({ shape: new Polygon([Vec2(-0.2, -0.4), Vec2(0, -0.85), Vec2(0.2, -0.4)]), density: 1, friction: 0.5, userData: tag(inst) });
    b.createFixture({ shape: new Polygon([Vec2(-0.2, 0.25), Vec2(-0.42, 0.65), Vec2(-0.2, 0.6)]), density: 0.5, userData: tag(inst) });
    b.createFixture({ shape: new Polygon([Vec2(0.2, 0.25), Vec2(0.2, 0.6), Vec2(0.42, 0.65)]), density: 0.5, userData: tag(inst) });
    inst.main = b;
    inst.bodies.push(b);
  },
  draw(g, inst, t) {
    const burning = ((inst.st.burn as number) ?? 0) > 0;
    withBody(g, inst.main, () => {
      if (burning) {
        const L = 0.6 + Math.sin(t * 40) * 0.12;
        g.beginPath();
        g.moveTo(-0.16, 0.6);
        g.quadraticCurveTo(0, 0.7 + L * 1.4, 0.16, 0.6);
        g.closePath();
        g.fillStyle = '#ff8a2e';
        g.fill();
        g.beginPath();
        g.moveTo(-0.09, 0.6);
        g.quadraticCurveTo(0, 0.65 + L * 0.8, 0.09, 0.6);
        g.closePath();
        g.fillStyle = '#fff3b0';
        g.fill();
      } else if (inst.st.burn === undefined) {
        // fuse
        g.beginPath();
        g.moveTo(0, 0.6);
        g.quadraticCurveTo(0.1, 0.75, 0, 0.88);
        g.lineWidth = 0.035;
        g.strokeStyle = '#d8c08a';
        g.stroke();
      }
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(0.2 * s, 0.25);
        g.lineTo(0.42 * s, 0.65);
        g.lineTo(0.2 * s, 0.6);
        g.closePath();
        g.fillStyle = '#d93a32';
        g.fill();
        stroke(g, 0.04);
      }
      g.beginPath();
      g.moveTo(-0.2, 0.6);
      g.lineTo(-0.2, -0.4);
      g.quadraticCurveTo(-0.18, -0.7, 0, -0.85);
      g.quadraticCurveTo(0.18, -0.7, 0.2, -0.4);
      g.lineTo(0.2, 0.6);
      g.closePath();
      const grad = g.createLinearGradient(-0.2, 0, 0.2, 0);
      grad.addColorStop(0, '#c7ced8');
      grad.addColorStop(0.45, '#ffffff');
      grad.addColorStop(1, '#9aa4b2');
      g.fillStyle = grad;
      g.fill();
      stroke(g, 0.05);
      g.beginPath();
      g.moveTo(-0.17, -0.55);
      g.quadraticCurveTo(0, -0.62, 0.17, -0.55);
      g.quadraticCurveTo(0.12, -0.75, 0, -0.85);
      g.quadraticCurveTo(-0.12, -0.75, -0.17, -0.55);
      g.fillStyle = '#e8463c';
      g.fill();
      g.beginPath();
      g.arc(0, -0.15, 0.09, 0, TAU);
      g.fillStyle = '#7fc4f0';
      g.fill();
      stroke(g, 0.035);
      pinMark(g, inst);
    });
  },
};

// ================================================================= critters

const CAT_RUN = 5.5;
const MOUSE_RUN = 7;
const SCARE_RANGE = 8;
const SPOT_RANGE = 7;

function grounded(api: SimApi, b: Body, half: number) {
  const c = b.getWorldCenter();
  let hit = false;
  for (const dx of [-half * 0.8, 0, half * 0.8]) {
    api.world.rayCast(Vec2(c.x + dx, c.y), Vec2(c.x + dx, c.y + half + 0.15), (f) => {
      if (f.getBody() === b || f.isSensor()) return -1;
      hit = true;
      return 0;
    });
  }
  return hit;
}

function canSee(api: SimApi, from: Body, to: Body) {
  let blocked = false;
  api.world.rayCast(from.getWorldCenter(), to.getWorldCenter(), (f) => {
    const b = f.getBody();
    if (b === from || b === to || f.isSensor() || b.isDynamic()) return -1;
    blocked = true;
    return 0;
  });
  return !blocked;
}

function walk(api: SimApi, inst: Inst, half: number, dir: number, speed: number) {
  const b = inst.main;
  if (!grounded(api, b, half)) return;
  const v = b.getLinearVelocity();
  b.setLinearVelocity(Vec2(dir * speed, Math.min(v.y, 0)));
}

export function wakeCat(api: SimApi, cat: Inst) {
  if (cat.st.awake || cat.removed) return;
  cat.st.awake = true;
  const p = cat.main.getPosition();
  api.emit({ kind: 'meow', x: p.x, y: p.y });
}

const cat: PartDef = {
  type: 'cat',
  name: 'Cat',
  desc: 'Naps until something bumps it, a bell rings nearby, or it spots a mouse. Then it chases the nearest mouse. Flip (F) to choose which way it faces.',
  category: 'Critters',
  dynamic: true,
  rotate: false,
  flip: true,
  color: '#f0a050',
  bounds: () => ({ x0: -0.85, y0: -0.75, x1: 0.85, y1: 0.45 }),
  build(world, p, inst) {
    const b = world.createBody(bodyDef(p, true, { fixedRotation: true }));
    b.createFixture({ shape: new Box(0.7, 0.4, Vec2(0, 0.05), 0), density: 1.2, friction: 0.3, userData: tag(inst) });
    inst.main = b;
    inst.bodies.push(b);
    inst.st.face = fx(p);
  },
  onContact(api, inst, _role, other, otherInst, speed) {
    if (otherInst === inst || !other.isDynamic() || speed < 1.5) return;
    if (otherInst?.part.type === 'rodent') return; // that's lunch, not an alarm clock
    wakeCat(api, inst);
  },
  onStep(api, inst) {
    let prey: Inst | null = null;
    let best = Infinity;
    const me = inst.main.getPosition();
    for (const o of api.insts.values()) {
      if (o.removed || o.part.type !== 'rodent') continue;
      const p = o.main.getPosition();
      const d = Math.hypot(p.x - me.x, p.y - me.y);
      if (d < best) {
        best = d;
        prey = o;
      }
    }
    if (!inst.st.awake && prey && best < SPOT_RANGE && Math.abs(prey.main.getPosition().y - me.y) < 2 && canSee(api, inst.main, prey.main)) {
      wakeCat(api, inst);
    }
    if (!inst.st.awake) return;
    if (prey && best > 0.9) {
      const dir = Math.sign(prey.main.getPosition().x - me.x) || inst.st.face;
      inst.st.face = dir;
      inst.st.running = true;
      walk(api, inst, 0.45, dir, CAT_RUN);
    } else inst.st.running = false;
  },
  draw(g, inst, t) {
    const awake = !!inst.st.awake;
    const run = !!inst.st.running;
    const face = (inst.st.face as number) ?? fx(inst.part);
    withBody(g, inst.main, () => {
      g.scale(face, 1);
      const fur = '#f0a050';
      const dark = '#c4702c';
      if (!awake) {
        // curled-up loaf
        g.beginPath();
        g.ellipse(-0.05, 0.12, 0.75, 0.33, 0, 0, TAU);
        g.fillStyle = fur;
        g.fill();
        stroke(g, 0.05);
        g.beginPath();
        g.moveTo(-0.75, 0.25);
        g.quadraticCurveTo(-0.3, 0.55, 0.4, 0.38);
        g.lineWidth = 0.16;
        g.strokeStyle = OUTLINE;
        g.stroke();
        g.lineWidth = 0.1;
        g.strokeStyle = dark;
        g.stroke();
        for (const x of [-0.4, -0.1, 0.2]) {
          g.beginPath();
          g.moveTo(x, -0.18);
          g.lineTo(x + 0.08, 0.05);
          g.lineWidth = 0.06;
          g.strokeStyle = dark;
          g.stroke();
        }
        g.beginPath();
        g.arc(0.52, 0.0, 0.28, 0, TAU);
        g.fillStyle = fur;
        g.fill();
        stroke(g, 0.05);
        for (const s of [-1, 1]) {
          g.beginPath();
          g.moveTo(0.52 + s * 0.2, -0.13);
          g.lineTo(0.52 + s * 0.12, -0.38);
          g.lineTo(0.52 + s * 0.02, -0.2);
          g.closePath();
          g.fillStyle = fur;
          g.fill();
          stroke(g, 0.04);
        }
        g.beginPath();
        g.moveTo(0.4, 0.0);
        g.quadraticCurveTo(0.45, 0.05, 0.5, 0.0);
        g.moveTo(0.56, 0.0);
        g.quadraticCurveTo(0.61, 0.05, 0.66, 0.0);
        g.lineWidth = 0.03;
        g.strokeStyle = OUTLINE;
        g.stroke();
        g.save();
        g.scale(face, 1);
        g.fillStyle = '#cfe7fa';
        g.font = '700 0.26px Nunito, sans-serif';
        const zz = (t * 0.4) % 0.3;
        g.fillText('z', 0.6 * face, -0.45 - zz);
        g.fillText('z', 0.8 * face, -0.7 - zz);
        g.restore();
        return;
      }
      const k = run ? Math.sin(t * 22) * 0.16 : 0;
      // tail
      g.beginPath();
      g.moveTo(-0.62, -0.05);
      g.quadraticCurveTo(-1.0, -0.2 + k * 0.5, -0.85, -0.6);
      g.lineWidth = 0.14;
      g.strokeStyle = OUTLINE;
      g.stroke();
      g.lineWidth = 0.08;
      g.strokeStyle = fur;
      g.stroke();
      // legs
      for (const [x, ph] of [
        [-0.45, 1],
        [-0.25, -1],
        [0.3, -1],
        [0.5, 1],
      ]) {
        g.beginPath();
        g.moveTo(x, 0.1);
        g.lineTo(x + k * ph, 0.43);
        g.lineWidth = 0.13;
        g.strokeStyle = OUTLINE;
        g.stroke();
        g.lineWidth = 0.08;
        g.strokeStyle = fur;
        g.stroke();
      }
      // body
      g.beginPath();
      g.ellipse(0, 0.0, 0.66, 0.26, 0, 0, TAU);
      g.fillStyle = fur;
      g.fill();
      stroke(g, 0.05);
      for (const x of [-0.35, -0.1, 0.15]) {
        g.beginPath();
        g.moveTo(x, -0.24);
        g.lineTo(x + 0.06, -0.02);
        g.lineWidth = 0.06;
        g.strokeStyle = dark;
        g.stroke();
      }
      // head
      g.beginPath();
      g.arc(0.66, -0.3, 0.27, 0, TAU);
      g.fillStyle = fur;
      g.fill();
      stroke(g, 0.05);
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(0.66 + s * 0.2, -0.45);
        g.lineTo(0.66 + s * 0.14, -0.72);
        g.lineTo(0.66 + s * 0.02, -0.52);
        g.closePath();
        g.fillStyle = fur;
        g.fill();
        stroke(g, 0.04);
      }
      g.beginPath();
      g.ellipse(0.76, -0.33, 0.05, 0.08, 0, 0, TAU);
      g.fillStyle = '#7bd36a';
      g.fill();
      g.beginPath();
      g.ellipse(0.77, -0.33, 0.02, 0.06, 0, 0, TAU);
      g.fillStyle = OUTLINE;
      g.fill();
      g.beginPath();
      g.arc(0.92, -0.25, 0.04, 0, TAU);
      g.fillStyle = '#e7889a';
      g.fill();
      g.beginPath();
      g.moveTo(0.85, -0.2);
      g.lineTo(1.08, -0.24);
      g.moveTo(0.85, -0.17);
      g.lineTo(1.06, -0.12);
      g.lineWidth = 0.015;
      g.strokeStyle = '#f4f1e6';
      g.stroke();
    });
  },
};

const rodent: PartDef = {
  type: 'rodent',
  name: 'Mouse',
  desc: 'Minds its own business until a cat comes near, then runs away from it as fast as it can (which is faster than the cat).',
  category: 'Critters',
  dynamic: true,
  rotate: false,
  flip: true,
  color: '#b7b1aa',
  bounds: () => ({ x0: -0.5, y0: -0.35, x1: 0.45, y1: 0.25 }),
  build(world, p, inst) {
    const b = world.createBody(bodyDef(p, true, { fixedRotation: true }));
    b.createFixture({ shape: new Box(0.32, 0.2, Vec2(0, 0.03), 0), density: 0.8, friction: 0.3, userData: tag(inst) });
    inst.main = b;
    inst.bodies.push(b);
    inst.st.face = fx(p);
  },
  onStep(api, inst) {
    const me = inst.main.getPosition();
    let threat: Inst | null = null;
    let best = Infinity;
    for (const o of api.insts.values()) {
      if (o.removed || o.part.type !== 'cat' || !o.st.awake) continue;
      const p = o.main.getPosition();
      const d = Math.hypot(p.x - me.x, p.y - me.y);
      if (d < best) {
        best = d;
        threat = o;
      }
    }
    if (threat && best < SCARE_RANGE) {
      const dx = me.x - threat.main.getPosition().x;
      const dir = Math.abs(dx) < 0.05 ? inst.st.face : Math.sign(dx);
      inst.st.face = dir;
      if (!inst.st.scared) {
        inst.st.scared = true;
        api.emit({ kind: 'squeak', x: me.x, y: me.y });
      }
      walk(api, inst, 0.23, dir, MOUSE_RUN);
    } else inst.st.scared = false;
  },
  draw(g, inst, t) {
    const scared = !!inst.st.scared;
    const face = (inst.st.face as number) ?? fx(inst.part);
    withBody(g, inst.main, () => {
      g.scale(face, 1);
      const k = scared ? Math.sin(t * 45) * 0.06 : 0;
      g.beginPath();
      g.moveTo(-0.3, 0.05);
      g.quadraticCurveTo(-0.55, -0.15 + k * 2, -0.5, 0.15);
      g.lineWidth = 0.03;
      g.strokeStyle = '#e7a7b4';
      g.stroke();
      for (const x of [-0.15, 0.15]) {
        g.beginPath();
        g.moveTo(x, 0.12);
        g.lineTo(x + k, 0.23);
        g.lineWidth = 0.04;
        g.strokeStyle = '#8c8279';
        g.stroke();
      }
      g.beginPath();
      g.ellipse(0, 0.02, 0.3, 0.17, 0, 0, TAU);
      g.fillStyle = '#b7b1aa';
      g.fill();
      stroke(g, 0.04);
      g.beginPath();
      g.ellipse(0.3, -0.02, 0.15, 0.11, 0.25, 0, TAU);
      g.fillStyle = '#b7b1aa';
      g.fill();
      stroke(g, 0.035);
      g.beginPath();
      g.arc(0.22, -0.16, 0.09, 0, TAU);
      g.fillStyle = '#e7a7b4';
      g.fill();
      stroke(g, 0.03);
      g.beginPath();
      g.arc(0.34, -0.05, 0.025, 0, TAU);
      g.fillStyle = OUTLINE;
      g.fill();
      g.beginPath();
      g.arc(0.45, 0.02, 0.025, 0, TAU);
      g.fillStyle = '#e7a7b4';
      g.fill();
      if (scared) {
        g.fillStyle = '#ffd666';
        g.font = '800 0.3px Nunito, sans-serif';
        g.fillText('!', 0.15, -0.3);
      }
    });
  },
};

export const FIRE_PARTS = { candle, lens, bulb, flint, rocket, cat, rodent } satisfies Partial<Record<PartType, PartDef>>;

// lens needs every part's `light`, but importing PART_DEFS here would be circular
let lightOf: Partial<Record<PartType, PartDef>> = {};
/** called once by parts.ts with the full catalog */
export function registerParts(defs: Partial<Record<PartType, PartDef>>) {
  lightOf = defs;
}
function PARTS_FIRE_LIGHT(inst: Inst) {
  return lightOf[inst.part.type]?.light?.(inst) ?? null;
}

