// The second wave of parts: power train, gadgets and more building pieces.

import { Box, Chain, Circle, Polygon, RevoluteJoint, Vec2 } from 'planck';
import type { Part, PartType } from './model';
import { wakeCat } from './parts-fire';
import {
  type G,
  type Inst,
  type PartDef,
  type SimApi,
  OUTLINE,
  ball,
  bodyDef,
  gearPath,
  pinMark,
  rrect,
  shadedBall,
  stroke,
  tag,
  withBody,
  wakeTouching,
  withPart,
} from './partkit';

const TAU = Math.PI * 2;
const fx = (p: Part) => (p.flip ? -1 : 1);

function spin(inst: Inst, dt: number) {
  inst.st.phase = ((inst.st.phase as number) ?? 0) + ((inst.st.omega as number) ?? 0) * dt;
}

function hub(g: G, x: number, y: number, r: number, phase: number) {
  g.save();
  g.translate(x, y);
  g.rotate(phase);
  g.beginPath();
  g.arc(0, 0, r, 0, TAU);
  g.fillStyle = '#3a4152';
  g.fill();
  stroke(g, 0.04);
  g.beginPath();
  g.moveTo(-r * 0.7, 0);
  g.lineTo(r * 0.7, 0);
  g.moveTo(0, -r * 0.7);
  g.lineTo(0, r * 0.7);
  g.lineWidth = 0.04;
  g.strokeStyle = '#aeb7c2';
  g.stroke();
  g.restore();
}

// ================================================================= power

export const MOTOR_OMEGA = 20;
export const MOUSE_OMEGA = 12;
export const HUB_R = 0.3;

const motor: PartDef = {
  type: 'motor',
  name: 'Electric Motor',
  desc: 'Always running. Run a drive belt from its pulley to a conveyor or gear. Flip (F) to reverse.',
  category: 'Power',
  dynamic: false,
  rotate: false,
  flip: true,
  color: '#f2b84b',
  bounds: () => ({ x0: -0.75, y0: -0.6, x1: 0.75, y1: 0.55 }),
  drives: (p) => [{ x: 0.45 * fx(p), y: -0.05, r: HUB_R }],
  source: (inst) => (inst.part.flip ? -MOTOR_OMEGA : MOTOR_OMEGA),
  onPower(inst, omega) {
    inst.st.omega = omega;
  },
  onStep: (_api, inst, dt) => spin(inst, dt),
  build(world, p, inst) {
    const b = world.createBody(bodyDef(p, false));
    b.createFixture({ shape: new Box(0.6, 0.4, Vec2(-0.1 * fx(p), 0.05), 0), friction: 0.6, userData: tag(inst) });
    inst.main = b;
    inst.bodies.push(b);
  },
  draw(g, inst) {
    const p = inst.part;
    withPart(g, p, () => {
      g.scale(fx(p), 1);
      rrect(g, -0.65, 0.35, 1.2, 0.2, 0.05);
      g.fillStyle = '#3c4458';
      g.fill();
      stroke(g, 0.05);
      rrect(g, -0.7, -0.35, 1.0, 0.75, 0.25);
      const grad = g.createLinearGradient(0, -0.35, 0, 0.4);
      grad.addColorStop(0, '#ffd27a');
      grad.addColorStop(1, '#d3912a');
      g.fillStyle = grad;
      g.fill();
      stroke(g);
      g.strokeStyle = 'rgba(20,23,34,0.45)';
      g.lineWidth = 0.04;
      for (const x of [-0.45, -0.25, -0.05]) {
        g.beginPath();
        g.moveTo(x, -0.28);
        g.lineTo(x, 0.33);
        g.stroke();
      }
      // lightning bolt
      g.fillStyle = '#141722';
      g.beginPath();
      g.moveTo(-0.2, -0.22);
      g.lineTo(-0.32, 0.03);
      g.lineTo(-0.22, 0.03);
      g.lineTo(-0.3, 0.25);
      g.lineTo(-0.12, -0.04);
      g.lineTo(-0.22, -0.04);
      g.closePath();
      g.fill();
      g.fillRect(0.28, -0.1, 0.17, 0.1);
    });
    const d = withDrive(p, 0);
    hub(g, d.x, d.y, HUB_R, inst.st.phase ?? 0);
  },
};

function withDrive(p: Part, i: number) {
  const d = motor.drives!(p)[i];
  const c = Math.cos(p.angle);
  const s = Math.sin(p.angle);
  return { x: p.x + d.x * c - d.y * s, y: p.y + d.x * s + d.y * c, r: d.r };
}

