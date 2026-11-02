import { Vec2 } from 'planck';
import * as audio from './audio';
import * as music from './music';
import { LEVELS } from './levels';
import { BOARD_H, BOARD_W, Bin, Level, Part, PartType, Rope, Scene, cloneScene, newId } from './model';
import { BIN_ORDER, PART_DEFS, defaultPart, hitPart } from './parts';
import {
  Camera,
  Particle,
  Trail,
  drawBoard,
  drawGoalMarkers,
  drawParticles,
  drawParts,
  drawRopes,
  drawSelection,
  drawTrails,
  partHandles,
} from './render';
import { DT, Sim, findOverlaps, ropeAnchorWorld } from './sim';
import * as store from './storage';

type Mode = 'edit' | 'run';

interface Drag {
  kind: 'move' | 'new' | 'rotate' | 'resize';
  id: string;
  ox: number;
  oy: number;
  end?: -1 | 1;
  before: string;
  moved: boolean;
  sx: number;
  sy: number;
  fromBin?: boolean;
}

interface RopeTool {
  from?: string;
  via?: string;
}

const SPEEDS = [0.25, 0.5, 1, 2, 4];
const ANGLE_SNAP = Math.PI / 12;
const GHOST_SECONDS = 10;
const GHOST_BUDGET_MS = 5;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class Game {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  cam = new Camera();
  dpr = 1;

  level: Level | null = null;
  levelIndex = -1;
  scene: Scene = { parts: [], ropes: [] };
  bin: Bin = {};
  mode: Mode = 'edit';
  sim!: Sim;
  paused = false;
  speedIdx = 2;
  acc = 0;
  wallTime = 0;
  won = false;
  holdTime = 0;

  selected: string | null = null;
  selectedRope: string | null = null;
  hover: { x: number; y: number } | null = null;
  drag: Drag | null = null;
  ropeTool: RopeTool | null = null;
  bad = new Set<string>();

  undoStack: string[] = [];
  redoStack: string[] = [];

  snap = true;
  ghost = true;
  musicWanted = true;
  trails: Trail[] = [];
  private ghostJob: { sim: Sim; trails: Map<string, Trail>; steps: number } | null = null;
  private ghostDirty = false;

  particles: Particle[] = [];
  private toastTimer = 0;
  private binEls = new Map<string, HTMLElement>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d')!;
    const prefs = store.loadPrefs();
    this.snap = prefs.snap;
    this.ghost = prefs.ghost;
    audio.setMuted(prefs.muted);
    music.setMuted(prefs.muted);
    music.setVolume(prefs.musicVolume);
    this.musicWanted = prefs.music;

    new ResizeObserver(() => this.resize()).observe(canvas.parentElement!);
    this.resize();
    this.bindInput();
    this.bindToolbar();
    requestAnimationFrame((t) => this.frame(t, t));
  }

  // ---------------------------------------------------------------- levels

  loadLevel(i: number) {
    const lvl = LEVELS[i];
    this.level = lvl;
    this.levelIndex = i;
    const saved = store.loadLevelScene(lvl.id);
    this.scene = cloneScene(lvl.scene);
    if (saved) {
      // only player parts are persisted; locked ones always come from the level
      const ids = new Set(this.scene.parts.map((p) => p.id));
      for (const p of saved.parts) if (!ids.has(p.id) && PART_DEFS[p.type]) this.scene.parts.push(p);
      for (const r of saved.ropes) if (!r.locked) this.scene.ropes.push(r);
      this.pruneRopes();
    }
    this.bin = { ...lvl.bin };
    this.afterLoad();
    location.hash = `#level=${lvl.id}`;
  }

  loadSandbox(scene?: Scene) {
    this.level = null;
    this.levelIndex = -1;
    this.scene = scene ? cloneScene(scene) : store.loadSandbox() ?? { parts: [], ropes: [] };
    for (const p of this.scene.parts) p.locked = false;
    for (const r of this.scene.ropes) r.locked = false;
    this.bin = {};
    this.afterLoad();
    if (!scene) location.hash = '#sandbox';
  }

  private afterLoad() {
    this.hintShown = false;
    this.mode = 'edit';
    this.won = false;
    this.selected = null;
    this.selectedRope = null;
    this.ropeTool = null;
    this.undoStack = [];
    this.redoStack = [];
    this.rebuild();
    this.buildBinUI();
    this.updateUI();
  }

  get sandbox() {
    return this.level === null;
  }

  available(type: PartType | 'rope'): number {
    if (this.sandbox) return Infinity;
    const total = this.bin[type] ?? 0;
    const used =
      type === 'rope'
        ? this.scene.ropes.filter((r) => !r.locked).length
        : this.scene.parts.filter((p) => !p.locked && p.type === type).length;
    return total - used;
  }

  private persist() {
    if (this.sandbox) store.saveSandbox(this.scene);
    else if (this.level)
      store.saveLevelScene(this.level.id, {
        parts: this.scene.parts.filter((p) => !p.locked),
        ropes: this.scene.ropes.filter((r) => !r.locked),
      });
  }

  // ---------------------------------------------------------------- sim

  rebuild() {
    this.sim = new Sim(this.scene);
    this.acc = 0;
    if (this.mode === 'edit') {
      this.computeOverlaps();
      this.ghostDirty = true;
    }
  }

  private computeOverlaps() {
    this.bad = findOverlaps(this.sim);
  }

  start() {
    if (this.mode === 'run') return;
    if (this.bad.size) {
      this.toast('Some parts overlap — fix the red ones first');
      return;
    }
    this.mode = 'run';
    this.paused = false;
    this.won = false;
    this.holdTime = 0;
    this.selected = null;
    this.selectedRope = null;
    this.ropeTool = null;
    this.trails = [];
    this.ghostJob = null;
    this.rebuild();
    this.updateUI();
    music.setRunning(true);
    audio.click();
  }

  stop() {
    if (this.mode === 'edit') return;
    this.mode = 'edit';
    music.setRunning(false);
    this.particles = [];
    this.rebuild();
    this.updateUI();
  }

  toggleRun() {
    if (this.mode === 'run') this.stop();
    else this.start();
  }

  private stepSim() {
    this.sim.step();
    for (const e of this.sim.drainEvents()) {
      if (e.kind === 'pop') {
        audio.pop();
        for (let i = 0; i < 18; i++) {
          const a = (i / 18) * Math.PI * 2;
          const sp = 4 + Math.random() * 5;
          this.particles.push({
            x: e.x,
            y: e.y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            life: 0.6,
            max: 0.6,
            color: i % 2 ? '#ff5d7a' : '#ffd6de',
            size: 0.16,
          });
        }
      } else if (e.kind === 'boing') {
        audio.boing();
        this.particles.push({ x: e.x, y: e.y + 0.4, vx: 0, vy: 0, life: 0.35, max: 0.35, color: '#4fd1b6', size: 0.8, ring: true });
      } else if (e.kind === 'impact') {
        audio.impact(e.material, e.speed);
      }
    }
    if (this.level && !this.won) {
      const all = this.level.goals.every((g) => this.sim.goalMet(g));
      this.holdTime = all ? this.holdTime + DT : 0;
      if (this.holdTime >= 0.25) this.win();
    }
  }

  private win() {
    this.won = true;
    audio.fanfare();
    if (!this.level) return;
    store.markSolved(this.level.id);
    const t = this.sim.time.toFixed(1);
    const next = this.levelIndex + 1 < LEVELS.length ? this.levelIndex + 1 : -1;
    for (let i = 0; i < 80; i++) {
      this.particles.push({
        x: Math.random() * BOARD_W,
        y: -1 - Math.random() * 4,
        vx: (Math.random() - 0.5) * 4,
        vy: 4 + Math.random() * 6,
        life: 3,
        max: 3,
        color: ['#ffd666', '#4fd1b6', '#ff5d7a', '#7fc4f0'][i % 4],
        size: 0.22,
      });
    }
    setTimeout(() => {
      if (!this.won) return;
      this.showPanel(`
        <h1>Solved!</h1>
        <p><b>${this.level!.title}</b> — your contraption did it in ${t} seconds.</p>
        <div class="actions">
          <button data-act="stay">Keep watching</button>
          <button data-act="menu">All puzzles</button>
          ${next >= 0 ? `<button class="primary" data-act="next">Next puzzle →</button>` : `<button class="primary" data-act="sandbox">Free build →</button>`}
        </div>`);
      this.panelAction('stay', () => this.hidePanel());
      this.panelAction('menu', () => this.showMenu());
      this.panelAction('next', () => {
        this.hidePanel();
        this.loadLevel(next);
      });
      this.panelAction('sandbox', () => {
        this.hidePanel();
        this.loadSandbox();
      });
    }, 900);
    this.updateGoals();
  }

  // ---------------------------------------------------------------- ghost preview

  private advanceGhost() {
    if (this.mode !== 'edit' || !this.ghost) {
      this.ghostJob = null;
      if (!this.ghost) this.trails = [];
      return;
    }
    if (this.ghostDirty && !this.drag) {
      this.ghostDirty = false;
      if (this.bad.size) {
        this.ghostJob = null;
        this.trails = [];
        return;
      }
      const trails = new Map<string, Trail>();
      this.ghostJob = { sim: new Sim(cloneScene(this.scene)), trails, steps: 0 };
      this.trails = [];
    }
    const job = this.ghostJob;
    if (!job) return;
    const t0 = performance.now();
    const maxSteps = GHOST_SECONDS / DT;
    while (job.steps < maxSteps && performance.now() - t0 < GHOST_BUDGET_MS) {
      job.sim.step();
      job.sim.drainEvents();
      job.steps++;
      if (job.steps % 5 === 0) {
        for (const inst of job.sim.insts.values()) {
          if (inst.removed || !inst.main.isDynamic() || inst.part.type === 'seesaw') continue;
          let tr = job.trails.get(inst.part.id);
          const p = inst.main.getPosition();
          if (!tr) {
            tr = { color: PART_DEFS[inst.part.type].color, pts: [inst.part.x, inst.part.y] };
            job.trails.set(inst.part.id, tr);
          }
          const n = tr.pts.length;
          if (Math.hypot(p.x - tr.pts[n - 2], p.y - tr.pts[n - 1]) > 0.35) tr.pts.push(p.x, p.y);
        }
      }
    }
    this.trails = [...job.trails.values()].filter((t) => t.pts.length > 2);
    if (job.steps >= maxSteps) this.ghostJob = null;
  }

  // ---------------------------------------------------------------- frame

  private frame(t: number, last: number) {
    const dt = Math.min(0.1, (t - last) / 1000);
    this.wallTime += dt;
    if (this.mode === 'run' && !this.paused) {
      this.acc += dt * SPEEDS[this.speedIdx];
      let n = 0;
      while (this.acc >= DT && n < 600) {
        this.stepSim();
        this.acc -= DT;
        n++;
      }
    }
    this.advanceGhost();
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (!p.ring) p.vy += 12 * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    this.draw();
    if (this.mode === 'run' && this.level) this.updateGoals();
    requestAnimationFrame((nt) => this.frame(nt, t));
  }

  private resize() {
    const el = this.canvas.parentElement!;
    this.dpr = window.devicePixelRatio || 1;
    const w = el.clientWidth;
    const h = el.clientHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.cam.fit(w, h, w < 700 ? 6 : 16);
  }

  private draw() {
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#0d121c';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    g.scale(this.dpr, this.dpr);
    g.translate(this.cam.ox, this.cam.oy);
    g.scale(this.cam.scale, this.cam.scale);

    g.save();
    g.beginPath();
    g.rect(0, 0, BOARD_W, BOARD_H);
    g.clip();
    drawBoard(g);
    const simT = this.mode === 'run' ? this.sim.time : this.wallTime * 0.15;
    if (this.level) drawGoalMarkers(g, this.sim, this.level.goals, this.wallTime);
    if (this.mode === 'edit' && this.ghost) drawTrails(g, this.trails);
    const order = this.scene.parts.map((p) => p.id);
    drawParts(g, this.sim, simT, order);
    drawRopes(g, this.sim.ropes, this.selectedRope ?? undefined);

    if (this.mode === 'edit') {
      for (const id of this.bad) this.tintPart(id, 'rgba(255,80,80,0.45)');
      if (this.ropeTool) this.drawRopeTool();
    }
    drawParticles(g, this.particles);
    g.restore();

    // board frame
    g.lineWidth = 3 / this.cam.scale;
    g.strokeStyle = '#2d3850';
    g.strokeRect(0, 0, BOARD_W, BOARD_H);

    if (this.mode === 'edit' && this.selected) {
      const p = this.part(this.selected);
      if (p && !p.locked) drawSelection(g, p, this.cam.scale, this.bad.has(p.id));
      else if (p) this.tintPart(p.id, 'rgba(255,214,102,0.25)');
    }
    if (this.mode === 'run' && this.paused) {
      g.fillStyle = 'rgba(255,214,102,0.9)';
      g.font = `800 ${16 / this.cam.scale}px Nunito, sans-serif`;
      g.textAlign = 'right';
      g.fillText('PAUSED', BOARD_W - 0.5, 1.2);
    }
  }

  private tintPart(id: string, color: string) {
    const p = this.part(id);
    if (!p) return;
    const def = PART_DEFS[p.type];
    const b = def.bounds(p);
    const g = this.g;
    g.save();
    g.translate(p.x, p.y);
    g.rotate(p.angle);
    g.fillStyle = color;
    if (def.radius) {
      g.beginPath();
      g.arc(0, 0, def.radius + 0.05, 0, Math.PI * 2);
      g.fill();
    } else g.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    g.restore();
  }

  private drawRopeTool() {
    const g = this.g;
    const px = 1 / this.cam.scale;
    // highlight valid anchors
    for (const p of this.scene.parts) {
      const def = PART_DEFS[p.type];
      const isPulley = p.type === 'pulley';
      if (!def.ropeAnchor && !isPulley) continue;
      if (isPulley && (!this.ropeTool?.from || this.ropeTool.via)) continue;
      const inst = this.sim.insts.get(p.id);
      if (!inst) continue;
      const a = isPulley ? inst.main.getPosition() : ropeAnchorWorld(inst);
      const chosen = p.id === this.ropeTool!.from || p.id === this.ropeTool!.via;
      g.beginPath();
      g.arc(a.x, a.y, (chosen ? 9 : 6 + Math.sin(this.wallTime * 6) * 1.5) * px, 0, Math.PI * 2);
      g.fillStyle = chosen ? '#ffd666' : 'rgba(255,214,102,0.35)';
      g.fill();
      g.lineWidth = 2 * px;
      g.strokeStyle = '#ffd666';
      g.stroke();
    }
    if (this.ropeTool?.from && this.hover) {
      const inst = this.sim.insts.get(this.ropeTool.from);
      if (!inst) return;
      const a = ropeAnchorWorld(inst);
      g.beginPath();
      g.moveTo(a.x, a.y);
      if (this.ropeTool.via) {
        const v = this.sim.insts.get(this.ropeTool.via)!.main.getPosition();
        g.lineTo(v.x, v.y - 0.4);
      }
      g.lineTo(this.hover.x, this.hover.y);
      g.setLineDash([6 * px, 5 * px]);
      g.lineWidth = 2.5 * px;
      g.strokeStyle = '#d8c08a';
      g.stroke();
      g.setLineDash([]);
    }
  }

  // ---------------------------------------------------------------- scene editing

  part(id: string): Part | undefined {
    return this.scene.parts.find((p) => p.id === id);
  }

  private snapshot(): string {
    return JSON.stringify(this.scene);
  }

  private commit(before: string) {
    if (before === this.snapshot()) return;
    this.undoStack.push(before);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.persist();
    this.updateUI();
  }

  undo() {
    const s = this.undoStack.pop();
    if (!s || this.mode !== 'edit') return;
    this.redoStack.push(this.snapshot());
    this.scene = JSON.parse(s);
    this.afterHistory();
  }

  redo() {
    const s = this.redoStack.pop();
    if (!s || this.mode !== 'edit') return;
    this.undoStack.push(this.snapshot());
    this.scene = JSON.parse(s);
    this.afterHistory();
  }

  private afterHistory() {
    if (this.selected && !this.part(this.selected)) this.selected = null;
    this.selectedRope = null;
    this.rebuild();
    this.persist();
    this.updateUI();
  }

  private pruneRopes() {
    const ids = new Set(this.scene.parts.map((p) => p.id));
    this.scene.ropes = this.scene.ropes.filter((r) => ids.has(r.a) && ids.has(r.b) && (!r.via || ids.has(r.via)));
  }

  private mutate(fn: () => void) {
    const before = this.snapshot();
    fn();
    this.pruneRopes();
    this.rebuild();
    this.commit(before);
  }

  deleteSelected() {
    if (this.selectedRope) {
      const r = this.scene.ropes.find((r) => r.id === this.selectedRope);
      if (r && !r.locked) this.mutate(() => (this.scene.ropes = this.scene.ropes.filter((x) => x !== r)));
      this.selectedRope = null;
      return;
    }
    const p = this.selected && this.part(this.selected);
    if (!p || p.locked) return;
    this.mutate(() => (this.scene.parts = this.scene.parts.filter((x) => x !== p)));
    this.selected = null;
    this.updateUI();
  }

  duplicateSelected() {
    const p = this.selected && this.part(this.selected);
    if (!p || p.locked || this.available(p.type) <= 0) return;
    const copy: Part = { ...p, id: newId(), x: Math.min(BOARD_W - 1, p.x + 1), y: Math.max(1, p.y - 1) };
    this.mutate(() => this.scene.parts.push(copy));
    this.selected = copy.id;
    this.updateUI();
  }

  private editSelected(fn: (p: Part) => void) {
    const p = this.selected && this.part(this.selected);
    if (!p || p.locked || this.mode !== 'edit') return;
    this.mutate(() => fn(p));
  }

  rotateSelected(delta: number) {
    this.editSelected((p) => {
      if (!PART_DEFS[p.type].rotate) return;
      p.angle = normAngle(p.angle + delta);
      if (this.snap && Math.abs(delta) >= ANGLE_SNAP - 1e-6) p.angle = Math.round(p.angle / ANGLE_SNAP) * ANGLE_SNAP;
    });
  }

  resizeSelected(delta: number) {
    this.editSelected((p) => {
      const r = PART_DEFS[p.type].resize;
      if (r) p.length = clamp(p.length + delta, r.min, r.max);
    });
  }

  flipSelected() {
    this.editSelected((p) => {
      if (PART_DEFS[p.type].flip) p.flip = !p.flip;
    });
  }

  pinSelected() {
    if (!this.sandbox) {
      this.toast('Pinning is available in Free Build');
      return;
    }
    this.editSelected((p) => {
      if (PART_DEFS[p.type].dynamic) p.pinned = !p.pinned;
    });
  }

  nudgeSelected(dx: number, dy: number) {
    this.editSelected((p) => {
      p.x = clamp(p.x + dx, 0, BOARD_W);
      p.y = clamp(p.y + dy, 0, BOARD_H);
    });
  }

  clearPlayerParts() {
    this.mutate(() => {
      this.scene.parts = this.scene.parts.filter((p) => p.locked);
      this.scene.ropes = this.scene.ropes.filter((r) => r.locked);
    });
    this.selected = null;
    this.updateUI();
  }

  private snapV(v: number, force = false) {
    return this.snap || force ? Math.round(v * 4) / 4 : v;
  }

  // ---------------------------------------------------------------- rope tool

  toggleRopeTool() {
    if (this.mode !== 'edit') return;
    if (this.ropeTool) {
      this.ropeTool = null;
    } else {
      if (this.available('rope') <= 0) {
        this.toast('No ropes left in the bin');
        return;
      }
      this.ropeTool = {};
      this.selected = null;
      this.toast('Click something to tie the rope to — Esc to cancel');
    }
    this.updateUI();
  }

  private ropeClick(wx: number, wy: number) {
    const tool = this.ropeTool!;
    const target = this.hitTest(wx, wy, (p) => !!PART_DEFS[p.type].ropeAnchor || p.type === 'pulley');
    if (!target) {
      this.ropeTool = null;
      this.updateUI();
      return;
    }
    if (target.type === 'pulley') {
      if (tool.from && !tool.via) tool.via = target.id;
      else if (!tool.from) this.toast('Start the rope on something, then click the pulley');
      return;
    }
    if (!tool.from) {
      tool.from = target.id;
      audio.click();
      return;
    }
    if (target.id === tool.from) return;
    const rope: Rope = { id: newId('r'), a: tool.from, b: target.id, via: tool.via };
    const a = this.part(tool.from)!;
    if (!PART_DEFS[a.type].dynamic && !PART_DEFS[target.type].dynamic) {
      this.toast('A rope between two fixed things would do nothing');
      return;
    }
    this.mutate(() => this.scene.ropes.push(rope));
    audio.click();
    this.ropeTool = null;
    this.selectedRope = rope.id;
    this.updateUI();
  }

  // ---------------------------------------------------------------- hit testing

  private hitTest(wx: number, wy: number, filter: (p: Part) => boolean = () => true): Part | undefined {
    // prefer small/dynamic things drawn on top
    const list = this.scene.parts.filter(filter);
    const dyn = list.filter((p) => PART_DEFS[p.type].dynamic && p.type !== 'seesaw');
    const stat = list.filter((p) => !PART_DEFS[p.type].dynamic || p.type === 'seesaw');
    const pad = 6 / this.cam.scale;
    for (const group of [dyn, stat]) {
      for (let i = group.length - 1; i >= 0; i--) if (hitPart(group[i], wx, wy, pad)) return group[i];
    }
    return undefined;
  }

  private hitRope(wx: number, wy: number): Rope | undefined {
    const tol = 8 / this.cam.scale;
    for (const r of this.sim.ropes) {
      if (r.a.removed || r.b.removed) continue;
      const pa = ropeAnchorWorld(r.a);
      const pb = ropeAnchorWorld(r.b);
      const pts = [pa];
      if (r.via) {
        const v = r.via.main.getPosition();
        pts.push(Vec2(v.x - 0.4, v.y), Vec2(v.x + 0.4, v.y));
        if (pa.x > pb.x) pts.splice(1, 2, Vec2(v.x + 0.4, v.y), Vec2(v.x - 0.4, v.y));
      }
      pts.push(pb);
      for (let i = 0; i < pts.length - 1; i++) {
        if (segDist(wx, wy, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) < tol) return r.rope;
      }
    }
    return undefined;
  }

  private hitHandle(wx: number, wy: number): { kind: 'rotate' | 'resize'; end?: -1 | 1 } | undefined {
    const p = this.selected && this.part(this.selected);
    if (!p || p.locked) return;
    const hs = partHandles(p, this.cam.scale);
    const tol = 11 / this.cam.scale;
    if (hs.rotate && Math.hypot(wx - hs.rotate.x, wy - hs.rotate.y) < tol) return { kind: 'rotate' };
    for (const r of hs.resize ?? []) if (Math.hypot(wx - r.x, wy - r.y) < tol) return { kind: 'resize', end: r.end };
    return undefined;
  }

  // ---------------------------------------------------------------- input

  private eventWorld(e: PointerEvent | WheelEvent | MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    return this.cam.toWorld(e.clientX - r.left, e.clientY - r.top);
  }

  private bindInput() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e));
    c.addEventListener('pointerleave', () => (this.hover = null));
    c.addEventListener(
      'wheel',
      (e) => {
        if (this.mode !== 'edit' || !this.selected) return;
        const p = this.part(this.selected);
        if (!p || p.locked || !PART_DEFS[p.type].rotate) return;
        e.preventDefault();
        const step = e.shiftKey ? Math.PI / 36 : ANGLE_SNAP;
        this.rotateSelected(Math.sign(e.deltaY || e.deltaX) * step);
      },
      { passive: false },
    );
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.mode !== 'edit') return;
      const w = this.eventWorld(e);
      const p = this.hitTest(w.x, w.y, (p) => !p.locked);
      if (p) {
        this.selected = p.id;
        this.deleteSelected();
      }
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  private onDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const w = this.eventWorld(e);
    if (this.mode === 'run') return;
    if (this.ropeTool) {
      this.ropeClick(w.x, w.y);
      return;
    }
    const before = this.snapshot();
    const h = this.hitHandle(w.x, w.y);
    if (h) {
      this.drag = { kind: h.kind, end: h.end, id: this.selected!, ox: 0, oy: 0, before, moved: false, sx: e.clientX, sy: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }
    const p = this.hitTest(w.x, w.y);
    if (p) {
      this.selected = p.id;
      this.selectedRope = null;
      if (!p.locked) {
        this.drag = { kind: 'move', id: p.id, ox: w.x - p.x, oy: w.y - p.y, before, moved: false, sx: e.clientX, sy: e.clientY };
        this.canvas.setPointerCapture(e.pointerId);
      }
      this.updateUI();
      return;
    }
    const r = this.hitRope(w.x, w.y);
    this.selected = null;
    this.selectedRope = r ? r.id : null;
    this.updateUI();
  }

  /** start dragging a fresh part out of the bin */
  private beginBinDrag(type: PartType, e: PointerEvent) {
    if (this.mode !== 'edit') this.stop();
    if (this.available(type) <= 0) {
      this.toast(`No more ${PART_DEFS[type].name.toLowerCase()}s in the bin`);
      return;
    }
    this.ropeTool = null;
    const before = this.snapshot();
    const w = this.eventWorld(e);
    const p = defaultPart(type, w.x, w.y, newId());
    this.scene.parts.push(p);
    this.selected = p.id;
    this.drag = { kind: 'new', id: p.id, ox: 0, oy: 0, before, moved: false, sx: e.clientX, sy: e.clientY, fromBin: true };
    this.rebuild();
    this.updateUI();
  }

  private onMove(e: PointerEvent) {
    const w = this.eventWorld(e);
    this.hover = w;
    const d = this.drag;
    if (!d) {
      if (this.mode === 'edit' && !this.ropeTool) {
        const h = this.hitHandle(w.x, w.y);
        const p = !h && this.hitTest(w.x, w.y);
        this.canvas.style.cursor = h ? (h.kind === 'rotate' ? 'grab' : 'ew-resize') : p && !p.locked ? 'move' : 'default';
      } else this.canvas.style.cursor = this.ropeTool ? 'crosshair' : 'default';
      return;
    }
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 3) return;
    d.moved = true;
    const p = this.part(d.id);
    if (!p) return;
    const free = e.altKey;
    if (d.kind === 'move' || d.kind === 'new') {
      p.x = free ? w.x - d.ox : this.snapV(w.x - d.ox);
      p.y = free ? w.y - d.oy : this.snapV(w.y - d.oy);
    } else if (d.kind === 'rotate') {
      let a = Math.atan2(w.y - p.y, w.x - p.x) + Math.PI / 2;
      const step = e.shiftKey ? Math.PI / 36 : ANGLE_SNAP;
      if (this.snap && !free) a = Math.round(a / step) * step;
      p.angle = normAngle(a);
    } else if (d.kind === 'resize') {
      const r = PART_DEFS[p.type].resize!;
      const end = d.end!;
      const c = Math.cos(p.angle);
      const s = Math.sin(p.angle);
      const ax = p.x - (end * c * p.length) / 2;
      const ay = p.y - (end * s * p.length) / 2;
      let len = ((w.x - ax) * c + (w.y - ay) * s) * end;
      len = clamp(free || !this.snap ? len : Math.round(len * 2) / 2, r.min, r.max);
      p.length = len;
      p.x = ax + (end * c * len) / 2;
      p.y = ay + (end * s * len) / 2;
    }
    this.rebuild();
  }

  private onUp(e: PointerEvent) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const p = this.part(d.id);
    if (d.kind === 'new' && p) {
      const r = this.canvas.getBoundingClientRect();
      const overCanvas = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      const w = this.eventWorld(e);
      const inBoard = w.x >= 0 && w.x <= BOARD_W && w.y >= 0 && w.y <= BOARD_H;
      if (!d.moved) {
        // a plain click/tap on a bin item: drop it somewhere free near the middle
        this.placeSomewhere(p);
      } else if (!overCanvas || !inBoard) {
        this.scene.parts = this.scene.parts.filter((x) => x !== p);
        this.selected = null;
      }
    }
    if (d.kind === 'move' && p) {
      const w = this.eventWorld(e);
      if (w.x < -0.5 || w.x > BOARD_W + 0.5 || w.y < -0.5 || w.y > BOARD_H + 0.5) {
        // dragged off the board: back to the bin
        this.scene.parts = this.scene.parts.filter((x) => x !== p);
        this.selected = null;
      }
    }
    this.rebuild();
    if (p && this.bad.has(p.id) && d.moved) this.toast('That spot overlaps something');
    this.commit(d.before);
    this.updateUI();
  }

  private placeSomewhere(p: Part) {
    const cx = BOARD_W / 2;
    const cy = BOARD_H / 2;
    for (let r = 0; r < 14; r += 0.5) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        p.x = this.snapV(cx + Math.cos(a) * r * 1.5, true);
        p.y = this.snapV(cy + Math.sin(a) * r, true);
        this.rebuild();
        if (!this.bad.has(p.id)) return;
        if (r === 0) break;
      }
    }
  }

  private onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (!$('overlay').classList.contains('hidden')) {
      if (e.key === 'Escape') this.hidePanel();
      return;
    }
    const k = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    const nudge = e.shiftKey ? 1 : 0.25;
    let handled = true;
    if (k === ' ') this.toggleRun();
    else if (ctrl && k === 'z' && !e.shiftKey) this.undo();
    else if ((ctrl && k === 'y') || (ctrl && e.shiftKey && k === 'z')) this.redo();
    else if (ctrl && k === 'd') this.duplicateSelected();
    else if (ctrl) handled = false;
    else if (k === 'p') this.togglePause();
    else if (k === 's') this.stepOnce();
    else if (k === ',' || k === '<') this.setSpeed(this.speedIdx - 1);
    else if (k === '.' || k === '>') this.setSpeed(this.speedIdx + 1);
    else if (k === 'escape') {
      this.ropeTool = null;
      this.selected = null;
      this.selectedRope = null;
      this.updateUI();
    } else if (k === 'delete' || k === 'backspace') this.deleteSelected();
    else if (k === 'q') this.rotateSelected(-(e.shiftKey ? Math.PI / 36 : ANGLE_SNAP));
    else if (k === 'e') this.rotateSelected(e.shiftKey ? Math.PI / 36 : ANGLE_SNAP);
    else if (k === '-' || k === '_') this.resizeSelected(-0.5);
    else if (k === '=' || k === '+') this.resizeSelected(0.5);
    else if (k === 'f') this.flipSelected();
    else if (k === 'n') this.pinSelected();
    else if (k === 'r') this.toggleRopeTool();
    else if (k === 't') this.toggleGhost();
    else if (k === 'g') this.toggleSnap();
    else if (k === 'h' || k === '?') this.showHelp();
    else if (k === 'm') this.showMenu();
    else if (k === 'arrowleft') this.nudgeSelected(-nudge, 0);
    else if (k === 'arrowright') this.nudgeSelected(nudge, 0);
    else if (k === 'arrowup') this.nudgeSelected(0, -nudge);
    else if (k === 'arrowdown') this.nudgeSelected(0, nudge);
    else handled = false;
    if (handled) e.preventDefault();
  }

  togglePause() {
    if (this.mode !== 'run') return;
    this.paused = !this.paused;
    this.updateUI();
  }

  stepOnce() {
    if (this.mode !== 'run') this.start();
    this.paused = true;
    for (let i = 0; i < 4; i++) this.stepSim();
    this.updateUI();
  }

  setSpeed(i: number) {
    this.speedIdx = clamp(i, 0, SPEEDS.length - 1);
    this.updateUI();
  }

  toggleGhost() {
    this.ghost = !this.ghost;
    this.ghostDirty = true;
    this.savePrefs();
    this.updateUI();
  }

  toggleSnap() {
    this.snap = !this.snap;
    this.savePrefs();
    this.updateUI();
  }

  private savePrefs() {
    store.savePrefs({
      snap: this.snap,
      ghost: this.ghost,
      muted: audio.isMuted(),
      music: this.musicWanted,
      musicVolume: music.getVolume(),
    });
  }

  // ---------------------------------------------------------------- UI

  private bindToolbar() {
    $('btn-run').onclick = () => this.toggleRun();
    $('btn-pause').onclick = () => this.togglePause();
    $('btn-stepf').onclick = () => this.stepOnce();
    $('btn-slower').onclick = () => this.setSpeed(this.speedIdx - 1);
    $('btn-faster').onclick = () => this.setSpeed(this.speedIdx + 1);
    $('btn-undo').onclick = () => this.undo();
    $('btn-redo').onclick = () => this.redo();
    $('btn-snap').onclick = () => this.toggleSnap();
    $('btn-ghost').onclick = () => this.toggleGhost();
    $('btn-clear').onclick = () => this.clearPlayerParts();
    $('btn-rotl').onclick = () => this.rotateSelected(-ANGLE_SNAP);
    $('btn-rotr').onclick = () => this.rotateSelected(ANGLE_SNAP);
    $('btn-flip').onclick = () => this.flipSelected();
    $('btn-pin').onclick = () => this.pinSelected();
    $('btn-del').onclick = () => this.deleteSelected();
    $('btn-help').onclick = () => this.showHelp();
    $('btn-menu').onclick = () => this.showMenu();
    $('btn-sound').onclick = () => {
      audio.setMuted(!audio.isMuted());
      music.setMuted(audio.isMuted());
      this.savePrefs();
      this.updateUI();
    };
    $('btn-share').onclick = () => {
      const url = `${location.origin}${location.pathname}#s=${store.encodeScene(this.scene)}`;
      void navigator.clipboard?.writeText(url).then(
        () => this.toast('Link copied to clipboard'),
        () => this.toast('Could not copy the link'),
      );
      history.replaceState(null, '', url);
    };
    // music can only start after a user gesture, so kick it off on the first one
    const kick = (e: Event) => {
      // let the music button's own click handle that case
      if ((e.target as HTMLElement)?.closest?.('#btn-music')) return;
      window.removeEventListener('pointerdown', kick);
      window.removeEventListener('keydown', kick);
      if (this.musicWanted) music.start();
      this.updateUI();
    };
    window.addEventListener('pointerdown', kick);
    window.addEventListener('keydown', kick);
    $('btn-music').onclick = () => {
      this.musicWanted = !music.isPlaying();
      if (this.musicWanted) music.start();
      else music.stop();
      this.savePrefs();
      this.updateUI();
    };
    const vol = $<HTMLInputElement>('music-vol');
    vol.value = String(music.getVolume());
    vol.oninput = () => {
      music.setVolume(Number(vol.value));
      if (!music.isPlaying() && Number(vol.value) > 0) {
        this.musicWanted = true;
        music.start();
        this.updateUI();
      }
    };
    vol.onchange = () => this.savePrefs();
    music.onTrack((t) => ($('btn-music').title = `Music: ${t.title}`));
    $('goals').addEventListener('click', (e) => {
      if ((e.target as HTMLElement).dataset.act === 'hint') {
        this.hintShown = true;
        this.updateGoals();
      }
    });
    $('overlay').addEventListener('pointerdown', (e) => {
      if (e.target === $('overlay') && this.level) this.hidePanel();
    });
  }

  private buildBinUI() {
    const wrap = $('bin-items');
    wrap.innerHTML = '';
    this.binEls.clear();
    const types: (PartType | 'rope')[] = this.sandbox
      ? [...BIN_ORDER, 'rope']
      : [...BIN_ORDER.filter((t) => (this.bin[t] ?? 0) > 0), ...((this.bin.rope ?? 0) > 0 ? ['rope' as const] : [])];
    for (const type of types) {
      const el = document.createElement('button');
      el.className = 'bin-item';
      const cv = document.createElement('canvas');
      cv.width = 144;
      cv.height = 104;
      drawIcon(cv, type);
      const label = document.createElement('span');
      label.textContent = type === 'rope' ? 'Rope' : PART_DEFS[type].name;
      const count = document.createElement('span');
      count.className = 'count';
      el.append(cv, label, count);
      el.addEventListener('pointerenter', () => this.showInfo(type));
      if (type === 'rope') el.onclick = () => this.toggleRopeTool();
      else {
        el.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          this.beginBinDrag(type, e);
        });
      }
      wrap.append(el);
      this.binEls.set(type, el);
    }
    if (!types.length) wrap.innerHTML = '<p style="color:var(--muted);font-size:13px;grid-column:1/-1">No parts this time.</p>';
  }

  private showInfo(type: PartType | 'rope' | null) {
    const el = $('info');
    if (type === 'rope') {
      el.innerHTML = `<b>Rope</b>Ties two things together. Pick it, click the first thing, optionally a pulley, then the second thing. <kbd>R</kbd>`;
    } else if (type) {
      const d = PART_DEFS[type];
      const keys = [
        d.rotate ? '<kbd>Q</kbd><kbd>E</kbd> rotate' : '',
        d.resize ? '<kbd>−</kbd><kbd>=</kbd> resize' : '',
        d.flip ? '<kbd>F</kbd> flip' : '',
        d.dynamic && this.sandbox ? '<kbd>N</kbd> pin' : '',
      ].filter(Boolean);
      el.innerHTML = `<b>${d.name}</b>${d.desc}${keys.length ? `<div style="margin-top:6px">${keys.join(' &nbsp;')}</div>` : ''}`;
    } else {
      el.innerHTML = `<b>Tip</b>Drag parts onto the board. Right-click a part to send it back. Press <kbd>Space</kbd> to run.`;
    }
  }

  updateUI() {
    const run = this.mode === 'run';
    const rb = $('btn-run');
    rb.textContent = run ? '■ Reset' : '▶ Start';
    rb.classList.toggle('running', run);
    $('edit-tools').classList.toggle('hidden', run);
    $('run-tools').classList.toggle('hidden', !run);
    $('btn-pause').textContent = this.paused ? '▶' : '❚❚';
    $('speed').textContent = `${SPEEDS[this.speedIdx]}×`;
    $('btn-snap').classList.toggle('on', this.snap);
    $('btn-music').classList.toggle('on', music.isPlaying());
    $('btn-ghost').classList.toggle('on', this.ghost);
    ($('btn-undo') as HTMLButtonElement).disabled = !this.undoStack.length;
    ($('btn-redo') as HTMLButtonElement).disabled = !this.redoStack.length;
    $('btn-sound').textContent = audio.isMuted() ? '🔇' : '🔊';
    $('btn-share').classList.toggle('hidden', !this.sandbox);
    $('level-title').innerHTML = this.level
      ? `${this.level.title}<small>puzzle ${this.levelIndex + 1} of ${LEVELS.length}</small>`
      : `Free Build<small>everything unlimited</small>`;
    for (const [type, el] of this.binEls) {
      const n = this.available(type as PartType | 'rope');
      el.querySelector('.count')!.textContent = n === Infinity ? '' : `×${n}`;
      el.classList.toggle('empty', n <= 0);
      el.classList.toggle('active', type === 'rope' && !!this.ropeTool);
    }
    const sel = this.selected && this.part(this.selected);
    const editable = !run && ((sel && !sel.locked) || (this.selectedRope && !this.scene.ropes.find((r) => r.id === this.selectedRope)?.locked));
    $('sel-tools').classList.toggle('hidden', !editable);
    const def = sel ? PART_DEFS[sel.type] : null;
    $('btn-rotl').classList.toggle('hidden', !def?.rotate);
    $('btn-rotr').classList.toggle('hidden', !def?.rotate);
    $('btn-flip').classList.toggle('hidden', !def?.flip);
    $('btn-pin').classList.toggle('hidden', !(def?.dynamic && this.sandbox));
    $('btn-pin').classList.toggle('on', !!sel && !!sel.pinned);
    this.showInfo(sel ? sel.type : this.ropeTool || this.selectedRope ? 'rope' : null);
    this.updateGoals();
  }

  private lastGoalsHtml = '';
  private hintShown = false;
  private updateGoals() {
    const el = $('goals');
    if (!this.level) {
      if (this.lastGoalsHtml) el.innerHTML = this.lastGoalsHtml = '';
      return;
    }
    const goals = this.level.goals
      .map((g) => `<div class="goal ${this.sim.goalMet(g) ? 'met' : ''}"><span class="tick"></span>${g.label}</div>`)
      .join('');
    const hint = this.level.hint
      ? this.hintShown
        ? `<div class="hint">Hint: ${this.level.hint}</div>`
        : `<button class="hint-btn" data-act="hint">Hint</button>`
      : '';
    const html = `<div class="blurb">${this.level.blurb}</div>${goals}${hint}`;
    if (html !== this.lastGoalsHtml) el.innerHTML = this.lastGoalsHtml = html;
  }

  toast(msg: string) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('show'), 2200);
  }

  showPanel(html: string) {
    $('panel').innerHTML = html;
    $('overlay').classList.remove('hidden');
  }

  hidePanel() {
    $('overlay').classList.add('hidden');
  }

  private panelAction(act: string, fn: () => void) {
    const b = $('panel').querySelector<HTMLElement>(`[data-act="${act}"]`);
    if (b) b.onclick = fn;
  }

  showMenu() {
    if (this.mode === 'run') this.stop();
    const solved = store.loadProgress();
    const cards = LEVELS.map(
      (l, i) => `<button class="level-card ${solved[l.id] ? 'solved' : ''}" data-act="lvl${i}">
        <span class="num">Puzzle ${i + 1}</span><span class="name">${l.title}</span></button>`,
    ).join('');
    this.showPanel(`
      <h1>TIM</h1>
      <p>A tribute to <i>The Incredible Machine</i>. Build silly contraptions to solve each puzzle, then press Start and watch it go.</p>
      <div class="level-grid">
        ${cards}
        <button class="level-card sandbox" data-act="sandbox"><span class="num">Free Build</span><span class="name">Every part, unlimited</span></button>
      </div>
      <div class="actions">
        <button data-act="help">Controls</button>
        ${this.levelIndex >= 0 || this.sandbox ? '<button class="primary" data-act="close">Back to the board</button>' : ''}
      </div>`);
    LEVELS.forEach((_, i) =>
      this.panelAction(`lvl${i}`, () => {
        this.hidePanel();
        this.loadLevel(i);
      }),
    );
    this.panelAction('sandbox', () => {
      this.hidePanel();
      this.loadSandbox();
    });
    this.panelAction('help', () => this.showHelp());
    this.panelAction('close', () => this.hidePanel());
  }

  showHelp() {
    this.showPanel(`
      <h1>Controls</h1>
      <h3>Building</h3>
      <dl class="keys">
        <dt>Drag from bin</dt><dd>Place a part (tap to drop it in the middle)</dd>
        <dt>Drag / right-click</dt><dd>Move a part / send it back to the bin</dd>
        <dt><kbd>Q</kbd> <kbd>E</kbd> or wheel</dt><dd>Rotate 15° (hold <kbd>Shift</kbd> for 5°) — or drag the blue knob</dd>
        <dt><kbd>−</kbd> <kbd>=</kbd></dt><dd>Shrink / grow walls, belts and trampolines — or drag the yellow knobs</dd>
        <dt><kbd>F</kbd></dt><dd>Flip conveyors, fans and teeter-totters</dd>
        <dt><kbd>R</kbd></dt><dd>Rope tool: click A, (optional pulley), then B</dd>
        <dt><kbd>N</kbd></dt><dd>Pin a loose part in place (Free Build)</dd>
        <dt>Arrows</dt><dd>Nudge ¼ square (<kbd>Shift</kbd> for 1)</dd>
        <dt><kbd>Ctrl</kbd>+<kbd>D</kbd></dt><dd>Duplicate</dd>
        <dt><kbd>Del</kbd></dt><dd>Remove selected part or rope</dd>
        <dt><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Y</kbd></dt><dd>Undo / redo</dd>
        <dt><kbd>G</kbd></dt><dd>Toggle grid snap (hold <kbd>Alt</kbd> while dragging to ignore it)</dd>
        <dt><kbd>T</kbd></dt><dd>Toggle trajectory preview</dd>
      </dl>
      <h3>Running</h3>
      <dl class="keys">
        <dt><kbd>Space</kbd></dt><dd>Start / reset</dd>
        <dt><kbd>P</kbd></dt><dd>Pause</dd>
        <dt><kbd>S</kbd></dt><dd>Step a few frames</dd>
        <dt><kbd>,</kbd> <kbd>.</kbd></dt><dd>Slower / faster (¼× to 4×)</dd>
        <dt><kbd>M</kbd></dt><dd>Puzzle menu</dd>
      </dl>
      <div class="actions"><button class="primary" data-act="close">Got it</button></div>`);
    this.panelAction('close', () => this.hidePanel());
  }
}

