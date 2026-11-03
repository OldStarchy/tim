import { Body, Contact, Joint, PulleyJoint, RopeJoint, Vec2, World } from 'planck';
import type { Belt, Goal, Part, Rope, Scene } from './model';
import { BOARD_H, BOARD_W } from './model';
import {
  BALLOON_LIFT,
  FAN_HALF_H,
  FAN_RANGE,
  FAN_STRENGTH,
  type Inst,
  PART_DEFS,
  PULLEY_R,
  type SimApi,
  type SimEvent,
  TRAMP_GAIN,
  TRAMP_MAX_BOUNCE,
  TRAMP_MIN_BOUNCE,
  inBucket,
} from './parts';
import { BUMPER_KICK, shatter } from './parts-more';
import { tagOf } from './partkit';

export type { SimEvent } from './parts';

export const GRAVITY = 25;
export const DT = 1 / 120;

export interface RopeInst {
  rope: Rope;
  a: Inst;
  b: Inst;
  via?: Inst;
  joint: Joint | null;
  length: number;
  cut: boolean;
  /** seconds spent in a flame */
  burn?: number;
}

export interface BeltInst {
  belt: Belt;
  a: Inst;
  b: Inst;
}

function anchorsOf(p: Part) {
  return PART_DEFS[p.type].ropeAnchors?.(p) ?? [{ x: 0, y: 0 }];
}

export function ropeAnchorLocal(p: Part, end = 0) {
  const list = anchorsOf(p);
  return list[Math.min(end, list.length - 1)];
}

export function ropeAnchorWorld(inst: Inst, end = 0) {
  const a = ropeAnchorLocal(inst.part, end);
  return inst.main.getWorldPoint(Vec2(a.x, a.y));
}

/** world position + radius of one of a powered part's belt hubs */
export function driveWorld(p: Part, end = 0) {
  const list = PART_DEFS[p.type].drives?.(p) ?? [{ x: 0, y: 0, r: 0.3 }];
  const d = list[Math.min(end, list.length - 1)];
  const c = Math.cos(p.angle);
  const s = Math.sin(p.angle);
  return { x: p.x + d.x * c - d.y * s, y: p.y + d.x * s + d.y * c, r: d.r };
}

/** do two gears' teeth touch? */
export function gearsMesh(a: Part, b: Part): boolean {
  const ra = PART_DEFS[a.type].gearR?.(a);
  const rb = PART_DEFS[b.type].gearR?.(b);
  if (!ra || !rb) return false;
  return Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - (ra + rb)) < 0.35;
}

/** For a rope over a pulley, which side does each end hang from? */
export function pulleySides(pulleyX: number, ax: number, bx: number): [number, number] {
  // the end further left uses the left side; ties default a=left
  return ax <= bx ? [pulleyX - PULLEY_R, pulleyX + PULLEY_R] : [pulleyX + PULLEY_R, pulleyX - PULLEY_R];
}

/** the straight pieces a rope is made of right now (for cutting / hit testing) */
export function ropeSegments(r: RopeInst): [Vec2, Vec2][] {
  const pa = ropeAnchorWorld(r.a, r.rope.aEnd);
  const pb = ropeAnchorWorld(r.b, r.rope.bEnd);
  if (!r.via || r.via.removed) return [[pa, pb]];
  const v = r.via.main.getPosition();
  const ax = ropeAnchorWorldX(r.a.part, r.rope.aEnd);
  const bx = ropeAnchorWorldX(r.b.part, r.rope.bEnd);
  const [ga, gb] = pulleySides(v.x, ax, bx);
  return [
    [pa, Vec2(ga, v.y)],
    [Vec2(ga, v.y - PULLEY_R), Vec2(gb, v.y - PULLEY_R)],
    [Vec2(gb, v.y), pb],
  ];
}

/** x of a rope anchor at its placed pose (keeps pulley sides stable while things swing) */
export function ropeAnchorWorldX(p: Part, end = 0) {
  const l = ropeAnchorLocal(p, end);
  return p.x + l.x * Math.cos(p.angle) - l.y * Math.sin(p.angle);
}

