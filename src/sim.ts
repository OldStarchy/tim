import { Body, Contact, Joint, PulleyJoint, RopeJoint, Vec2, World } from 'planck';
import type { Goal, Part, Rope, Scene } from './model';
import { BOARD_H, BOARD_W } from './model';
import {
  BALLOON_LIFT,
  CONVEYOR_SPEED,
  FAN_HALF_H,
  FAN_RANGE,
  FAN_STRENGTH,
  FixtureTag,
  Inst,
  PART_DEFS,
  PULLEY_R,
  TRAMP_GAIN,
  TRAMP_MAX_BOUNCE,
  TRAMP_MIN_BOUNCE,
  inBucket,
} from './parts';

export const GRAVITY = 25;
export const DT = 1 / 120;

export type SimEvent =
  | { kind: 'pop'; x: number; y: number }
  | { kind: 'impact'; x: number; y: number; speed: number; material: string }
  | { kind: 'boing'; x: number; y: number };

export interface RopeInst {
  rope: Rope;
  a: Inst;
  b: Inst;
  via?: Inst;
  joint: Joint | null;
  length: number;
}

function tagOf(f: { getUserData(): unknown }): FixtureTag | undefined {
  return f.getUserData() as FixtureTag | undefined;
}

export function ropeAnchorWorld(inst: Inst) {
  const def = PART_DEFS[inst.part.type];
  const a = def.ropeAnchor ? def.ropeAnchor(inst.part) : { x: 0, y: 0 };
  return inst.main.getWorldPoint(Vec2(a.x, a.y));
}

/** For a rope over a pulley, which side does each end hang from? */
export function pulleySides(pulleyX: number, ax: number, bx: number): [number, number] {
  // the end further left uses the left side; ties default a=left
  return ax <= bx ? [pulleyX - PULLEY_R, pulleyX + PULLEY_R] : [pulleyX + PULLEY_R, pulleyX - PULLEY_R];
}

export class Sim {
  world: World;
  insts = new Map<string, Inst>();
  ropes: RopeInst[] = [];
  time = 0;
  steps = 0;
  events: SimEvent[] = [];
  popped = new Set<string>();
  private trampHits: { body: Body; inst: Inst; vin: number }[] = [];
  private toPop = new Set<Inst>();
  private impactCooldown = new WeakMap<Body, number>();

  constructor(scene: Scene) {
    this.world = new World({ gravity: Vec2(0, GRAVITY) });
    for (const p of scene.parts) this.addPart(p);
    for (const r of scene.ropes) this.addRope(r);

    this.world.on('pre-solve', (c: Contact) => this.preSolve(c));
    this.world.on('begin-contact', (c: Contact) => this.beginContact(c));
  }

  private addPart(p: Part) {
    const def = PART_DEFS[p.type];
    if (!def) return;
    const inst = { part: p, main: null as unknown as Body, bodies: [], removed: false } as Inst;
    def.build(this.world, p, inst);
    this.insts.set(p.id, inst);
  }

  private addRope(r: Rope) {
    const a = this.insts.get(r.a);
    const b = this.insts.get(r.b);
    if (!a || !b || a === b) return;
    const via = r.via ? this.insts.get(r.via) : undefined;
    const pa = ropeAnchorWorld(a);
    const pb = ropeAnchorWorld(b);
    const la = PART_DEFS[a.part.type].ropeAnchor?.(a.part) ?? { x: 0, y: 0 };
    const lb = PART_DEFS[b.part.type].ropeAnchor?.(b.part) ?? { x: 0, y: 0 };
    let joint: Joint | null = null;
    let length: number;
    const bothStatic = a.main.isStatic() && b.main.isStatic();
    if (via) {
      const pp = via.main.getPosition();
      const [gax, gbx] = pulleySides(pp.x, pa.x, pb.x);
      const ga = Vec2(gax, pp.y);
      const gb = Vec2(gbx, pp.y);
      const lenA = Vec2.distance(pa, ga);
      const lenB = Vec2.distance(pb, gb);
      length = lenA + lenB;
      if (!bothStatic) {
        joint = this.world.createJoint(
          new PulleyJoint({
            bodyA: a.main,
            bodyB: b.main,
            groundAnchorA: ga,
            groundAnchorB: gb,
            localAnchorA: Vec2(la.x, la.y),
            localAnchorB: Vec2(lb.x, lb.y),
            lengthA: lenA,
            lengthB: lenB,
            ratio: 1,
            collideConnected: true,
          }),
        );
      }
    } else {
      length = Vec2.distance(pa, pb);
      if (!bothStatic) {
        joint = this.world.createJoint(
          new RopeJoint({
            bodyA: a.main,
            bodyB: b.main,
            localAnchorA: Vec2(la.x, la.y),
            localAnchorB: Vec2(lb.x, lb.y),
            maxLength: Math.max(0.05, length),
            collideConnected: true,
          }),
        );
      }
    }
    this.ropes.push({ rope: r, a, b, via, joint, length });
  }