const mouse: PartDef = {
  type: 'mouse',
  name: 'Mouse Motor',
  desc: 'A mouse in a running wheel. It naps until something bumps the cage, then runs flat out and powers whatever is belted to it.',
  category: 'Power',
  dynamic: false,
  rotate: false,
  flip: true,
  color: '#c9b8a6',
  bounds: () => ({ x0: -1, y0: -1, x1: 1, y1: 1.15 }),
  drives: () => [{ x: 0, y: 0, r: HUB_R }],
  source: (inst) => (inst.st.running ? (inst.part.flip ? -MOUSE_OMEGA : MOUSE_OMEGA) : 0),
  onPower(inst, omega) {
    inst.st.omega = omega;
  },
  onContact(api, inst, _role, _other, otherInst) {
    if (inst.st.running || otherInst === inst) return;
    inst.st.running = true;
    const p = inst.main.getPosition();
    api.emit({ kind: 'squeak', x: p.x, y: p.y });
    api.powerChanged();
  },
  onStep: (_api, inst, dt) => spin(inst, dt),
  build(world, p, inst) {
    const b = world.createBody(bodyDef(p, false));
    b.createFixture({ shape: new Circle(0.95), friction: 0.5, userData: tag(inst, 'trigger') });
    b.createFixture({ shape: new Box(0.7, 0.1, Vec2(0, 1.05), 0), friction: 0.5, userData: tag(inst) });
    inst.main = b;
    inst.bodies.push(b);
  },
  draw(g, inst, t) {
    const p = inst.part;
    const phase = inst.st.phase ?? 0;
    const running = !!inst.st.running;
    withPart(g, p, () => {
      g.scale(fx(p), 1);
      // stand
      g.beginPath();
      g.moveTo(-0.6, 1.0);
      g.lineTo(0, 0);
      g.lineTo(0.6, 1.0);
      g.lineWidth = 0.1;
      g.strokeStyle = '#59606e';
      g.stroke();
      rrect(g, -0.75, 0.95, 1.5, 0.2, 0.05);
      g.fillStyle = '#3c4458';
      g.fill();
      stroke(g, 0.05);
      // wheel
      g.save();
      g.rotate(phase);
      g.beginPath();
      g.arc(0, 0, 0.92, 0, TAU);
      g.fillStyle = 'rgba(160,190,220,0.12)';
      g.fill();
      g.lineWidth = 0.09;
      g.strokeStyle = '#8fa0b4';
      g.stroke();
      g.lineWidth = 0.03;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        g.beginPath();
        g.moveTo(Math.cos(a) * 0.15, Math.sin(a) * 0.15);
        g.lineTo(Math.cos(a) * 0.9, Math.sin(a) * 0.9);
        g.stroke();
      }
      g.restore();
      // the mouse, at the bottom of the wheel
      const bob = running ? Math.sin(t * 40) * 0.04 : 0;
      g.save();
      g.translate(0, 0.52 + bob);
      g.beginPath();
      g.ellipse(0, 0, 0.3, 0.19, 0, 0, TAU);
      g.fillStyle = '#b9aea4';
      g.fill();
      stroke(g, 0.04);
      g.beginPath();
      g.arc(0.24, -0.13, 0.09, 0, TAU);
      g.fillStyle = '#e7a7b4';
      g.fill();
      stroke(g, 0.03);
      g.beginPath();
      g.ellipse(0.33, 0.02, 0.12, 0.09, 0.3, 0, TAU);
      g.fillStyle = '#b9aea4';
      g.fill();
      stroke(g, 0.03);
      g.fillStyle = '#141722';
      g.beginPath();
      g.arc(0.36, -0.01, 0.025, 0, TAU);
      g.fill();
      g.beginPath();
      g.arc(0.45, 0.04, 0.025, 0, TAU);
      g.fillStyle = '#e7a7b4';
      g.fill();
      // tail + legs
      g.beginPath();
      g.moveTo(-0.29, 0.02);
      g.quadraticCurveTo(-0.5, -0.15 + (running ? Math.sin(t * 25) * 0.08 : 0), -0.62, 0.02);
      g.lineWidth = 0.025;
      g.strokeStyle = '#e7a7b4';
      g.stroke();
      if (running) {
        const k = Math.sin(t * 40) * 0.08;
        g.beginPath();
        g.moveTo(-0.1, 0.15);
        g.lineTo(-0.1 + k, 0.27);
        g.moveTo(0.15, 0.15);
        g.lineTo(0.15 - k, 0.27);
        g.lineWidth = 0.035;
        g.strokeStyle = '#8c8279';
        g.stroke();
      } else {
        g.fillStyle = '#cfe7fa';
        g.font = '700 0.22px Nunito, sans-serif';
        g.fillText('z', 0.25, -0.35 - ((t * 0.3) % 0.2));
        g.fillText('z', 0.4, -0.55 - ((t * 0.3) % 0.2));
      }
      g.restore();
    });
    hub(g, p.x, p.y, HUB_R, phase);
  },
};

