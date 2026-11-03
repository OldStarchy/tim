import * as audio from './audio';
import * as music from './music';
import { LEVELS } from './levels';
import { BOARD_H, BOARD_W, Belt, Bin, Level, Link, Part, PartType, Rope, Scene, cloneScene, newId } from './model';
import { BIN_ORDER, type Category, PART_DEFS, defaultPart, hitPart } from './parts';
import {
  Camera,
  Particle,
  Trail,
  drawBoard,
  drawGoalMarkers,
  drawParticles,
  drawParts,
  drawBelts,
  drawRopes,
  drawSelection,
  drawTrails,
  partHandles,
} from './render';
import { DT, Sim, driveWorld, findOverlaps, ropeAnchorWorld, ropeSegments } from './sim';
import * as store from './storage';

type Mode = 'edit' | 'run';

interface Drag {
  kind: 'move' | 'new' | 'rotate' | 'resize' | 'box';
  id: string;
  /** other selected parts moving along with the grabbed one: start positions */
  group?: { id: string; x: number; y: number }[];
  /** marquee start (world) */
  bx?: number;
  by?: number;
  additive?: boolean;
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
  kind: Link;
  from?: string;
  fromEnd?: number;
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

  /** current selection; most single-part tools act when exactly one part is selected */
  sel = new Set<string>();
  box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private clipboard: Scene | null = null;
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
      // drop anything the (possibly since-changed) level no longer allows
      const ids = new Set(this.scene.parts.map((p) => p.id));
      const left: Bin = { ...lvl.bin };
      for (const p of saved.parts) {
        if (ids.has(p.id) || !PART_DEFS[p.type] || !((left[p.type] ?? 0) > 0)) continue;
        left[p.type]!--;
        this.scene.parts.push({ ...p, locked: false });
      }
      for (const r of saved.ropes) {
        if (r.locked || !((left.rope ?? 0) > 0)) continue;
        left.rope!--;
        this.scene.ropes.push(r);
      }
      for (const b of saved.belts ?? []) {
        if (b.locked || !((left.belt ?? 0) > 0)) continue;
        left.belt!--;
        this.belts.push(b);
      }
      this.pruneRopes();
    }
    this.bin = { ...lvl.bin };
    this.afterLoad();
    location.hash = `#level=${lvl.id}`;
  }

  loadSandbox(scene?: Scene) {
    this.level = null;
    this.levelIndex = -1;
    this.scene = cloneScene(scene ?? store.loadSandbox() ?? { parts: [], ropes: [] });
    for (const p of this.scene.parts) p.locked = false;
    for (const r of this.scene.ropes) r.locked = false;
    for (const b of this.belts) b.locked = false;
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

  /** trajectory preview would give puzzles away, so it's a Free Build tool */
  get previewOn() {
    return this.ghost && this.sandbox;
  }

  get selected(): string | null {
    return this.sel.size === 1 ? [...this.sel][0] : null;
  }
  set selected(id: string | null) {
    this.sel = new Set(id ? [id] : []);
  }

  /** selected parts the player may edit */
  private selParts(): Part[] {
    return this.scene.parts.filter((p) => this.sel.has(p.id) && !p.locked);
  }

  get sandbox() {
    return this.level === null;
  }

  get belts(): Belt[] {
    return (this.scene.belts ??= []);
  }

  available(type: PartType | Link): number {
    if (this.sandbox) return Infinity;
    const total = this.bin[type] ?? 0;
    const used =
      type === 'rope'
        ? this.scene.ropes.filter((r) => !r.locked).length
        : type === 'belt'
          ? this.belts.filter((b) => !b.locked).length
          : this.scene.parts.filter((p) => !p.locked && p.type === type).length;
    return total - used;
  }

  private persist() {
    if (this.sandbox) store.saveSandbox(this.scene);
    else if (this.level)
      store.saveLevelScene(this.level.id, {
        parts: this.scene.parts.filter((p) => !p.locked),
        ropes: this.scene.ropes.filter((r) => !r.locked),
        belts: this.belts.filter((b) => !b.locked),
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
      } else if (e.kind === 'boom') {
        audio.boom();
        this.burst(e.x, e.y, 40, 14, ['#ffd666', '#ff8a3d', '#e8463c', '#5d5d66'], 0.9, 0.3);
        this.particles.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0.5, max: 0.5, color: '#ffd666', size: 4, ring: true });
      } else if (e.kind === 'shatter') {
        audio.shatter();
        const c = Math.cos(e.angle);
        const sn = Math.sin(e.angle);
        for (let i = 0; i < 26; i++) {
          const k = (Math.random() - 0.5) * e.length;
          this.particles.push({
            x: e.x + c * k,
            y: e.y + sn * k,
            vx: (Math.random() - 0.5) * 6,
            vy: (Math.random() - 0.7) * 6,
            life: 0.9,
            max: 0.9,
            color: i % 3 ? 'rgba(190,230,255,0.9)' : '#ffffff',
            size: 0.1 + Math.random() * 0.08,
          });
        }
      } else if (e.kind === 'snap') {
        audio.snap();
      } else if (e.kind === 'cut') {
        audio.snip();
        this.burst(e.x, e.y, 6, 3, ['#d8c08a'], 0.4, 0.08);
      } else if (e.kind === 'ring') {
        audio.ring();
        this.particles.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0.6, max: 0.6, color: '#ffd666', size: 1.2, ring: true });
      } else if (e.kind === 'squeak') {
        audio.squeak();
      } else if (e.kind === 'ignite') {
        audio.ignite();
        this.burst(e.x, e.y, 8, 2.5, ['#ffb02e', '#fff3b0'], 0.4, 0.08);
      } else if (e.kind === 'spark') {
        audio.spark();
        this.burst(e.x, e.y, 22, 9, ['#fff3b0', '#ffd666', '#ff9a2e'], 0.35, 0.07);
      } else if (e.kind === 'launch') {
        audio.launch();
      } else if (e.kind === 'smoke') {
        this.particles.push({
          x: e.x,
          y: e.y,
          vx: e.vx + (Math.random() - 0.5) * 1.5,
          vy: e.vy + (Math.random() - 0.5) * 1.5,
          life: 0.9,
          max: 0.9,
          color: Math.random() < 0.3 ? '#ffb02e' : 'rgba(200,205,215,0.7)',
          size: 0.22 + Math.random() * 0.15,
          drift: true,
        });
      } else if (e.kind === 'puff') {
        audio.puff();
        this.burst(e.x, e.y, 6, 1.2, ['rgba(200,205,215,0.8)'], 0.8, 0.14);
      } else if (e.kind === 'burn') {
        audio.ignite();
        this.burst(e.x, e.y, 10, 2, ['#ffb02e', '#5d5d66'], 0.6, 0.1);
      } else if (e.kind === 'meow') {
        audio.meow();
      }
    }
    if (this.level && !this.won) {
      const all = this.level.goals.every((g) => this.sim.goalMet(g));
      this.holdTime = all ? this.holdTime + DT : 0;
      if (this.holdTime >= 0.25) this.win();
    }
  }

  private burst(x: number, y: number, n: number, speed: number, colors: string[], life: number, size: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life,
        max: life,
        color: colors[i % colors.length],
        size: size * (0.6 + Math.random() * 0.8),
      });
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
    if (this.mode !== 'edit' || !this.previewOn) {
      this.ghostJob = null;
      if (!this.previewOn) this.trails = [];
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
      if (p.drift) {
        p.vx *= 0.96;
        p.vy = p.vy * 0.96 - 1.5 * dt;
      } else if (!p.ring) p.vy += 12 * dt;
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
    if (this.mode === 'edit' && this.previewOn) drawTrails(g, this.trails);
    const order = this.scene.parts.map((p) => p.id);
    drawParts(g, this.sim, simT, order);
    drawBelts(g, this.sim.belts, this.selectedRope ?? undefined);
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

    if (this.mode === 'edit' && this.sel.size) {
      const single = this.sel.size === 1;
      for (const id of this.sel) {
        const p = this.part(id);
        if (p && !p.locked) drawSelection(g, p, this.cam.scale, this.bad.has(p.id), single);
        else if (p) this.tintPart(p.id, 'rgba(255,214,102,0.25)');
      }
    }
    if (this.box) {
      const b = this.box;
      g.fillStyle = 'rgba(127,196,240,0.12)';
      g.fillRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
      g.setLineDash([6 / this.cam.scale, 4 / this.cam.scale]);
      g.lineWidth = 1.5 / this.cam.scale;
      g.strokeStyle = '#7fc4f0';
      g.strokeRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
      g.setLineDash([]);
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

  /** every point a rope (or belt) could attach to right now */
  private linkPoints(kind: Link): { part: Part; end: number; x: number; y: number }[] {
    const out: { part: Part; end: number; x: number; y: number }[] = [];
    for (const p of this.scene.parts) {
      const def = PART_DEFS[p.type];
      const inst = this.sim.insts.get(p.id);
      if (!inst) continue;
      if (kind === 'rope' && def.ropeAnchors) {
        def.ropeAnchors(p).forEach((_, end) => out.push({ part: p, end, ...ropeAnchorWorld(inst, end) }));
      } else if (kind === 'belt' && def.drives) {
        def.drives(p).forEach((_, end) => out.push({ part: p, end, ...driveWorld(p, end) }));
      }
    }
    return out;
  }

  private drawRopeTool() {
    const g = this.g;
    const px = 1 / this.cam.scale;
    const tool = this.ropeTool!;
    const color = tool.kind === 'belt' ? '#7fc4f0' : '#ffd666';
    const dot = (x: number, y: number, chosen: boolean) => {
      g.beginPath();
      g.arc(x, y, (chosen ? 9 : 6 + Math.sin(this.wallTime * 6) * 1.5) * px, 0, Math.PI * 2);
      g.fillStyle = chosen ? color : tool.kind === 'belt' ? 'rgba(127,196,240,0.35)' : 'rgba(255,214,102,0.35)';
      g.fill();
      g.lineWidth = 2 * px;
      g.strokeStyle = color;
      g.stroke();
    };
    for (const pt of this.linkPoints(tool.kind)) dot(pt.x, pt.y, pt.part.id === tool.from && pt.end === tool.fromEnd);
    if (tool.kind === 'rope' && tool.from && !tool.via) {
      for (const p of this.scene.parts) if (p.type === 'pulley') dot(p.x, p.y, false);
    }
    if (tool.via) {
      const v = this.part(tool.via);
      if (v) dot(v.x, v.y, true);
    }
    if (tool.from && this.hover) {
      const start = this.linkPoints(tool.kind).find((pt) => pt.part.id === tool.from && pt.end === tool.fromEnd);
      if (!start) return;
      g.beginPath();
      g.moveTo(start.x, start.y);
      if (tool.via) {
        const v = this.part(tool.via)!;
        g.lineTo(v.x, v.y - 0.4);
      }
      g.lineTo(this.hover.x, this.hover.y);
      g.setLineDash([6 * px, 5 * px]);
      g.lineWidth = 2.5 * px;
      g.strokeStyle = tool.kind === 'belt' ? '#7a8296' : '#d8c08a';
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
    this.sel = new Set([...this.sel].filter((id) => this.part(id)));
    this.selectedRope = null;
    this.rebuild();
    this.persist();
    this.updateUI();
  }

  private pruneRopes() {
    const ids = new Set(this.scene.parts.map((p) => p.id));
    this.scene.ropes = this.scene.ropes.filter((r) => ids.has(r.a) && ids.has(r.b) && (!r.via || ids.has(r.via)));
    this.scene.belts = this.belts.filter((b) => ids.has(b.a) && ids.has(b.b));
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
      const id = this.selectedRope;
      const r = this.scene.ropes.find((r) => r.id === id);
      if (r && !r.locked) this.mutate(() => (this.scene.ropes = this.scene.ropes.filter((x) => x !== r)));
      const b = this.belts.find((b) => b.id === id);
      if (b && !b.locked) this.mutate(() => (this.scene.belts = this.belts.filter((x) => x !== b)));
      this.selectedRope = null;
      this.updateUI();
      return;
    }
    const doomed = new Set(this.selParts().map((p) => p.id));
    if (!doomed.size) return;
    this.mutate(() => (this.scene.parts = this.scene.parts.filter((x) => !doomed.has(x.id))));
    this.sel.clear();
    this.updateUI();
  }

  /** parts + the ropes running entirely between them */
  private selectionAsScene(): Scene | null {
    const parts = this.selParts();
    if (!parts.length) return null;
    const ids = new Set(parts.map((p) => p.id));
    const ropes = this.scene.ropes.filter((r) => !r.locked && ids.has(r.a) && ids.has(r.b) && (!r.via || ids.has(r.via)));
    const belts = this.belts.filter((b) => !b.locked && ids.has(b.a) && ids.has(b.b));
    return cloneScene({ parts, ropes, belts });
  }

  /** adds a copy of `src` offset by (dx, dy) if the bin allows it; selects the copies */
  private pasteScene(src: Scene, dx: number, dy: number): boolean {
    const need: Record<string, number> = {};
    for (const p of src.parts) need[p.type] = (need[p.type] ?? 0) + 1;
    if (src.ropes.length) need.rope = src.ropes.length;
    if (src.belts?.length) need.belt = src.belts.length;
    for (const [type, n] of Object.entries(need)) {
      if (this.available(type as PartType | Link) < n) {
        const name = type === 'rope' || type === 'belt' ? `${type}s` : PART_DEFS[type as PartType].name.toLowerCase() + 's';
        this.toast(`Not enough ${name} left in the bin`);
        return false;
      }
    }
    const map = new Map<string, string>();
    const parts = src.parts.map((p) => {
      const id = newId();
      map.set(p.id, id);
      return { ...p, id, locked: false, x: p.x + dx, y: p.y + dy };
    });
    const ropes = src.ropes.map((r) => ({
      ...r,
      id: newId('r'),
      locked: false,
      a: map.get(r.a)!,
      b: map.get(r.b)!,
      via: r.via ? map.get(r.via) : undefined,
    }));
    const belts = (src.belts ?? []).map((b) => ({ ...b, id: newId('b'), locked: false, a: map.get(b.a)!, b: map.get(b.b)! }));
    this.mutate(() => {
      this.scene.parts.push(...parts);
      this.scene.ropes.push(...ropes);
      this.belts.push(...belts);
    });
    this.sel = new Set(parts.map((p) => p.id));
    this.selectedRope = null;
    this.updateUI();
    return true;
  }

  duplicateSelected() {
    const src = this.selectionAsScene();
    if (!src) return;
    // nearest offset where the copy fits on the board without overlapping anything
    const xs = src.parts.map((p) => p.x);
    const ys = src.parts.map((p) => p.y);
    const w = Math.max(...xs) - Math.min(...xs) + 1.5;
    const h = Math.max(...ys) - Math.min(...ys) + 1.5;
    const tries: [number, number][] = [[1, -1], [w, 0], [-w, 0], [0, h], [0, -h], [w, h], [-w, -h], [w, -h], [-w, h]];
    for (const [dx, dy] of tries) {
      const sx = this.snapV(dx, true);
      const sy = this.snapV(dy, true);
      const moved = src.parts.map((p) => ({ ...p, id: `dup-${p.id}`, x: p.x + sx, y: p.y + sy }));
      if (moved.some((p) => p.x < 0 || p.x > BOARD_W || p.y < 0 || p.y > BOARD_H)) continue;
      const bad = findOverlaps(new Sim({ parts: [...this.scene.parts, ...moved], ropes: [] }));
      if (moved.some((p) => bad.has(p.id))) continue;
      this.pasteScene(src, sx, sy);
      return;
    }
    this.pasteScene(src, 1, -1);
  }

  copySelected() {
    const src = this.selectionAsScene();
    if (!src) return;
    this.clipboard = src;
    this.toast(`Copied ${src.parts.length} part${src.parts.length > 1 ? 's' : ''}`);
  }

  cutSelected() {
    const src = this.selectionAsScene();
    if (!src) return;
    this.clipboard = src;
    this.deleteSelected();
  }

  paste() {
    const src = this.clipboard;
    if (!src || this.mode !== 'edit') return;
    // centre the pasted group on the mouse if it's over the board, else offset from the original
    const cx = src.parts.reduce((t, p) => t + p.x, 0) / src.parts.length;
    const cy = src.parts.reduce((t, p) => t + p.y, 0) / src.parts.length;
    const h = this.hover;
    const onBoard = h && h.x >= 0 && h.x <= BOARD_W && h.y >= 0 && h.y <= BOARD_H;
    const dx = onBoard ? this.snapV(h!.x - cx, true) : 1;
    const dy = onBoard ? this.snapV(h!.y - cy, true) : -1;
    this.pasteScene(src, dx, dy);
  }

  selectAll() {
    if (this.mode !== 'edit') return;
    this.sel = new Set(this.scene.parts.filter((p) => !p.locked).map((p) => p.id));
    this.selectedRope = null;
    this.updateUI();
  }

  private editSelected(fn: (p: Part) => void) {
    const parts = this.selParts();
    if (!parts.length || this.mode !== 'edit') return;
    this.mutate(() => parts.forEach(fn));
  }

  rotateSelected(delta: number) {
    const parts = this.selParts();
    if (parts.length > 1) {
      // turn the whole group about its centre
      const cx = parts.reduce((t, p) => t + p.x, 0) / parts.length;
      const cy = parts.reduce((t, p) => t + p.y, 0) / parts.length;
      const c = Math.cos(delta);
      const sn = Math.sin(delta);
      this.editSelected((p) => {
        const dx = p.x - cx;
        const dy = p.y - cy;
        p.x = cx + dx * c - dy * sn;
        p.y = cy + dx * sn + dy * c;
        if (PART_DEFS[p.type].rotate) p.angle = normAngle(p.angle + delta);
      });
      return;
    }
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
    // pin all unless they're all pinned already
    const dyn = this.selParts().filter((p) => PART_DEFS[p.type].dynamic);
    const pin = !dyn.every((p) => p.pinned);
    this.editSelected((p) => {
      if (PART_DEFS[p.type].dynamic) p.pinned = pin;
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
      this.scene.belts = this.belts.filter((b) => b.locked);
    });
    this.selected = null;
    this.updateUI();
  }

  private snapV(v: number, force = false) {
    return this.snap || force ? Math.round(v * 4) / 4 : v;
  }

  // ---------------------------------------------------------------- rope tool

  toggleRopeTool(kind: Link = 'rope') {
    if (this.mode !== 'edit') return;
    if (this.ropeTool?.kind === kind) {
      this.ropeTool = null;
    } else {
      if (this.available(kind) <= 0) {
        this.toast(`No ${kind}s left in the bin`);
        return;
      }
      this.ropeTool = { kind };
      this.sel.clear();
      this.toast(
        kind === 'rope'
          ? 'Click an attach point to start the rope — Esc to cancel'
          : 'Click a motor, gear or conveyor hub to start the belt — Esc to cancel',
      );
    }
    this.updateUI();
  }

  /** nearest attach point under the cursor, else the nearest one on the part under the cursor */
  private pickLinkPoint(kind: Link, wx: number, wy: number) {
    const pts = this.linkPoints(kind);
    const tol = 14 / this.cam.scale;
    let best: (typeof pts)[number] | undefined;
    let bestD = Infinity;
    for (const pt of pts) {
      const d = Math.hypot(pt.x - wx, pt.y - wy);
      if (d < bestD) {
        bestD = d;
        best = pt;
      }
    }
    if (best && bestD <= tol) return best;
    const part = this.hitTest(wx, wy, (p) => pts.some((pt) => pt.part === p));
    if (!part) return undefined;
    return pts
      .filter((pt) => pt.part === part)
      .sort((a, b) => Math.hypot(a.x - wx, a.y - wy) - Math.hypot(b.x - wx, b.y - wy))[0];
  }

  private ropeClick(wx: number, wy: number) {
    const tool = this.ropeTool!;
    if (tool.kind === 'rope' && tool.from && !tool.via) {
      const pulley = this.hitTest(wx, wy, (p) => p.type === 'pulley');
      if (pulley) {
        tool.via = pulley.id;
        audio.click();
        return;
      }
    }
    const pick = this.pickLinkPoint(tool.kind, wx, wy);
    if (!pick) {
      this.ropeTool = null;
      this.updateUI();
      return;
    }
    if (!tool.from) {
      tool.from = pick.part.id;
      tool.fromEnd = pick.end;
      audio.click();
      return;
    }
    if (pick.part.id === tool.from && (tool.kind === 'belt' || pick.end === tool.fromEnd)) return;
    const a = this.part(tool.from)!;
    if (tool.kind === 'rope') {
      if (!PART_DEFS[a.type].dynamic && !PART_DEFS[pick.part.type].dynamic) {
        this.toast('A rope between two fixed things would do nothing');
        return;
      }
      const rope: Rope = { id: newId('r'), a: tool.from, b: pick.part.id, aEnd: tool.fromEnd, bEnd: pick.end, via: tool.via };
      this.mutate(() => this.scene.ropes.push(rope));
      this.selectedRope = rope.id;
    } else {
      const belt: Belt = { id: newId('b'), a: tool.from, b: pick.part.id, aEnd: tool.fromEnd, bEnd: pick.end };
      this.mutate(() => this.belts.push(belt));
      this.selectedRope = belt.id;
    }
    audio.click();
    this.ropeTool = null;
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

  /** a rope or belt under the cursor */
  private hitRope(wx: number, wy: number): { id: string } | undefined {
    const tol = 8 / this.cam.scale;
    for (const r of this.sim.ropes) {
      if (r.a.removed || r.b.removed) continue;
      for (const [a, b] of ropeSegments(r)) if (segDist(wx, wy, a.x, a.y, b.x, b.y) < tol) return r.rope;
    }
    for (const b of this.sim.belts) {
      const A = driveWorld(b.a.part, b.belt.aEnd);
      const B = driveWorld(b.b.part, b.belt.bEnd);
      if (segDist(wx, wy, A.x, A.y, B.x, B.y) < tol + A.r) return b.belt;
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
        if (this.mode !== 'edit' || !this.selParts().length) return;
        const p = this.selected ? this.part(this.selected) : null;
        if (p && !PART_DEFS[p.type].rotate) return;
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
        // right-clicking part of a multi-selection sends the whole group back
        if (!this.sel.has(p.id)) this.selected = p.id;
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
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const p = this.hitTest(w.x, w.y);
    if (p) {
      this.selectedRope = null;
      if (additive) {
        // shift/ctrl-click toggles a part in or out of the selection
        if (this.sel.has(p.id)) this.sel.delete(p.id);
        else if (!p.locked) this.sel.add(p.id);
        this.sel = new Set([...this.sel].filter((id) => !this.part(id)?.locked));
        this.updateUI();
        return;
      }
      if (!this.sel.has(p.id) || p.locked) this.selected = p.id;
      if (!p.locked) {
        const group = this.selParts()
          .filter((q) => q.id !== p.id)
          .map((q) => ({ id: q.id, x: q.x, y: q.y }));
        this.drag = { kind: 'move', id: p.id, ox: w.x - p.x, oy: w.y - p.y, group, before, moved: false, sx: e.clientX, sy: e.clientY };
        this.canvas.setPointerCapture(e.pointerId);
      }
      this.updateUI();
      return;
    }
    const r = this.hitRope(w.x, w.y);
    if (r) {
      this.sel.clear();
      this.selectedRope = r.id;
      this.updateUI();
      return;
    }
    // empty space: start a box selection
    if (!additive) this.sel.clear();
    this.selectedRope = null;
    this.drag = { kind: 'box', id: '', ox: 0, oy: 0, bx: w.x, by: w.y, additive, before, moved: false, sx: e.clientX, sy: e.clientY };
    this.canvas.setPointerCapture(e.pointerId);
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
    if (d.kind === 'box') {
      this.box = { x0: d.bx!, y0: d.by!, x1: w.x, y1: w.y };
      return;
    }
    const p = this.part(d.id);
    if (!p) return;
    const free = e.altKey;
    if (d.kind === 'move' || d.kind === 'new') {
      const x0 = p.x;
      const y0 = p.y;
      p.x = free ? w.x - d.ox : this.snapV(w.x - d.ox);
      p.y = free ? w.y - d.oy : this.snapV(w.y - d.oy);
      if (d.group?.length) {
        // the grabbed part leads; the rest keep their offsets from it
        const lead = d.group.length ? { dx: p.x - x0, dy: p.y - y0 } : null;
        for (const gp of d.group) {
          const q = this.part(gp.id);
          if (q && lead) {
            q.x += lead.dx;
            q.y += lead.dy;
          }
        }
      }
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
    if (d.kind === 'box') {
      const b = this.box;
      this.box = null;
      if (b) {
        const x0 = Math.min(b.x0, b.x1);
        const x1 = Math.max(b.x0, b.x1);
        const y0 = Math.min(b.y0, b.y1);
        const y1 = Math.max(b.y0, b.y1);
        const inside = this.scene.parts.filter((p) => !p.locked && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1);
        if (!d.additive) this.sel.clear();
        for (const p of inside) this.sel.add(p.id);
      }
      this.updateUI();
      return;
    }
    const p = this.part(d.id);
    if (d.kind === 'move' && !d.moved && d.group?.length) {
      this.selected = d.id;
      this.updateUI();
      return;
    }
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
        // dragged off the board: back to the bin (the whole group, if it was one)
        const gone = new Set([p.id, ...(d.group ?? []).map((g) => g.id)]);
        this.scene.parts = this.scene.parts.filter((x) => !gone.has(x.id));
        this.pruneRopes();
        this.sel.clear();
      }
    }
    this.rebuild();
    const moved = [d.id, ...(d.group ?? []).map((g) => g.id)];
    if (d.moved && moved.some((id) => this.bad.has(id))) this.toast('That spot overlaps something');
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
    else if (ctrl && k === 'c') this.copySelected();
    else if (ctrl && k === 'x') this.cutSelected();
    else if (ctrl && k === 'v') this.paste();
    else if (ctrl && k === 'a') this.selectAll();
    else if (ctrl) handled = false;
    else if (k === 'p') this.togglePause();
    else if (k === 's') this.stepOnce();
    else if (k === ',' || k === '<') this.setSpeed(this.speedIdx - 1);
    else if (k === '.' || k === '>') this.setSpeed(this.speedIdx + 1);
    else if (k === 'escape') {
      this.ropeTool = null;
      this.sel.clear();
      this.box = null;
      this.selectedRope = null;
      this.updateUI();
    } else if (k === 'delete' || k === 'backspace') this.deleteSelected();
    else if (k === 'q') this.rotateSelected(-(e.shiftKey ? Math.PI / 36 : ANGLE_SNAP));
    else if (k === 'e') this.rotateSelected(e.shiftKey ? Math.PI / 36 : ANGLE_SNAP);
    else if (k === '-' || k === '_') this.resizeSelected(-0.5);
    else if (k === '=' || k === '+') this.resizeSelected(0.5);
    else if (k === 'f') this.flipSelected();
    else if (k === 'n') this.pinSelected();
    else if (k === 'r') this.toggleRopeTool('rope');
    else if (k === 'b') this.toggleRopeTool('belt');
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
    if (!this.sandbox) {
      this.toast('Trajectory preview is only available in Free Build');
      return;
    }
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
    const has = (t: PartType | Link) => this.sandbox || (this.bin[t] ?? 0) > 0;
    // links live with the category they belong to
    const groups: { title: Category; types: (PartType | Link)[] }[] = (
      ['Balls', 'Building', 'Contraptions', 'Fire & Light', 'Power', 'Critters'] as Category[]
    ).map((title) => ({
      title,
      types: [
        ...BIN_ORDER.filter((t) => PART_DEFS[t].category === title),
        ...(title === 'Building' ? (['rope'] as const) : title === 'Power' ? (['belt'] as const) : []),
      ].filter(has),
    }));
    let total = 0;
    const showHeadings = groups.filter((g) => g.types.length).length > 1;
    for (const group of groups) {
      if (!group.types.length) continue;
      if (showHeadings) {
        const h = document.createElement('div');
        h.className = 'bin-heading';
        h.textContent = group.title;
        wrap.append(h);
      }
      for (const type of group.types) {
        total++;
        const el = document.createElement('button');
        el.className = 'bin-item';
        const cv = document.createElement('canvas');
        cv.width = 144;
        cv.height = 104;
        drawIcon(cv, type);
        const label = document.createElement('span');
        label.textContent = type === 'rope' ? 'Rope' : type === 'belt' ? 'Drive Belt' : PART_DEFS[type].name;
        const count = document.createElement('span');
        count.className = 'count';
        el.append(cv, label, count);
        el.addEventListener('pointerenter', () => this.showInfo(type));
        if (type === 'rope' || type === 'belt') el.onclick = () => this.toggleRopeTool(type);
        else {
          el.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            this.beginBinDrag(type, e);
          });
        }
        wrap.append(el);
        this.binEls.set(type, el);
      }
    }
    if (!total) wrap.innerHTML = '<p style="color:var(--muted);font-size:13px;grid-column:1/-1">No parts this time.</p>';
  }

  private showMulti(n: number) {
    $('info').innerHTML = `<b>${n} parts selected</b>Drag any of them to move the group.
      <div style="margin-top:6px"><kbd>Q</kbd><kbd>E</kbd> rotate group &nbsp;<kbd>Ctrl</kbd>+<kbd>D</kbd> duplicate &nbsp;<kbd>Ctrl</kbd>+<kbd>C</kbd>/<kbd>V</kbd> copy/paste &nbsp;<kbd>Del</kbd> remove</div>`;
  }

  private showInfo(type: PartType | Link | null) {
    const el = $('info');
    if (type === 'belt') {
      el.innerHTML = `<b>Drive Belt</b>Carries power: pick it, then click two hubs (motor, mouse motor, gear or conveyor roller). Both ends turn the same way. <kbd>B</kbd>`;
    } else if (type === 'rope') {
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
    $('btn-ghost').classList.toggle('hidden', !this.sandbox);
    ($('btn-undo') as HTMLButtonElement).disabled = !this.undoStack.length;
    ($('btn-redo') as HTMLButtonElement).disabled = !this.redoStack.length;
    $('btn-sound').textContent = audio.isMuted() ? '🔇' : '🔊';
    $('btn-share').classList.toggle('hidden', !this.sandbox);
    $('level-title').innerHTML = this.level
      ? `${this.level.title}<small>puzzle ${this.levelIndex + 1} of ${LEVELS.length}</small>`
      : `Free Build<small>everything unlimited</small>`;
    for (const [type, el] of this.binEls) {
      const n = this.available(type as PartType | Link);
      el.querySelector('.count')!.textContent = n === Infinity ? '' : `×${n}`;
      el.classList.toggle('empty', n <= 0);
      el.classList.toggle('active', this.ropeTool?.kind === type);
    }
    const sel = this.selected && this.part(this.selected);
    const many = this.selParts();
    const multi = many.length > 1;
    const editable =
      !run && (many.length > 0 || (this.selectedRope && !this.scene.ropes.find((r) => r.id === this.selectedRope)?.locked));
    $('sel-tools').classList.toggle('hidden', !editable);
    const defs = many.map((p) => PART_DEFS[p.type]);
    $('btn-rotl').classList.toggle('hidden', !(multi || defs.some((d) => d.rotate)));
    $('btn-rotr').classList.toggle('hidden', !(multi || defs.some((d) => d.rotate)));
    $('btn-flip').classList.toggle('hidden', !defs.some((d) => d.flip));
    $('btn-pin').classList.toggle('hidden', !(defs.some((d) => d.dynamic) && this.sandbox));
    $('btn-pin').classList.toggle('on', many.length > 0 && many.filter((p) => PART_DEFS[p.type].dynamic).every((p) => p.pinned));
    if (multi) this.showMulti(many.length);
    else
      this.showInfo(
        sel
          ? sel.type
          : this.ropeTool
            ? this.ropeTool.kind
            : this.selectedRope
              ? this.belts.some((b) => b.id === this.selectedRope)
                ? 'belt'
                : 'rope'
              : null,
      );
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
        <dt><kbd>F</kbd></dt><dd>Flip fans, motors, see-saws, mousetraps, ramps, critters… (a flipped candle starts lit)</dd>
        <dt><kbd>R</kbd></dt><dd>Rope tool: click an attach point, (optionally a pulley), then another</dd>
        <dt><kbd>B</kbd></dt><dd>Drive belt tool: click two hubs (motor, gear, conveyor roller)</dd>
        <dt><kbd>N</kbd></dt><dd>Pin a loose part in place (Free Build)</dd>
        <dt>Arrows</dt><dd>Nudge ¼ square (<kbd>Shift</kbd> for 1)</dd>
        <dt>Drag empty space</dt><dd>Box-select (hold <kbd>Shift</kbd> to add); <kbd>Shift</kbd>-click toggles a part</dd>
        <dt><kbd>Ctrl</kbd>+<kbd>A</kbd></dt><dd>Select all your parts</dd>
        <dt><kbd>Ctrl</kbd>+<kbd>C</kbd> / <kbd>X</kbd> / <kbd>V</kbd></dt><dd>Copy / cut / paste (pastes at the mouse)</dd>
        <dt><kbd>Ctrl</kbd>+<kbd>D</kbd></dt><dd>Duplicate</dd>
        <dt><kbd>Del</kbd></dt><dd>Remove selected part or rope</dd>
        <dt><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Y</kbd></dt><dd>Undo / redo</dd>
        <dt><kbd>G</kbd></dt><dd>Toggle grid snap (hold <kbd>Alt</kbd> while dragging to ignore it)</dd>
        <dt><kbd>T</kbd></dt><dd>Toggle trajectory preview (Free Build)</dd>
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
function drawIcon(cv: HTMLCanvasElement, type: PartType | Link) {
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, cv.width, cv.height);
  if (type === 'belt') {
    g.translate(cv.width / 2, cv.height / 2);
    const path = () => {
      g.beginPath();
      g.arc(-34, 8, 14, Math.PI / 2, (Math.PI * 3) / 2);
      g.lineTo(34, -18);
      g.arc(34, -8, 10, -Math.PI / 2, Math.PI / 2);
      g.closePath();
    };
    path();
    g.lineWidth = 10;
    g.strokeStyle = '#141722';
    g.stroke();
    g.lineWidth = 6;
    g.strokeStyle = '#3b3f4c';
    g.stroke();
    for (const [x, y, r] of [
      [-34, 8, 9],
      [34, -8, 6],
    ]) {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fillStyle = '#aeb7c2';
      g.fill();
    }
    return;
  }
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