function segDist(p: Vec2, a: Vec2, b: Vec2) {
  const d = Vec2.sub(b, a);
  const l2 = Vec2.dot(d, d) || 1;
  const t = Math.max(0, Math.min(1, Vec2.dot(Vec2.sub(p, a), d) / l2));
  return Vec2.distance(p, Vec2.add(a, Vec2.mul(d, t)));
}

export class Sim implements SimApi {
  world: World;
  insts = new Map<string, Inst>();
  ropes: RopeInst[] = [];
  belts: BeltInst[] = [];
  time = 0;
  steps = 0;
  events: SimEvent[] = [];
  popped = new Set<string>();
  private trampHits: { body: Body; inst: Inst; vin: number }[] = [];
  private bumperHits: { body: Body; inst: Inst }[] = [];
  private toPop = new Set<Inst>();
  private toRemove = new Set<Inst>();
  private toCut: { x: number; y: number; r: number }[] = [];
  private blasts: { x: number; y: number; r: number; power: number; source: Inst }[] = [];
  private powerDirty = true;
  /** short-lived flames: sparks, explosions */
  private flashes: { x: number; y: number; r: number; until: number }[] = [];
  /** every flame burning right now (for drawing/debugging too) */
  heatSpots: { x: number; y: number; r: number }[] = [];
  private impactCooldown = new WeakMap<Body, number>();

  constructor(scene: Scene) {
    this.world = new World({ gravity: Vec2(0, GRAVITY) });
    for (const p of scene.parts) this.addPart(p);
    for (const r of scene.ropes) this.addRope(r);
    for (const b of scene.belts ?? []) this.addBelt(b);
    this.computePower();

    this.world.on('pre-solve', (c: Contact) => this.preSolve(c));
    this.world.on('begin-contact', (c: Contact) => this.beginContact(c));
  }

  // ------------------------------------------------------------------ building

  private addPart(p: Part) {
    const def = PART_DEFS[p.type];
    if (!def) return;
    const inst: Inst = { part: p, main: null as unknown as Body, bodies: [], removed: false, st: {} };
    def.build(this.world, p, inst);
    this.insts.set(p.id, inst);
  }

  private addRope(r: Rope) {
    const a = this.insts.get(r.a);
    const b = this.insts.get(r.b);
    if (!a || !b || (a === b && (r.aEnd ?? 0) === (r.bEnd ?? 0))) return;
    const via = r.via ? this.insts.get(r.via) : undefined;
    const pa = ropeAnchorWorld(a, r.aEnd);
    const pb = ropeAnchorWorld(b, r.bEnd);
    const la = ropeAnchorLocal(a.part, r.aEnd);
    const lb = ropeAnchorLocal(b.part, r.bEnd);
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
    this.ropes.push({ rope: r, a, b, via, joint, length, cut: false });
  }

  private addBelt(belt: Belt) {
    const a = this.insts.get(belt.a);
    const b = this.insts.get(belt.b);
    if (!a || !b || a === b) return;
    if (!PART_DEFS[a.part.type].drives || !PART_DEFS[b.part.type].drives) return;
    this.belts.push({ belt, a, b });
  }

  // ------------------------------------------------------------------ power