const gear: PartDef = {
  type: 'gear',
  name: 'Gear',
  desc: 'Gears whose teeth touch turn each other, in opposite directions. Big gears turn slower. Belts attach to the hub.',
  category: 'Power',
  dynamic: false,
  resize: { min: 1, max: 4, def: 2, step: 0.5 },
  rotate: false,
  flip: false,
  color: '#b7c2cf',
  radius: 1,
  bounds: (p) => ({ x0: -p.length / 2 - 0.1, y0: -p.length / 2 - 0.1, x1: p.length / 2 + 0.1, y1: p.length / 2 + 0.1 }),
  gearR: (p) => p.length / 2,
  drives: () => [{ x: 0, y: 0, r: HUB_R }],
  onPower(inst, omega) {
    inst.st.omega = omega;
    inst.main.setAngularVelocity(omega);
  },
  onStep(_api, inst) {
    if (inst.st.omega) wakeTouching(inst.main);
  },
  build(world, p, inst) {
    const b = world.createBody({ type: 'kinematic', position: Vec2(p.x, p.y), angle: 0 });
    b.createFixture({ shape: new Circle(p.length / 2 - 0.02), friction: 0.8, userData: tag(inst) });
    inst.main = b;
    inst.bodies.push(b);
  },
  draw(g, inst) {
    const r = inst.part.length / 2;
    const teeth = Math.max(8, Math.round(r * 10));
    withBody(g, inst.main, () => {
      gearPath(g, r - 0.04, teeth, 0.14);
      const grad = g.createRadialGradient(-r * 0.3, -r * 0.3, 0, 0, 0, r);
      grad.addColorStop(0, '#dfe5ec');
      grad.addColorStop(1, '#8794a4');
      g.fillStyle = grad;
      g.fill();
      stroke(g, 0.05);
      g.beginPath();
      g.arc(0, 0, r * 0.62, 0, TAU);
      g.lineWidth = 0.04;
      g.strokeStyle = 'rgba(20,23,34,0.35)';
      g.stroke();
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + Math.PI / 4;
        g.beginPath();
        g.arc(Math.cos(a) * r * 0.38, Math.sin(a) * r * 0.38, r * 0.13, 0, TAU);
        g.fillStyle = '#5e6a7a';
        g.fill();
      }
    });
    hub(g, inst.part.x, inst.part.y, HUB_R, inst.main.getAngle());
  },
};

// ================================================================= contraptions

const TRAP_W = 1.0;
const mousetrap: PartDef = {
  type: 'mousetrap',
  name: 'Mousetrap',
  desc: 'Snaps when something lands on the cheese pedal: the spring arm whips over, flinging whatever sits in the cradle at its tip. Flip (F) to mirror.',
  category: 'Contraptions',
  dynamic: false,
  rotate: true,
  flip: true,
  color: '#e2b65c',
  bounds: () => ({ x0: -TRAP_W, y0: -1.1, x1: TRAP_W, y1: 0.12 }),
  build(world, p, inst) {
    const f = fx(p);
    const base = world.createBody(bodyDef(p, false));
    // the arm and base share a negative group so they never collide with each other
    base.createFixture({ shape: new Box(TRAP_W, 0.08), friction: 0.6, filterGroupIndex: -7, userData: tag(inst) });
    base.createFixture({
      shape: new Box(0.45, 0.06, Vec2(-0.5 * f, -0.14), 0),
      friction: 0.6,
      filterGroupIndex: -7,
      userData: tag(inst, 'pedal'),
    });
    const pivot = base.getWorldPoint(Vec2(0, -0.12));
    const arm = world.createBody({ type: 'dynamic', position: pivot, angle: p.angle, angularDamping: 0.5 });
    arm.createFixture({
      shape: new Box(0.47, 0.035, Vec2(0.47 * f, -0.04), 0),
      density: 3,
      friction: 0.7,
      filterGroupIndex: -7,
      userData: tag(inst),
    });
    // a little cradle at the tip so a ball can sit there ready to be flung
    for (const x of [0.6, 0.91]) {
      arm.createFixture({
        shape: new Box(0.03, 0.06, Vec2(x * f, -0.13), 0),
        density: 3,
        friction: 0.7,
        filterGroupIndex: -7,
        userData: tag(inst),
      });
    }
    const joint = world.createJoint(
      new RevoluteJoint(
        {
          enableLimit: true,
          lowerAngle: f > 0 ? -Math.PI : 0,
          upperAngle: f > 0 ? 0 : Math.PI,
          maxMotorTorque: 600,
          motorSpeed: -22 * f,
          enableMotor: false,
        },
        base,
        arm,
        pivot,
      ),
    );
    inst.main = base;
    inst.bodies.push(base, arm);
    inst.st.joint = joint;
    inst.st.arm = arm;
  },
  onContact(api, inst, role, _other, otherInst) {
    if (role !== 'pedal' || inst.st.sprung || otherInst === inst) return;
    inst.st.sprung = true;
    inst.st.joint?.enableMotor(true);
    const p = inst.main.getPosition();
    api.emit({ kind: 'snap', x: p.x, y: p.y });
  },
  draw(g, inst) {
    const f = fx(inst.part);
    withBody(g, inst.main, () => {
      g.save();
      g.scale(f, 1);
      rrect(g, -TRAP_W, -0.08, TRAP_W * 2, 0.16, 0.04);
      g.fillStyle = '#c99a55';
      g.fill();
      stroke(g, 0.05);
      // cheese pedal
      g.beginPath();
      g.moveTo(-0.95, -0.08);
      g.lineTo(-0.05, -0.08);
      g.lineTo(-0.2, -0.2);
      g.lineTo(-0.95, -0.2);
      g.closePath();
      g.fillStyle = '#ffd34d';
      g.fill();
      stroke(g, 0.035);
      g.fillStyle = '#e0a92c';
      for (const [x, y] of [
        [-0.75, -0.14],
        [-0.5, -0.15],
        [-0.3, -0.13],
      ]) {
        g.beginPath();
        g.arc(x, y, 0.03, 0, TAU);
        g.fill();
      }
      // spring coil
      g.beginPath();
      g.arc(0, -0.12, 0.09, 0, TAU);
      g.lineWidth = 0.05;
      g.strokeStyle = '#9aa6b8';
      g.stroke();
      g.restore();
    });
    const arm = inst.st.arm;
    if (arm && !inst.removed) {
      withBody(g, arm, () => {
        for (const x of [0.6, 0.91]) {
          g.beginPath();
          g.rect(x * f - 0.03, -0.19, 0.06, 0.12);
          g.fillStyle = '#d6dce4';
          g.fill();
          stroke(g, 0.03);
        }
        g.beginPath();
        g.rect(f > 0 ? 0 : -0.94, -0.075, 0.94, 0.07);
        g.fillStyle = '#d6dce4';
        g.fill();
        stroke(g, 0.035);
      });
    }
  },
};

