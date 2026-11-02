import { Vec2 } from 'planck';
import type { Goal, Part, Zone } from './model';
import { BOARD_H, BOARD_W } from './model';
import { PART_DEFS, PULLEY_R, toWorld } from './parts';
import { RopeInst, Sim, pulleySides, ropeAnchorWorld } from './sim';

export class Camera {
  scale = 20;
  ox = 0;
  oy = 0;
  fit(w: number, h: number, margin = 16) {
    this.scale = Math.min((w - margin * 2) / BOARD_W, (h - margin * 2) / BOARD_H);
    this.ox = (w - BOARD_W * this.scale) / 2;
    this.oy = (h - BOARD_H * this.scale) / 2;
  }
  toWorld(sx: number, sy: number) {
    return { x: (sx - this.ox) / this.scale, y: (sy - this.oy) / this.scale };
  }
  toScreen(x: number, y: number) {
    return { x: this.ox + x * this.scale, y: this.oy + y * this.scale };
  }
  apply(g: CanvasRenderingContext2D) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.translate(this.ox, this.oy);
    g.scale(this.scale, this.scale);
  }
}

export interface Trail {
  color: string;
  pts: number[];
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  ring?: boolean;
}

export function drawBoard(g: CanvasRenderingContext2D) {
  const grad = g.createLinearGradient(0, 0, 0, BOARD_H);
  grad.addColorStop(0, '#20304a');
  grad.addColorStop(1, '#172235');
  g.fillStyle = grad;
  g.fillRect(0, 0, BOARD_W, BOARD_H);
  g.lineWidth = 0.02;
  g.strokeStyle = 'rgba(140,175,230,0.08)';
  g.beginPath();
  for (let x = 1; x < BOARD_W; x++) {
    if (x % 5 === 0) continue;
    g.moveTo(x, 0);
    g.lineTo(x, BOARD_H);
  }
  for (let y = 1; y < BOARD_H; y++) {
    if (y % 5 === 0) continue;
    g.moveTo(0, y);
    g.lineTo(BOARD_W, y);
  }
  g.stroke();
  g.strokeStyle = 'rgba(140,175,230,0.16)';
  g.lineWidth = 0.03;
  g.beginPath();
  for (let x = 5; x < BOARD_W; x += 5) {
    g.moveTo(x, 0);
    g.lineTo(x, BOARD_H);
  }
  for (let y = 5; y < BOARD_H; y += 5) {
    g.moveTo(0, y);
    g.lineTo(BOARD_W, y);
  }
  g.stroke();
}

export function drawZone(g: CanvasRenderingContext2D, z: Zone, met: boolean, t: number) {
  g.save();
  const pulse = 0.5 + 0.5 * Math.sin(t * 4);
  g.fillStyle = met ? 'rgba(110,231,160,0.22)' : `rgba(255,214,102,${0.06 + pulse * 0.06})`;
  g.fillRect(z.x, z.y, z.w, z.h);
  g.setLineDash([0.3, 0.2]);
  g.lineDashOffset = -t;
  g.lineWidth = 0.07;
  g.strokeStyle = met ? '#6ee7a0' : '#ffd666';
  g.strokeRect(z.x, z.y, z.w, z.h);
  g.setLineDash([]);
  g.restore();
}

export function drawGoalMarkers(g: CanvasRenderingContext2D, sim: Sim, goals: Goal[], t: number) {
  for (const goal of goals) {
    const met = sim.goalMet(goal);
    if (goal.kind === 'inZone') drawZone(g, goal.zone, met, t);
    const ids =
      goal.kind === 'toppled' ? goal.targets : goal.kind === 'inBucket' ? [goal.target, goal.bucket] : [goal.target];
    for (const id of ids) {
      const inst = sim.insts.get(id);
      if (!inst || inst.removed) continue;
      const p = inst.main.getPosition();
      const bob = Math.sin(t * 5) * 0.12;
      g.save();
      g.translate(p.x, p.y - 1.35 + bob - (inst.part.type === 'bucket' ? 0.6 : 0));
      g.beginPath();
      g.moveTo(0, 0.35);
      g.lineTo(-0.22, 0);
      g.lineTo(-0.09, 0);
      g.lineTo(-0.09, -0.25);
      g.lineTo(0.09, -0.25);
      g.lineTo(0.09, 0);
      g.lineTo(0.22, 0);
      g.closePath();
      g.fillStyle = met ? '#6ee7a0' : '#ffd666';
      g.fill();
      g.lineWidth = 0.04;
      g.strokeStyle = '#141722';
      g.stroke();
      g.restore();
    }
  }
}

function ropeLine(g: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, slack: number) {
  g.moveTo(ax, ay);
  if (slack > 0.02) {
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2 + Math.min(slack * 0.7, 3);
    g.quadraticCurveTo(mx, my, bx, by);
  } else g.lineTo(bx, by);
}