  /** spread angular speed from running sources through belts and meshing gears */
  private computePower() {
    this.powerDirty = false;
    const adj = new Map<Inst, { to: Inst; k: number }[]>();
    const link = (a: Inst, b: Inst, k: number) => {
      if (!adj.has(a)) adj.set(a, []);
      adj.get(a)!.push({ to: b, k });
    };
    for (const bi of this.belts) {
      if (bi.a.removed || bi.b.removed) continue;
      const ra = driveWorld(bi.a.part, bi.belt.aEnd).r;
      const rb = driveWorld(bi.b.part, bi.belt.bEnd).r;
      // a belt keeps rim speed: same direction, ω scales with hub size
      link(bi.a, bi.b, ra / rb);
      link(bi.b, bi.a, rb / ra);
    }
    const gears = [...this.insts.values()].filter((i) => !i.removed && PART_DEFS[i.part.type].gearR);
    for (let i = 0; i < gears.length; i++) {
      for (let j = i + 1; j < gears.length; j++) {
        const a = gears[i];
        const b = gears[j];
        if (!gearsMesh(a.part, b.part)) continue;
        const ra = PART_DEFS[a.part.type].gearR!(a.part);
        const rb = PART_DEFS[b.part.type].gearR!(b.part);
        // meshing teeth reverse direction
        link(a, b, -ra / rb);
        link(b, a, -rb / ra);
      }
    }
    const omega = new Map<Inst, number>();
    const queue: Inst[] = [];
    for (const inst of this.insts.values()) {
      const src = PART_DEFS[inst.part.type].source;
      if (inst.removed || !src) continue;
      const w = src(inst);
      if (w !== 0) {
        omega.set(inst, w);
        queue.push(inst);
      }
    }
    while (queue.length) {
      const a = queue.shift()!;
      for (const { to, k } of adj.get(a) ?? []) {
        if (omega.has(to)) continue;
        omega.set(to, omega.get(a)! * k);
        queue.push(to);
      }
    }
    for (const inst of this.insts.values()) {
      if (inst.removed) continue;
      PART_DEFS[inst.part.type].onPower?.(inst, omega.get(inst) ?? 0);
    }
  }

  powerChanged() {
    this.powerDirty = true;
  }

  // ------------------------------------------------------------------ contacts

  private preSolve(c: Contact) {
    const ta = tagOf(c.getFixtureA());
    const tb = tagOf(c.getFixtureB());
    // glass that is breaking lets the thing that broke it carry on through
    if ((ta?.role === 'glass' && ta.inst.st.broken) || (tb?.role === 'glass' && tb.inst.st.broken)) {
      c.setEnabled(false);
      return;
    }
    // buckets are padded: things that land inside stay inside
    if (ta?.inst.part.type === 'bucket' || tb?.inst.part.type === 'bucket') c.setRestitution(0.05);
    if (ta?.role === 'conveyor') c.setTangentSpeed(-((ta.inst.st.speed as number) ?? 0));
    else if (tb?.role === 'conveyor') c.setTangentSpeed((tb.inst.st.speed as number) ?? 0);
  }