const scissors: PartDef = {
  type: 'scissors',
  name: 'Scissors',
  desc: 'When something hits the handles they snip shut, cutting any rope passing between the blades. Rotate to aim.',
  category: 'Contraptions',
  dynamic: false,
  rotate: true,
  flip: false,
  color: '#e85d75',
  bounds: () => ({ x0: -0.85, y0: -0.4, x1: 1.1, y1: 0.4 }),
  build(world, p, inst) {
    const b = world.createBody(bodyDef(p, false));
    b.createFixture({ shape: new Box(0.32, 0.32, Vec2(-0.5, 0), 0), friction: 0.5, userData: tag(inst, 'trigger') });
    b.createFixture({ shape: new Box(0.08, 0.08), isSensor: true, userData: tag(inst) });
    inst.main = b;
    inst.bodies.push(b);
  },
  onContact(api, inst, role, _other, otherInst) {
    if (role !== 'trigger' || inst.st.closed || otherInst === inst) return;
    inst.st.closed = true;
    const tip = inst.main.getWorldPoint(Vec2(0.55, 0));
    api.cutRopesNear(tip.x, tip.y, 0.75);
    api.emit({ kind: 'cut', x: tip.x, y: tip.y });
  },
  draw(g, inst) {
    const open = inst.st.closed ? 0.03 : 0.35;
    withBody(g, inst.main, () => {
      for (const s of [-1, 1]) {
        g.save();
        g.rotate(s * open);
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(1.05, -0.02 * s);
        g.lineTo(0.95, 0.08 * s);
        g.lineTo(0.1, 0.1 * s);
        g.closePath();
        g.fillStyle = '#dfe4ec';
        g.fill();
        stroke(g, 0.035);
        g.beginPath();
        g.ellipse(-0.5, 0.18 * s, 0.26, 0.16, 0, 0, TAU);
        g.lineWidth = 0.12;
        g.strokeStyle = OUTLINE;
        g.stroke();
        g.lineWidth = 0.08;
        g.strokeStyle = '#e85d75';
        g.stroke();
        g.beginPath();
        g.moveTo(-0.25, 0.1 * s);
        g.lineTo(0.05, 0.03 * s);
        g.stroke();
        g.restore();
      }
      g.beginPath();
      g.arc(0, 0, 0.06, 0, TAU);
      g.fillStyle = OUTLINE;
      g.fill();
    });
  },
};

export const TNT_RADIUS = 6;
const tnt: PartDef = {
  type: 'tnt',
  name: 'TNT',
  desc: 'Goes off when something hits it hard, its fuse is lit, or another TNT explodes nearby. Blasts things away, pops balloons, breaks glass, cuts ropes and lights things.',
  category: 'Contraptions',
  dynamic: true,
  rotate: true,
  flip: false,
  color: '#e8463c',
  bounds: () => ({ x0: -0.4, y0: -0.65, x1: 0.4, y1: 0.4 }),
  ropeAnchors: () => [{ x: 0, y: -0.4 }],
  ignite: () => ({ x: 0.05, y: -0.62, r: 0.3 }),
  onIgnite(_api, inst) {
    // a lit fuse burns down for a moment first
    if (inst.st.fuse === undefined) inst.st.fuse = 0.8;
  },
  build(world, p, inst) {
    const b = world.createBody(bodyDef(p, true));
    b.createFixture({ shape: new Box(0.4, 0.4), density: 1.2, friction: 0.6, userData: tag(inst) });
    inst.main = b;
    inst.bodies.push(b);
  },
  onContact(_api, inst, _role, _other, _otherInst, speed) {
    if (speed > 8 && inst.st.fuse === undefined) inst.st.fuse = 0.04;
  },
  onStep(api, inst, dt) {
    if (inst.st.fuse === undefined) return;
    inst.st.fuse -= dt;
    if (inst.st.fuse <= 0 && !inst.st.done) {
      inst.st.done = true;
      const p = inst.main.getPosition();
      api.explode(p.x, p.y, TNT_RADIUS, 22, inst);
      api.remove(inst);
    }
  },
  draw(g, inst, t) {
    withBody(g, inst.main, () => {
      for (const x of [-0.26, 0, 0.26]) {
        rrect(g, x - 0.13, -0.4, 0.26, 0.8, 0.06);
        g.fillStyle = '#d93a32';
        g.fill();
        stroke(g, 0.04);
      }
      g.fillStyle = '#141722';
      g.fillRect(-0.4, -0.12, 0.8, 0.24);
      g.fillStyle = '#ffd666';
      g.font = '800 0.2px Bungee, Nunito, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('TNT', 0, 0.01);
      g.beginPath();
      g.moveTo(0, -0.4);
      g.quadraticCurveTo(0.12, -0.55, 0.05, -0.65);
      g.lineWidth = 0.035;
      g.strokeStyle = '#d8c08a';
      g.stroke();
      if (inst.st.fuse !== undefined) {
        g.beginPath();
        g.arc(0.05, -0.65, 0.08 + Math.sin(t * 60) * 0.03, 0, TAU);
        g.fillStyle = '#ffd666';
        g.fill();
      }
      pinMark(g, inst);
    });
  },
};

