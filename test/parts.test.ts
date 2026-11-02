import { describe, expect, it } from 'vitest';
import type { Part, PartType, Scene } from '../src/model';
import { defaultPart } from '../src/parts';
import { Sim } from '../src/sim';

const P = (type: PartType, x: number, y: number, o: Partial<Part> = {}): Part => ({
  ...defaultPart(type, x, y, o.id ?? type),
  ...o,
});
const floor = () => P('wall', 20, 24.75, { id: 'floor', length: 40 });

function run(scene: Scene, seconds: number) {
  const sim = new Sim(scene);
  const events: string[] = [];
  for (let i = 0; i < seconds * 120; i++) {
    sim.step();
    for (const e of sim.drainEvents()) events.push(e.kind);
  }
  return { sim, events, x: (id: string) => sim.insts.get(id)!.main.getPosition().x };
}

describe('power train', () => {
  const conveyorScene = (extra: Part[], belts: Scene['belts']): Scene => ({
    parts: [floor(), P('conveyor', 20, 18, { id: 'c', length: 8 }), P('crate', 20, 17.22, { id: 'k' }), ...extra],
    ropes: [],
    belts,
  });

  it('an unpowered conveyor does nothing', () => {
    expect(run(conveyorScene([], []), 1).x('k')).toBeCloseTo(20, 1);
  });

  it('a motor belted to a conveyor moves things, and flipping the motor reverses it', () => {
    expect(run(conveyorScene([P('motor', 10, 14, { id: 'm' })], [{ id: 'b', a: 'm', b: 'c' }]), 0.5).x('k')).toBeGreaterThan(21.5);
    expect(
      run(conveyorScene([P('motor', 10, 14, { id: 'm', flip: true })], [{ id: 'b', a: 'm', b: 'c' }]), 0.5).x('k'),
    ).toBeLessThan(18.5);
  });

  it('meshing gears reverse direction', () => {
    const scene = conveyorScene(
      [P('motor', 5, 10, { id: 'm' }), P('gear', 10, 10, { id: 'g1', length: 2 }), P('gear', 12, 10, { id: 'g2', length: 2 })],
      [
        { id: 'b1', a: 'm', b: 'g1' },
        { id: 'b2', a: 'g2', b: 'c' },
      ],
    );
    const { sim, x } = run(scene, 0.5);
    expect(sim.insts.get('g2')!.st.omega).toBeLessThan(0);
    expect(x('k')).toBeLessThan(18.5);
  });

  it('the mouse sleeps until bumped', () => {
    const asleep = run(conveyorScene([P('mouse', 8, 20.25, { id: 'mo' })], [{ id: 'b', a: 'mo', b: 'c' }]), 1.5);
    expect(asleep.x('k')).toBeCloseTo(20, 1);
    const woken = run(
      conveyorScene([P('mouse', 8, 20.25, { id: 'mo' }), P('baseball', 8, 15, { id: 'ball' })], [{ id: 'b', a: 'mo', b: 'c' }]),
      2,
    );
    expect(woken.events).toContain('squeak');
    expect(woken.x('k')).toBeGreaterThan(21);
  });
});

describe('gadgets', () => {
  it('scissors cut a rope when their handles are hit', () => {
    const { sim, events } = run(
      {
        parts: [floor(), P('hook', 20, 3, { id: 'h' }), P('anvil', 20, 10, { id: 'a' }), P('scissors', 19.45, 6), P('baseball', 18.95, 1)],
        ropes: [{ id: 'r', a: 'h', b: 'a' }],
      },
      2,
    );
    expect(events).toContain('cut');
    expect(sim.ropes[0].cut).toBe(true);
    expect(sim.insts.get('a')!.main.getPosition().y).toBeGreaterThan(20);
  });

  it('glass survives a gentle touch but shatters under a hard hit', () => {
    const gentle = run({ parts: [floor(), P('glass', 20, 15, { id: 'g', length: 4 }), P('baseball', 20, 14.3)], ropes: [] }, 1);
    expect(gentle.sim.insts.get('g')!.removed).toBe(false);
    const hard = run({ parts: [floor(), P('glass', 20, 15, { id: 'g', length: 4 }), P('bowling', 20, 3)], ropes: [] }, 1.5);
    expect(hard.sim.insts.get('g')!.removed).toBe(true);
  });

  it('TNT explodes on a hard hit and pushes things away', () => {
    const { sim, events } = run(
      { parts: [floor(), P('tnt', 20, 24.1, { id: 't' }), P('bowling', 20, 14), P('crate', 23, 24, { id: 'k' })], ropes: [] },
      1.5,
    );
    expect(events).toContain('boom');
    expect(sim.insts.get('t')!.removed).toBe(true);
    expect(sim.insts.get('k')!.main.getPosition().x).toBeGreaterThan(23.2);
  });

  it('a mousetrap springs when its pedal is hit and flings what sits in its cradle', () => {
    const { sim, events } = run(
      { parts: [floor(), P('mousetrap', 24, 24.4, { id: 't' }), P('baseball', 24.7, 23.85, { id: 'b' }), P('bowling', 23.5, 18)], ropes: [] },
      0.9,
    );
    expect(events).toContain('snap');
    expect(sim.insts.get('b')!.main.getPosition().y).toBeLessThan(20);
  });

  it('a rope can pull either end of a see-saw', () => {
    const { sim } = run(
      {
        parts: [floor(), P('seesaw', 20, 23.25, { id: 's', length: 6 }), P('pulley', 17, 10, { id: 'p' }), P('anvil', 14, 14, { id: 'a' })],
        ropes: [{ id: 'r', a: 's', aEnd: 0, b: 'a', via: 'p' }],
      },
      1.5,
    );
    // the left end starts down; the anvil hauls it up
    expect(sim.insts.get('s')!.main.getAngle()).toBeGreaterThan(0);
  });

  it('bells count rings', () => {
    const { sim } = run({ parts: [floor(), P('bell', 20, 15, { id: 'bell' }), P('baseball', 20, 10)], ropes: [] }, 1);
    expect(sim.goalMet({ kind: 'rung', target: 'bell', label: '' })).toBe(true);
  });

  it('magnets pull metal but not wood', () => {
    const { sim } = run(
      {
        parts: [floor(), P('magnet', 26, 22, { id: 'm', angle: Math.PI / 2 }), P('steelball', 21, 24.2, { id: 'st' }), P('baseball', 21, 22, { id: 'w' })],
        ropes: [],
      },
      1.5,
    );
    expect(sim.insts.get('st')!.main.getPosition().x).toBeGreaterThan(23);
    expect(sim.insts.get('w')!.main.getPosition().x).toBeLessThan(22);
  });
});