  private preSolve(c: Contact) {
    const ta = tagOf(c.getFixtureA());
    const tb = tagOf(c.getFixtureB());
    // buckets are padded: things that land inside stay inside
    if (ta?.inst.part.type === 'bucket' || tb?.inst.part.type === 'bucket') c.setRestitution(0.05);
    if (ta?.role === 'conveyor') {
      c.setTangentSpeed(ta.inst.part.flip ? CONVEYOR_SPEED : -CONVEYOR_SPEED);
    } else if (tb?.role === 'conveyor') {
      c.setTangentSpeed(tb.inst.part.flip ? -CONVEYOR_SPEED : CONVEYOR_SPEED);
    }
  }

  private beginContact(c: Contact) {
    const fa = c.getFixtureA();
    const fb = c.getFixtureB();
    const ta = tagOf(fa);
    const tb = tagOf(fb);
    if (!ta || !tb) return;
    if (fa.isSensor() || fb.isSensor()) return;
    if (ta.role === 'balloon' && tb.role === 'sharp') this.toPop.add(ta.inst);
    if (tb.role === 'balloon' && ta.role === 'sharp') this.toPop.add(tb.inst);
    if (ta.role === 'tramp' && fb.getBody().isDynamic()) this.trampHit(fb.getBody(), ta.inst);
    if (tb.role === 'tramp' && fa.getBody().isDynamic()) this.trampHit(fa.getBody(), tb.inst);

    // sound-worthy impacts
    const ba = fa.getBody();
    const bb = fb.getBody();
    const rel = Vec2.sub(ba.getLinearVelocity(), bb.getLinearVelocity()).length();
    if (rel > 3) {
      const loud = ba.isDynamic() ? ba : bb;
      const last = this.impactCooldown.get(loud) ?? -1;
      if (this.time - last > 0.08) {
        this.impactCooldown.set(loud, this.time);
        const p = loud.getPosition();
        const mover = ba.isDynamic() ? ta : tb;
        this.events.push({ kind: 'impact', x: p.x, y: p.y, speed: rel, material: mover.inst.part.type });
      }
    }
  }

  /** called before the solver runs, so this is the approach speed into the mat */
  private trampHit(body: Body, inst: Inst) {
    const n = inst.main.getWorldVector(Vec2(0, -1));
    const vin = -Vec2.dot(body.getLinearVelocity(), n);
    if (vin > 0.5) this.trampHits.push({ body, inst, vin });
  }

  step() {
    // forces: balloon lift and fans
    for (const inst of this.insts.values()) {
      if (inst.removed) continue;
      if (inst.part.type === 'balloon' && inst.main.isDynamic()) {
        inst.main.applyForceToCenter(Vec2(0, -BALLOON_LIFT), true);
      }
    }
    for (const inst of this.insts.values()) {
      if (inst.part.type === 'fan') this.applyFan(inst);
    }

    this.world.step(DT, 8, 3);
    this.time += DT;
    this.steps++;

    // trampoline: throw things back harder than they arrived (capped so nothing runs away)
    for (const { body, inst, vin } of this.trampHits) {
      const n = inst.main.getWorldVector(Vec2(0, -1));
      const v = body.getLinearVelocity();
      const vout = Math.min(TRAMP_MAX_BOUNCE, Math.max(TRAMP_MIN_BOUNCE, vin * TRAMP_GAIN));
      body.setLinearVelocity(Vec2.add(v, Vec2.mul(n, vout - Vec2.dot(v, n))));
      const p = body.getPosition();
      this.events.push({ kind: 'boing', x: p.x, y: p.y });
    }
    this.trampHits.length = 0;

    for (const inst of this.toPop) this.pop(inst);
    this.toPop.clear();

    // cull things that left the board
    for (const inst of this.insts.values()) {
      if (inst.removed || !inst.main.isDynamic()) continue;
      const p = inst.main.getPosition();
      if (p.y > BOARD_H + 8 || p.y < -10 || p.x < -10 || p.x > BOARD_W + 10) {
        if (inst.part.type === 'seesaw') continue;
        this.remove(inst);
      }
    }
  }