const GLASS_T = 0.08;
const glass: PartDef = {
  type: 'glass',
  name: 'Glass Pane',
  desc: 'Blocks things gently, but shatters if something hits it hard or TNT goes off nearby.',
  category: 'Building',
  dynamic: false,
  resize: { min: 1, max: 10, def: 3 },
  rotate: true,
  flip: false,
  color: '#bfe6ff',
  bounds: (p) => ({ x0: -p.length / 2, y0: -GLASS_T - 0.05, x1: p.length / 2, y1: GLASS_T + 0.05 }),
  build(world, p, inst) {
    const b = world.createBody(bodyDef(p, false));
    b.createFixture({ shape: new Box(p.length / 2, GLASS_T), friction: 0.2, restitution: 0.2, userData: tag(inst, 'glass') });
    inst.main = b;
    inst.bodies.push(b);
  },
  onContact(api, inst, _role, _other, _otherInst, speed) {
    if (speed > 7 && !inst.st.broken) shatter(api, inst);
  },
  draw(g, inst) {
    const L = inst.part.length;
    withBody(g, inst.main, () => {
      g.beginPath();
      g.rect(-L / 2, -GLASS_T, L, GLASS_T * 2);
      g.fillStyle = 'rgba(190,230,255,0.45)';
      g.fill();
      g.lineWidth = 0.03;
      g.strokeStyle = 'rgba(220,240,255,0.9)';
      g.stroke();
      g.beginPath();
      for (let x = -L / 2 + 0.3; x < L / 2; x += 1.1) {
        g.moveTo(x, -GLASS_T * 0.4);
        g.lineTo(x + 0.35, -GLASS_T * 0.4);
      }
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.stroke();
    });
  },
};

export function shatter(api: SimApi, inst: Inst) {
  if (inst.st.broken) return;
  inst.st.broken = true;
  const p = inst.main.getPosition();
  api.emit({ kind: 'shatter', x: p.x, y: p.y, angle: inst.main.getAngle(), length: inst.part.length });
  api.remove(inst);
}

const bell: PartDef = {
  type: 'bell',
  name: 'Bell',
  desc: 'Rings when anything hits it. Some puzzles want it rung.',
  category: 'Contraptions',
  dynamic: false,
  rotate: true,
  flip: false,
  color: '#f2c14e',
  bounds: () => ({ x0: -0.55, y0: -0.75, x1: 0.55, y1: 0.6 }),
  build(world, p, inst) {
    const b = world.createBody(bodyDef(p, false));
    b.createFixture({
      shape: new Polygon([Vec2(-0.2, -0.45), Vec2(0.2, -0.45), Vec2(0.5, 0.4), Vec2(-0.5, 0.4)]),
      friction: 0.4,
      restitution: 0.4,
      userData: tag(inst, 'trigger'),
    });
    b.createFixture({ shape: new Box(0.06, 0.15, Vec2(0, -0.6), 0), userData: tag(inst) });
    inst.main = b;
    inst.bodies.push(b);
  },
  onContact(api, inst, _role, _other, otherInst, speed) {
    if (otherInst === inst || speed < 0.8) return;
    if (api.time - ((inst.st.lastRing as number) ?? -1) < 0.25) return;
    inst.st.lastRing = api.time;
    inst.st.rings = ((inst.st.rings as number) ?? 0) + 1;
    inst.st.swing = Math.min(1, speed / 8);
    const p = inst.main.getPosition();
    api.emit({ kind: 'ring', x: p.x, y: p.y });
    for (const o of api.insts.values()) {
      if (o.part.type === 'cat' && !o.removed && Vec2.distance(o.main.getPosition(), p) < 12) wakeCat(api, o);
    }
  },
  onStep(_api, inst, dt) {
    if (inst.st.swing) inst.st.swing = Math.max(0, inst.st.swing - dt * 0.8);
  },
  draw(g, inst, t) {
    const swing = (inst.st.swing as number) ?? 0;
    withBody(g, inst.main, () => {
      g.fillStyle = '#59606e';
      g.fillRect(-0.06, -0.75, 0.12, 0.32);
      g.save();
      g.rotate(Math.sin(t * 18) * swing * 0.25);
      g.beginPath();
      g.moveTo(-0.2, -0.45);
      g.quadraticCurveTo(-0.3, 0.1, -0.52, 0.4);
      g.lineTo(0.52, 0.4);
      g.quadraticCurveTo(0.3, 0.1, 0.2, -0.45);
      g.quadraticCurveTo(0, -0.55, -0.2, -0.45);
      g.closePath();
      const grad = g.createLinearGradient(-0.5, 0, 0.5, 0);
      grad.addColorStop(0, '#b8862a');
      grad.addColorStop(0.35, '#ffe08a');
      grad.addColorStop(1, '#b8862a');
      g.fillStyle = grad;
      g.fill();
      stroke(g, 0.05);
      g.beginPath();
      g.arc(Math.sin(t * 22) * swing * 0.25, 0.48, 0.1, 0, TAU);
      g.fillStyle = '#8a6420';
      g.fill();
      stroke(g, 0.035);
      g.restore();
    });
  },
};