export function drawRopes(g: CanvasRenderingContext2D, ropes: RopeInst[], highlight?: string) {
  for (const r of ropes) {
    if (r.a.removed || r.b.removed) continue;
    const pa = ropeAnchorWorld(r.a);
    const pb = ropeAnchorWorld(r.b);
    g.beginPath();
    if (r.via && !r.via.removed) {
      const pp = r.via.main.getPosition();
      const [gax, gbx] = pulleySides(pp.x, ropeAnchorWorldPart(r, 'a'), ropeAnchorWorldPart(r, 'b'));
      const la = Vec2.distance(pa, Vec2(gax, pp.y));
      const lb = Vec2.distance(pb, Vec2(gbx, pp.y));
      const slack = Math.max(0, r.length - la - lb);
      ropeLine(g, pa.x, pa.y, gax, pp.y, slack / 2);
      const ccw = gax > gbx;
      g.arc(pp.x, pp.y, PULLEY_R, gax < pp.x ? Math.PI : 0, gbx < pp.x ? Math.PI : 0, !ccw ? false : true);
      ropeLine(g, gbx, pp.y, pb.x, pb.y, slack / 2);
    } else {
      const slack = r.joint ? Math.max(0, r.length - Vec2.distance(pa, pb)) : 0;
      ropeLine(g, pa.x, pa.y, pb.x, pb.y, slack);
    }
    g.lineCap = 'round';
    g.lineWidth = 0.13;
    g.strokeStyle = '#141722';
    g.stroke();
    g.lineWidth = 0.07;
    g.strokeStyle = r.rope.id === highlight ? '#ffd666' : '#d8c08a';
    g.stroke();
  }
}

/** x of rope anchors at build time (keeps pulley side assignment stable while things swing) */
function ropeAnchorWorldPart(r: RopeInst, end: 'a' | 'b') {
  const inst = end === 'a' ? r.a : r.b;
  const def = PART_DEFS[inst.part.type];
  const l = def.ropeAnchor ? def.ropeAnchor(inst.part) : { x: 0, y: 0 };
  return toWorld(inst.part, l.x, l.y).x;
}

export function drawParts(g: CanvasRenderingContext2D, sim: Sim, t: number, order: string[]) {
  // static scenery first, then dynamic things on top
  const list = order.map((id) => sim.insts.get(id)).filter((i) => i && !i.removed) as NonNullable<
    ReturnType<typeof sim.insts.get>
  >[];
  list.sort((a, b) => Number(a.main.isDynamic()) - Number(b.main.isDynamic()));
  for (const inst of list) PART_DEFS[inst.part.type].draw(g, inst, t);
}

export function drawTrails(g: CanvasRenderingContext2D, trails: Trail[]) {
  g.save();
  g.lineCap = 'round';
  for (const tr of trails) {
    const pts = tr.pts;
    const n = pts.length / 2;
    for (let i = 0; i < n; i += 1) {
      const a = 1 - i / n;
      g.globalAlpha = 0.15 + 0.55 * a;
      g.fillStyle = tr.color;
      g.beginPath();
      g.arc(pts[i * 2], pts[i * 2 + 1], 0.06 + 0.04 * a, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
}

export function drawParticles(g: CanvasRenderingContext2D, ps: Particle[]) {
  g.save();
  for (const p of ps) {
    const a = p.life / p.max;
    g.globalAlpha = a;
    if (p.ring) {
      g.beginPath();
      g.arc(p.x, p.y, p.size * (1.6 - a), 0, Math.PI * 2);
      g.lineWidth = 0.06;
      g.strokeStyle = p.color;
      g.stroke();
    } else {
      g.fillStyle = p.color;
      g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
  }
  g.restore();
}

export interface Handles {
  rotate?: { x: number; y: number };
  resize?: { x: number; y: number; end: -1 | 1 }[];
}

export function partHandles(p: Part, scale: number): Handles {
  const def = PART_DEFS[p.type];
  const b = def.bounds(p);
  const h: Handles = {};
  if (def.rotate) h.rotate = toWorld(p, 0, b.y0 - 22 / scale);
  if (def.resize) {
    h.resize = [
      { ...toWorld(p, -p.length / 2, 0), end: -1 },
      { ...toWorld(p, p.length / 2, 0), end: 1 },
    ];
  }
  return h;
}

export function drawSelection(g: CanvasRenderingContext2D, p: Part, scale: number, bad: boolean, handles = true) {
  const def = PART_DEFS[p.type];
  const b = def.bounds(p);
  const px = 1 / scale;
  g.save();
  g.translate(p.x, p.y);
  g.rotate(p.angle);
  g.setLineDash([6 * px, 4 * px]);
  g.lineWidth = 2 * px;
  g.strokeStyle = bad ? '#ff6b6b' : '#ffd666';
  const pad = 5 * px;
  if (def.radius) {
    g.beginPath();
    g.arc(0, 0, def.radius + pad, 0, Math.PI * 2);
    g.stroke();
  } else g.strokeRect(b.x0 - pad, b.y0 - pad, b.x1 - b.x0 + pad * 2, b.y1 - b.y0 + pad * 2);
  g.setLineDash([]);
  if (def.rotate && handles) {
    g.beginPath();
    g.moveTo(0, b.y0 - pad);
    g.lineTo(0, b.y0 - 22 * px);
    g.stroke();
  }
  g.restore();
  if (!handles) return;
  const hs = partHandles(p, scale);
  const knob = (x: number, y: number, color: string) => {
    g.beginPath();
    g.arc(x, y, 6 * px, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
    g.lineWidth = 2 * px;
    g.strokeStyle = '#141722';
    g.stroke();
  };
  if (hs.rotate) knob(hs.rotate.x, hs.rotate.y, '#7fc4f0');
  for (const r of hs.resize ?? []) knob(r.x, r.y, '#ffd666');
}

export function drawLockBadge(g: CanvasRenderingContext2D, p: Part, scale: number) {
  const px = 1 / scale;
  g.save();
  g.translate(p.x, p.y);
  g.globalAlpha = 0.55;
  g.fillStyle = '#141722';
  g.beginPath();
  g.arc(0, 0, 5 * px, 0, Math.PI * 2);
  g.fill();
  g.restore();
}