  private applyFan(fanInst: Inst) {
    const dir = fanInst.part.flip ? -1 : 1;
    const fb = fanInst.main;
    const ax = fb.getWorldVector(Vec2(dir, 0));
    const origin = fb.getWorldPoint(Vec2(0.5 * dir, 0));
    for (const inst of this.insts.values()) {
      if (inst.removed) continue;
      for (const b of inst.bodies) {
        if (!b.isDynamic()) continue;
        const rel = Vec2.sub(b.getWorldCenter(), origin);
        const along = Vec2.dot(rel, ax);
        if (along < 0 || along > FAN_RANGE) continue;
        const across = Math.abs(Vec2.cross(ax, rel));
        const spread = 0.5 + (FAN_HALF_H - 0.5) * (along / FAN_RANGE);
        if (across > spread + 0.3) continue;
        if (this.fanBlocked(origin, b.getWorldCenter(), b, fb)) continue;
        // air pushes by cross-section, not mass
        const size = this.crossSection(b);
        const falloff = 1 - along / FAN_RANGE;
        b.applyForceToCenter(Vec2.mul(ax, FAN_STRENGTH * size * (0.35 + 0.65 * falloff)), true);
      }
    }
  }

  private fanBlocked(from: Vec2, to: Vec2, target: Body, fanBody: Body): boolean {
    let blocked = false;
    this.world.rayCast(from, to, (f, _pt, _n, fraction) => {
      const b = f.getBody();
      if (b === target || b === fanBody || f.isSensor()) return -1;
      if (b.isStatic()) {
        blocked = true;
        return 0;
      }
      return fraction;
    });
    return blocked;
  }

  private crossSection(b: Body): number {
    let s = 0;
    for (let f = b.getFixtureList(); f; f = f.getNext()) {
      const aabb = f.getAABB(0);
      s = Math.max(s, aabb.upperBound.y - aabb.lowerBound.y, aabb.upperBound.x - aabb.lowerBound.x);
    }
    return Math.min(s, 2);
  }

  private pop(inst: Inst) {
    if (inst.removed) return;
    const p = inst.main.getPosition();
    this.events.push({ kind: 'pop', x: p.x, y: p.y });
    this.popped.add(inst.part.id);
    this.remove(inst);
  }

  private remove(inst: Inst) {
    inst.removed = true;
    for (const r of this.ropes) {
      if (r.a === inst || r.b === inst) {
        if (r.joint) this.world.destroyJoint(r.joint);
        r.joint = null;
      }
    }
    for (const b of inst.bodies) this.world.destroyBody(b);
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ---------- goals ----------

  goalMet(g: Goal): boolean {
    switch (g.kind) {
      case 'popped':
        return this.popped.has(g.target);
      case 'inBucket': {
        const t = this.insts.get(g.target);
        const b = this.insts.get(g.bucket);
        if (!t || !b || t.removed || b.removed) return false;
        const p = t.main.getPosition();
        return inBucket(b.main, p.x, p.y);
      }
      case 'inZone': {
        const t = this.insts.get(g.target);
        if (!t || t.removed) return false;
        const p = t.main.getPosition();
        const z = g.zone;
        return p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h;
      }
      case 'toppled':
        return g.targets.every((id) => {
          const t = this.insts.get(id);
          if (!t) return false;
          if (t.removed) return true;
          return Math.abs(Math.sin(t.main.getAngle())) > 0.7;
        });
    }
  }
}

/** Ids of non-locked parts that sink into something else (the editor refuses to run with these). Call on a fresh Sim. */
export function findOverlaps(sim: Sim): Set<string> {
  const bad = new Set<string>();
  const w = sim.world;
  w.step(0);
  for (let c = w.getContactList(); c; c = c.getNext()) {
    if (!c.isTouching()) continue;
    const fa = c.getFixtureA();
    const fb = c.getFixtureB();
    if (fa.isSensor() || fb.isSensor()) continue;
    const ia = tagOf(fa)?.inst.part;
    const ib = tagOf(fb)?.inst.part;
    if (!ia || !ib || ia === ib) continue;
    if (ia.locked && ib.locked) continue;
    const wm = c.getWorldManifold(null);
    const worst = Math.min(0, ...(wm?.separations ?? [0]));
    if (worst < -0.08) {
      if (!ia.locked) bad.add(ia.id);
      if (!ib.locked) bad.add(ib.id);
    }
  }
  for (const inst of sim.insts.values()) {
    const p = inst.part;
    if (!p.locked && (p.x < 0 || p.x > BOARD_W || p.y < 0 || p.y > BOARD_H)) bad.add(p.id);
  }
  return bad;
}

/** Runs a scene until goals are held (true) or timeout (false). Used by tests and the hint/preview system. */
export function solveCheck(scene: Scene, goals: Goal[], seconds = 30, hold = 0.25): { won: boolean; time: number } {
  const sim = new Sim(scene);
  let held = 0;
  const maxSteps = Math.round(seconds / DT);
  for (let i = 0; i < maxSteps; i++) {
    sim.step();
    sim.drainEvents();
    if (goals.every((g) => sim.goalMet(g))) {
      held += DT;
      if (held >= hold) return { won: true, time: sim.time };
    } else held = 0;
  }
  return { won: false, time: sim.time };
}