export const BUMPER_KICK = 12;
const bumper: PartDef = {
  type: 'bumper',
  name: 'Bumper',
  desc: 'A pinball bumper: kicks anything that touches it straight back out, hard.',
  category: 'Contraptions',
  dynamic: false,
  rotate: false,
  flip: false,
  color: '#ff7ab6',
  radius: 0.55,
  bounds: () => ({ x0: -0.55, y0: -0.55, x1: 0.55, y1: 0.55 }),
  build(world, p, inst) {
    const b = world.createBody(bodyDef(p, false));
    b.createFixture({ shape: new Circle(0.5), friction: 0.2, restitution: 0.8, userData: tag(inst, 'bumper') });
    inst.main = b;
    inst.bodies.push(b);
  },
  onContact(api, inst) {
    inst.st.flash = 0.15;
    void api;
  },
  onStep(_api, inst, dt) {
    if (inst.st.flash) inst.st.flash = Math.max(0, inst.st.flash - dt);
  },
  draw(g, inst) {
    const lit = (inst.st.flash as number) > 0;
    withBody(g, inst.main, () => {
      g.beginPath();
      g.arc(0, 0, 0.5, 0, TAU);
      g.fillStyle = lit ? '#ffe0f0' : '#ff7ab6';
      g.fill();
      stroke(g);
      g.beginPath();
      g.arc(0, 0, 0.33, 0, TAU);
      g.fillStyle = lit ? '#ffffff' : '#ffd1e6';
      g.fill();
      stroke(g, 0.04);
      g.beginPath();
      g.arc(0, 0, 0.14, 0, TAU);
      g.fillStyle = '#c23a7e';
      g.fill();
    });
  },
};

export const MAGNET_RANGE = 8;
const magnet: PartDef = {
  type: 'magnet',
  name: 'Magnet',
  desc: 'Pulls metal things (buckets, anvils, steel balls) towards it from up to 8 squares away.',
  category: 'Contraptions',
  dynamic: false,
  rotate: true,
  flip: false,
  color: '#e8463c',
  bounds: () => ({ x0: -0.55, y0: -0.6, x1: 0.55, y1: 0.6 }),
  build(world, p, inst) {
    const b = world.createBody(bodyDef(p, false));
    b.createFixture({ shape: new Box(0.5, 0.18, Vec2(0, -0.4), 0), friction: 0.6, userData: tag(inst) });
    b.createFixture({ shape: new Box(0.17, 0.4, Vec2(-0.33, 0.18), 0), friction: 0.6, userData: tag(inst) });
    b.createFixture({ shape: new Box(0.17, 0.4, Vec2(0.33, 0.18), 0), friction: 0.6, userData: tag(inst) });
    inst.main = b;
    inst.bodies.push(b);
  },
  onStep(api, inst) {
    const c = inst.main.getWorldPoint(Vec2(0, 0.45));
    for (const other of api.insts.values()) {
      if (other.removed || !METAL.has(other.part.type)) continue;
      const b = other.main;
      if (!b.isDynamic()) continue;
      const d = Vec2.sub(c, b.getWorldCenter());
      const dist = d.length();
      if (dist > MAGNET_RANGE || dist < 0.3) continue;
      const k = 1 - dist / MAGNET_RANGE;
      d.normalize();
      b.applyForceToCenter(Vec2.mul(d, 60 * k * b.getMass()), true);
      b.setAwake(true);
    }
  },
  draw(g, inst, t) {
    withBody(g, inst.main, () => {
      g.beginPath();
      g.moveTo(-0.5, 0.58);
      g.lineTo(-0.5, -0.2);
      g.arc(0, -0.2, 0.5, Math.PI, 0);
      g.lineTo(0.5, 0.58);
      g.lineTo(0.16, 0.58);
      g.lineTo(0.16, -0.2);
      g.arc(0, -0.2, 0.16, 0, Math.PI, true);
      g.lineTo(-0.16, 0.58);
      g.closePath();
      g.fillStyle = '#e8463c';
      g.fill();
      stroke(g);
      g.fillStyle = '#dfe4ec';
      g.fillRect(-0.48, 0.32, 0.31, 0.25);
      g.fillRect(0.17, 0.32, 0.31, 0.25);
      g.strokeStyle = 'rgba(255,214,102,0.5)';
      g.lineWidth = 0.03;
      const k = (t * 0.8) % 1;
      for (const s of [0, 0.5]) {
        const r = 0.2 + ((k + s) % 1) * 0.6;
        g.globalAlpha = 1 - ((k + s) % 1);
        g.beginPath();
        g.arc(0, 0.45, r, 0.2, Math.PI - 0.2);
        g.stroke();
      }
      g.globalAlpha = 1;
    });
  },
};
// ================================================================= building