// ---------------------------------------------------------------- helpers

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function normAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** draws a part into a bin icon by building it in a throwaway world */
function drawIcon(cv: HTMLCanvasElement, type: PartType | 'rope') {
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, cv.width, cv.height);
  if (type === 'rope') {
    g.translate(cv.width / 2, cv.height / 2);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-40, -22);
    g.bezierCurveTo(-10, 40, 10, -40, 40, 22);
    g.lineWidth = 9;
    g.strokeStyle = '#141722';
    g.stroke();
    g.lineWidth = 5;
    g.strokeStyle = '#d8c08a';
    g.stroke();
    return;
  }
  const def = PART_DEFS[type];
  const p = defaultPart(type, 0, 0, 'icon');
  if (def.resize) p.length = Math.min(def.resize.def, type === 'seesaw' ? 5 : 4);
  const sim = new Sim({ parts: [p], ropes: [] });
  const b = def.bounds(p);
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  const s = Math.min((cv.width - 16) / w, (cv.height - 16) / h, 60);
  g.translate(cv.width / 2, cv.height / 2);
  g.scale(s, s);
  g.translate(-(b.x0 + b.x1) / 2, -(b.y0 + b.y1) / 2);
  if (type === 'fan') {
    g.save();
    g.beginPath();
    g.rect(b.x0, b.y0, w, h);
    g.clip();
  }
  PART_DEFS[type].draw(g, sim.insts.get('icon')!, 0.3);
  if (type === 'fan') g.restore();
}