  private beginContact(c: Contact) {
    const fa = c.getFixtureA();
    const fb = c.getFixtureB();
    const ta = tagOf(fa);
    const tb = tagOf(fb);
    if (!ta || !tb) return;
    if (fa.isSensor() || fb.isSensor()) return;
    const ba = fa.getBody();
    const bb = fb.getBody();
    const rel = Vec2.sub(ba.getLinearVelocity(), bb.getLinearVelocity()).length();

    if (ta.role === 'balloon' && tb.role === 'sharp') this.toPop.add(ta.inst);
    if (tb.role === 'balloon' && ta.role === 'sharp') this.toPop.add(tb.inst);
    if (ta.role === 'tramp' && bb.isDynamic()) this.trampHit(bb, ta.inst);
    if (tb.role === 'tramp' && ba.isDynamic()) this.trampHit(ba, tb.inst);
    if (ta.role === 'bumper' && bb.isDynamic()) this.bumperHits.push({ body: bb, inst: ta.inst });
    if (tb.role === 'bumper' && ba.isDynamic()) this.bumperHits.push({ body: ba, inst: tb.inst });

    // part behaviours (triggers, fuses, glass...)
    if (ta.inst !== tb.inst) {
      PART_DEFS[ta.inst.part.type].onContact?.(this, ta.inst, ta.role, bb, tb.inst, rel);
      PART_DEFS[tb.inst.part.type].onContact?.(this, tb.inst, tb.role, ba, ta.inst, rel);
    }

    // sound-worthy impacts
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

  // ------------------------------------------------------------------ SimApi

  emit(e: SimEvent) {
    this.events.push(e);
  }

  /** removal is deferred until after the physics step (bodies can't be destroyed mid-step) */
  remove(inst: Inst) {
    this.toRemove.add(inst);
  }

  cutRopesNear(x: number, y: number, r: number): number {
    this.toCut.push({ x, y, r });
    return 0;
  }

  addHeat(x: number, y: number, r: number, seconds: number) {
    this.flashes.push({ x, y, r, until: this.time + seconds });
  }

  pop(inst: Inst) {
    this.toPop.add(inst);
  }

  explode(x: number, y: number, r: number, power: number, source: Inst) {
    this.blasts.push({ x, y, r, power, source });
  }

  // ------------------------------------------------------------------ stepping

  step() {
    if (this.powerDirty) this.computePower();
    // forces: balloon lift, fans, part behaviours
    for (const inst of this.insts.values()) {
      if (inst.removed) continue;
      if (inst.part.type === 'balloon' && inst.main.isDynamic()) {
        inst.main.applyForceToCenter(Vec2(0, -BALLOON_LIFT), true);
      }
      if (inst.part.type === 'fan') this.applyFan(inst);
      PART_DEFS[inst.part.type].onStep?.(this, inst, DT);
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

    // bumpers kick straight out from their centre
    for (const { body, inst } of this.bumperHits) {
      if (inst.removed) continue;
      const n = Vec2.sub(body.getWorldCenter(), inst.main.getPosition());
      if (n.length() < 1e-3) continue;
      n.normalize();
      const v = body.getLinearVelocity();
      const vn = Vec2.dot(v, n);
      if (vn < BUMPER_KICK) body.setLinearVelocity(Vec2.add(v, Vec2.mul(n, BUMPER_KICK - vn)));
      const p = body.getPosition();
      this.events.push({ kind: 'boing', x: p.x, y: p.y });
    }
    this.bumperHits.length = 0;

    for (const b of this.blasts.splice(0)) this.blast(b);
    this.spreadFire();
    for (const c of this.toCut.splice(0)) this.cutNear(c.x, c.y, c.r);
    for (const inst of this.toPop) this.popNow(inst);
    this.toPop.clear();
    for (const inst of this.toRemove) this.destroy(inst);
    this.toRemove.clear();

    // cull things that left the board
    for (const inst of this.insts.values()) {
      if (inst.removed || !inst.main.isDynamic()) continue;
      const p = inst.main.getPosition();
      if (p.y > BOARD_H + 8 || p.y < -10 || p.x < -10 || p.x > BOARD_W + 10) this.destroy(inst);
    }
  }

  /** flames light flammable things and burn through ropes */
  private spreadFire() {
    const spots: { x: number; y: number; r: number; src?: Inst }[] = [];
    for (const inst of this.insts.values()) {
      if (inst.removed) continue;
      const h = PART_DEFS[inst.part.type].heat?.(inst);
      if (h) for (const spot of h) spots.push({ ...spot, src: inst });
    }
    this.flashes = this.flashes.filter((f) => f.until > this.time);
    spots.push(...this.flashes);
    this.heatSpots = spots;
    if (!spots.length) return;
    for (const inst of this.insts.values()) {
      if (inst.removed || inst.st.lit || inst.st.ignited) continue;
      const def = PART_DEFS[inst.part.type];
      if (!def.ignite || !def.onIgnite) continue;
      const ig = def.ignite(inst.part);
      const w = inst.main.getWorldPoint(Vec2(ig.x, ig.y));
      if (!spots.some((h) => Math.hypot(h.x - w.x, h.y - w.y) <= h.r + ig.r)) continue;
      inst.st.ignited = true;
      def.onIgnite(this, inst);
    }
    // ropes smoulder for a moment, then burn through
    for (const rope of this.ropes) {
      if (rope.cut || rope.a.removed || rope.b.removed) continue;
      const segs = ropeSegments(rope);
      // a rocket doesn't burn through its own tow rope
      const hot = spots.find(
        (h) => h.src !== rope.a && h.src !== rope.b && segs.some(([a, b]) => segDist(Vec2(h.x, h.y), a, b) <= h.r + 0.05),
      );
      if (!hot) continue;
      rope.burn = (rope.burn ?? 0) + DT;
      if (rope.burn < 0.35) continue;
      rope.cut = true;
      if (rope.joint) this.world.destroyJoint(rope.joint);
      rope.joint = null;
      this.events.push({ kind: 'burn', x: hot.x, y: hot.y });
    }
  }

  private blast({ x, y, r, power, source }: { x: number; y: number; r: number; power: number; source: Inst }) {
    this.events.push({ kind: 'boom', x, y });
    const c = Vec2(x, y);
    for (const inst of this.insts.values()) {
      if (inst.removed || inst === source) continue;
      const d0 = Vec2.distance(inst.main.getWorldCenter(), c);
      if (d0 < r) {
        if (inst.part.type === 'balloon') this.toPop.add(inst);
        if (inst.part.type === 'glass') shatter(this, inst);
        if (inst.part.type === 'tnt' && inst.st.fuse === undefined) inst.st.fuse = 0.12;
      }
      for (const b of inst.bodies) {
        if (!b.isDynamic()) continue;
        const dvec = Vec2.sub(b.getWorldCenter(), c);
        const dist = dvec.length();
        if (dist > r) continue;
        if (dist < 1e-3) dvec.set(0, -1);
        dvec.normalize();
        const m = b.getMass();
        const dv = (power * (1 - dist / r)) / (1 + m * 0.3);
        b.applyLinearImpulse(Vec2.mul(dvec, dv * m), b.getWorldCenter(), true);
      }
    }
    this.cutNear(x, y, 1.5);
    this.addHeat(x, y, r * 0.5, 0.15);
    this.toRemove.add(source);
  }

  private cutNear(x: number, y: number, r: number) {
    const p = Vec2(x, y);
    for (const rope of this.ropes) {
      if (rope.cut || rope.a.removed || rope.b.removed) continue;
      if (!ropeSegments(rope).some(([a, b]) => segDist(p, a, b) <= r)) continue;
      rope.cut = true;
      if (rope.joint) this.world.destroyJoint(rope.joint);
      rope.joint = null;
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
        if (inst.part.type === 'candle' && inst.st.lit && this.inFanStream(origin, ax, b.getWorldPoint(Vec2(0, -0.7)), b, fb)) {
          inst.st.lit = false;
          inst.st.ignited = false;
          const w = b.getWorldPoint(Vec2(0, -0.7));
          this.events.push({ kind: 'puff', x: w.x, y: w.y });
        }
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

  private inFanStream(origin: Vec2, ax: Vec2, p: Vec2, b: Body, fanBody: Body) {
    const rel = Vec2.sub(p, origin);
    const along = Vec2.dot(rel, ax);
    if (along < 0 || along > FAN_RANGE) return false;
    const spread = 0.5 + (FAN_HALF_H - 0.5) * (along / FAN_RANGE);
    if (Math.abs(Vec2.cross(ax, rel)) > spread + 0.3) return false;
    return !this.fanBlocked(origin, p, b, fanBody);
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

  private popNow(inst: Inst) {
    if (inst.removed) return;
    const p = inst.main.getPosition();
    this.events.push({ kind: 'pop', x: p.x, y: p.y });
    this.popped.add(inst.part.id);
    this.destroy(inst);
  }

  private destroy(inst: Inst) {
    if (inst.removed) return;
    inst.removed = true;
    for (const r of this.ropes) {
      if (r.a === inst || r.b === inst || r.via === inst) {
        if (r.joint) this.world.destroyJoint(r.joint);
        r.joint = null;
      }
    }
    for (const b of inst.bodies) this.world.destroyBody(b);
    // a motor or gear going missing changes the drive train
    if (this.belts.some((b) => b.a === inst || b.b === inst) || PART_DEFS[inst.part.type].gearR) this.powerDirty = true;
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ------------------------------------------------------------------ goals

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
      case 'rung':
        return ((this.insts.get(g.target)?.st.rings as number) ?? 0) > 0;
      case 'lit': {
        const t = this.insts.get(g.target);
        return !!t && !t.removed && (!!t.st.lit || ((t.st.burn as number) ?? 0) > 0);
      }
    }
    return false;
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

/** Runs a scene until goals are held (true) or timeout (false). Used by tests. */
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