const funnel: PartDef = {
  type: 'funnel',
  name: 'Funnel',
  desc: 'Catches things across its wide mouth and drops them out of the narrow bottom.',
  category: 'Building',
  dynamic: false,
  rotate: true,
  flip: false,
  color: '#9fb7c9',
  bounds: () => ({ x0: -1.6, y0: -0.8, x1: 1.6, y1: 0.8 }),
  build(world, p, inst) {
    const b = world.createBody(bodyDef(p, false));
    for (const s of [-1, 1]) {
      b.createFixture({
        shape: new Polygon([Vec2(s * 1.5, -0.75), Vec2(s * 1.65, -0.75), Vec2(s * 0.75, 0.75), Vec2(s * 0.6, 0.75)]),
        friction: 0.3,
        userData: tag(inst),
      });
    }
    inst.main = b;
    inst.bodies.push(b);
  },
  draw(g, inst) {
    withBody(g, inst.main, () => {
      g.beginPath();
      g.moveTo(-1.6, -0.75);
      g.lineTo(-0.67, 0.75);
      g.lineTo(0.67, 0.75);
      g.lineTo(1.6, -0.75);
      g.fillStyle = 'rgba(159,183,201,0.18)';
      g.fill();
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(s * 1.5, -0.75);
        g.lineTo(s * 1.65, -0.75);
        g.lineTo(s * 0.75, 0.75);
        g.lineTo(s * 0.6, 0.75);
        g.closePath();
        g.fillStyle = '#9fb7c9';
        g.fill();
        stroke(g, 0.05);
      }
    });
  },
};

function arcPoints(R: number, flip: number, n = 14) {
  // quarter circle from the top-left corner sweeping down to the bottom-right (mirrored when flipped)
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const a = Math.PI - (i / n) * (Math.PI / 2);
    pts.push({ x: flip * (R / 2 + Math.cos(a) * R), y: -R / 2 + Math.sin(a) * R });
  }
  return pts;
}

const curve: PartDef = {
  type: 'curve',
  name: 'Curved Ramp',
  desc: 'A quarter-pipe: drop things in at the top and they come out sideways. Flip (F) to mirror.',
  category: 'Building',
  dynamic: false,
  resize: { min: 2, max: 10, def: 4 },
  rotate: true,
  flip: true,
  color: '#8fb3cc',
  bounds: (p) => ({ x0: -p.length / 2 - 0.15, y0: -p.length / 2, x1: p.length / 2, y1: p.length / 2 + 0.15 }),
  build(world, p, inst) {
    const b = world.createBody(bodyDef(p, false));
    const pts = arcPoints(p.length, fx(p)).map((q) => Vec2(q.x, q.y));
    b.createFixture({ shape: new Chain(pts, false), friction: 0.3, userData: tag(inst) });
    inst.main = b;
    inst.bodies.push(b);
  },
  draw(g, inst) {
    const pts = arcPoints(inst.part.length, fx(inst.part), 24);
    withBody(g, inst.main, () => {
      g.beginPath();
      pts.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)));
      g.lineCap = 'round';
      g.lineWidth = 0.3;
      g.strokeStyle = OUTLINE;
      g.stroke();
      g.lineWidth = 0.18;
      g.strokeStyle = '#8fb3cc';
      g.stroke();
      g.lineWidth = 0.04;
      g.strokeStyle = '#d7e6f0';
      g.stroke();
      g.lineCap = 'butt';
    });
  },
};

const wedge: PartDef = {
  type: 'wedge',
  name: 'Wedge',
  desc: 'A solid wooden incline. Resize it for a gentler or longer slope; flip (F) to face the other way.',
  category: 'Building',
  dynamic: false,
  resize: { min: 1, max: 8, def: 3 },
  rotate: true,
  flip: true,
  color: '#d9a057',
  bounds: (p) => ({ x0: -p.length / 2, y0: -p.length / 4, x1: p.length / 2, y1: p.length / 4 }),
  build(world, p, inst) {
    const b = world.createBody(bodyDef(p, false));
    const L = p.length;
    const f = fx(p);
    b.createFixture({
      shape: new Polygon([Vec2(-L / 2 * f, L / 4), Vec2((L / 2) * f, L / 4), Vec2((L / 2) * f, -L / 4)]),
      friction: 0.5,
      userData: tag(inst),
    });
    inst.main = b;
    inst.bodies.push(b);
  },
  draw(g, inst) {
    const L = inst.part.length;
    withBody(g, inst.main, () => {
      g.scale(fx(inst.part), 1);
      g.beginPath();
      g.moveTo(-L / 2, L / 4);
      g.lineTo(L / 2, L / 4);
      g.lineTo(L / 2, -L / 4);
      g.closePath();
      g.fillStyle = '#c98b42';
      g.fill();
      g.save();
      g.clip();
      g.strokeStyle = 'rgba(138,90,38,0.6)';
      g.lineWidth = 0.04;
      for (let y = -L / 4 + 0.25; y < L / 4; y += 0.35) {
        g.beginPath();
        g.moveTo(-L / 2, y);
        g.lineTo(L / 2, y);
        g.stroke();
      }
      g.restore();
      g.beginPath();
      g.moveTo(-L / 2, L / 4);
      g.lineTo(L / 2, L / 4);
      g.lineTo(L / 2, -L / 4);
      g.closePath();
      stroke(g);
    });
  },
};

const plank: PartDef = {
  type: 'plank',
  name: 'Plank',
  desc: 'A loose wooden board. It falls, slides and tips; tie ropes to either end.',
  category: 'Building',
  dynamic: true,
  resize: { min: 1.5, max: 10, def: 4 },
  rotate: true,
  flip: false,
  color: '#e0aa62',
  bounds: (p) => ({ x0: -p.length / 2, y0: -0.12, x1: p.length / 2, y1: 0.12 }),
  ropeAnchors: (p) => [
    { x: -p.length / 2 + 0.12, y: 0 },
    { x: p.length / 2 - 0.12, y: 0 },
  ],
  build(world, p, inst) {
    const b = world.createBody(bodyDef(p, true));
    b.createFixture({ shape: new Box(p.length / 2, 0.11), density: 0.7, friction: 0.6, userData: tag(inst) });
    inst.main = b;
    inst.bodies.push(b);
  },
  draw(g, inst) {
    const L = inst.part.length;
    withBody(g, inst.main, () => {
      rrect(g, -L / 2, -0.11, L, 0.22, 0.05);
      g.fillStyle = '#e0aa62';
      g.fill();
      stroke(g, 0.05);
      g.beginPath();
      for (let x = -L / 2 + 0.4; x < L / 2 - 0.3; x += 1.1) {
        g.moveTo(x, -0.03);
        g.lineTo(x + 0.5, -0.03);
      }
      g.lineWidth = 0.025;
      g.strokeStyle = '#a8763c';
      g.stroke();
      pinMark(g, inst);
    });
  },
};

const anvil: PartDef = {
  type: 'anvil',
  name: 'Anvil',
  desc: 'Extremely heavy. Great for see-saws, counterweights and squashing things. Magnets love it.',
  category: 'Building',
  dynamic: true,
  rotate: true,
  flip: true,
  metal: true,
  color: '#7e8794',
  bounds: () => ({ x0: -0.75, y0: -0.4, x1: 0.75, y1: 0.4 }),
  ropeAnchors: () => [{ x: 0, y: -0.38 }],
  build(world, p, inst) {
    const b = world.createBody(bodyDef(p, true));
    const opts = { density: 6, friction: 0.6, restitution: 0, userData: tag(inst) };
    b.createFixture({ shape: new Box(0.7, 0.13, Vec2(0, -0.25), 0), ...opts });
    b.createFixture({ shape: new Box(0.22, 0.14, Vec2(0, 0.02), 0), ...opts });
    b.createFixture({ shape: new Box(0.42, 0.12, Vec2(0, 0.27), 0), ...opts });
    inst.main = b;
    inst.bodies.push(b);
  },
  draw(g, inst) {
    withBody(g, inst.main, () => {
      g.scale(fx(inst.part), 1);
      g.beginPath();
      g.moveTo(-0.75, -0.38);
      g.lineTo(0.48, -0.38);
      g.lineTo(0.7, -0.24);
      g.lineTo(0.5, -0.12);
      g.lineTo(0.22, -0.12);
      g.lineTo(0.22, 0.15);
      g.lineTo(0.42, 0.15);
      g.lineTo(0.42, 0.39);
      g.lineTo(-0.42, 0.39);
      g.lineTo(-0.42, 0.15);
      g.lineTo(-0.22, 0.15);
      g.lineTo(-0.22, -0.12);
      g.lineTo(-0.55, -0.12);
      g.closePath();
      const grad = g.createLinearGradient(0, -0.4, 0, 0.4);
      grad.addColorStop(0, '#a9b2be');
      grad.addColorStop(1, '#4b535f');
      g.fillStyle = grad;
      g.fill();
      stroke(g);
      pinMark(g, inst);
    });
  },
};

// ================================================================= balls

const superball = ball(
  'superball',
  'Super Ball',
  'A tiny rubber ball that barely loses any bounce.',
  0.2,
  { density: 1.5, restitution: 0.95, friction: 0.8 },
  '#7ef08a',
  (g, r) => {
    shadedBall(g, r, '#22b34a', '#b7ffb0');
    g.beginPath();
    g.arc(0, 0, r * 0.55, 0.3, 2.6);
    g.lineWidth = 0.035;
    g.strokeStyle = '#f2ff7a';
    g.stroke();
  },
);

const beachball = ball(
  'beachball',
  'Beach Ball',
  'Big and nearly weightless: floaty when it falls and blown about by fans.',
  0.8,
  { density: 0.05, restitution: 0.7, friction: 0.5 },
  '#ff9e5e',
  (g, r) => {
    const cols = ['#ff5d5d', '#ffffff', '#ffd34d', '#ffffff', '#4fa3ff', '#ffffff'];
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, r, (i / 6) * TAU, ((i + 1) / 6) * TAU);
      g.closePath();
      g.fillStyle = cols[i];
      g.fill();
    }
    g.beginPath();
    g.arc(0, 0, r, 0, TAU);
    stroke(g);
    g.beginPath();
    g.arc(0, 0, r * 0.15, 0, TAU);
    g.fillStyle = '#ffffff';
    g.fill();
    stroke(g, 0.03);
  },
  { linearDamping: 0.35 },
);

const steelball = ball(
  'steelball',
  'Steel Ball',
  'A heavy ball bearing. Magnets pull it.',
  0.3,
  { density: 5, restitution: 0.3, friction: 0.3 },
  '#c4ccd6',
  (g, r) => shadedBall(g, r, '#5c6673', '#ffffff'),
);

export const MORE_PARTS = {
  superball,
  steelball,
  beachball,
  plank,
  anvil,
  tnt,
  wedge,
  curve,
  funnel,
  glass,
  bumper,
  bell,
  mousetrap,
  scissors,
  magnet,
  motor,
  mouse,
  gear,
} satisfies Partial<Record<PartType, PartDef>>;

/** types magnets pull */
export const METAL = new Set<PartType>(['bucket', 'anvil', 'steelball']);
