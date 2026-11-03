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

  it('a conveyor pushes every kind of thing the same way, whichever was placed first', () => {
    for (const [type, y] of [
      ['crate', 17.22],
      ['anvil', 17.3],
      ['plank', 17.6],
      ['baseball', 17.45],
    ] as const) {
      for (const objFirst of [false, true]) {
        const obj = P(type, 20, y, { id: 'k' });
        const rest = [P('motor', 10, 14, { id: 'm' }), P('conveyor', 20, 18, { id: 'c', length: 10 })];
        const { x } = run({ parts: objFirst ? [obj, ...rest] : [...rest, obj], ropes: [], belts: [{ id: 'b', a: 'm', b: 'c' }] }, 0.5);
        expect(x('k'), `${type}, ${objFirst ? 'placed first' : 'placed second'}`).toBeGreaterThan(20.5);
      }
    }
  });

  it('a drive belt only moves while it is driven, in the hubs’ direction', () => {
    const scene = (flip: boolean | null): Scene => ({
      parts: [floor(), ...(flip === null ? [] : [P('motor', 5, 10, { id: 'm', flip })]), P('gear', 12, 10, { id: 'g' }), P('gear', 20, 10, { id: 'g2' })],
      ropes: [],
      belts: [{ id: 'b', a: flip === null ? 'g2' : 'm', b: 'g' }],
    });
    expect(run(scene(null), 0.5).sim.belts[0].travel).toBe(0);
    expect(run(scene(false), 0.5).sim.belts[0].travel).toBeGreaterThan(0);
    expect(run(scene(true), 0.5).sim.belts[0].travel).toBeLessThan(0);
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

describe('fire and light', () => {
  const C = (x: number, id: string, lit = false) => P('candle', x, 23.95, { id, flip: lit });

  it('a lit candle lights the candle next to it, but not one across the room', () => {
    const { sim } = run({ parts: [floor(), C(20, 'a', true), C(20.65, 'b'), C(25, 'c')], ropes: [] }, 1);
    expect(sim.insts.get('b')!.st.lit).toBe(true);
    expect(sim.insts.get('c')!.st.lit).toBeFalsy();
  });

  it('a magnifying glass focuses a candle onto another candle', () => {
    const { sim } = run({ parts: [floor(), C(16, 'src', true), P('lens', 19, 22.75, { id: 'L' }), C(22, 'tgt')], ropes: [] }, 2.5);
    expect(sim.insts.get('tgt')!.st.lit).toBe(true);
  });

  it('a light bulb only shines when it is powered', () => {
    const scene = (belts: Scene['belts']): Scene => ({
      parts: [floor(), P('motor', 10, 23.85, { id: 'm' }), P('bulb', 16, 22.6, { id: 'bu' }), P('lens', 19, 22.35), P('wall', 22, 23.8, { length: 2 }), P('candle', 22, 23.0, { id: 'tgt' })],
      ropes: [],
      belts,
    });
    expect(run(scene([]), 2.5).sim.insts.get('tgt')!.st.lit).toBeFalsy();
    expect(run(scene([{ id: 'b', a: 'm', b: 'bu' }]), 2.5).sim.insts.get('tgt')!.st.lit).toBe(true);
  });

  it('flint sparks when struck hard, not when touched gently', () => {
    const hard = run({ parts: [floor(), P('flint', 20, 24.25), C(21.3, 'tgt'), P('steelball', 20, 15)], ropes: [] }, 1.5);
    expect(hard.events).toContain('spark');
    expect(hard.sim.insts.get('tgt')!.st.lit).toBe(true);
    const soft = run({ parts: [floor(), P('flint', 20, 24.25), C(21.3, 'tgt'), P('baseball', 20, 23.4)], ropes: [] }, 1.5);
    expect(soft.sim.insts.get('tgt')!.st.lit).toBeFalsy();
  });

  it('a lit rocket flies up, and an unlit one stays put', () => {
    const pad = (lit: boolean): Scene => ({
      parts: [floor(), P('rocket', 20, 22.05, { id: 'r' }), P('wall', 20, 23.3, { length: 0.6 }), ...(lit ? [C(20.6, 'c', true)] : [])],
      ropes: [],
    });
    expect(run(pad(false), 1).sim.insts.get('r')!.main.getPosition().y).toBeGreaterThan(21.5);
    const lit = run(pad(true), 0.8);
    expect(lit.events).toContain('launch');
    expect(lit.sim.insts.get('r')!.main.getPosition().y).toBeLessThan(15);
  });

  it('a flame burns through a rope', () => {
    const { sim, events } = run(
      {
        parts: [floor(), P('hook', 20, 10, { id: 'h' }), P('anvil', 20, 18, { id: 'a' }), P('wall', 19.75, 15.3, { length: 1 }), P('candle', 19.75, 14.65, { flip: true })],
        ropes: [{ id: 'q', a: 'h', b: 'a' }],
      },
      2,
    );
    expect(events).toContain('burn');
    expect(sim.insts.get('a')!.main.getPosition().y).toBeGreaterThan(23);
  });

  it('a fan blows a candle out', () => {
    const { sim, events } = run({ parts: [floor(), P('fan', 15, 23.15), C(19, 'c', true)], ropes: [] }, 0.5);
    expect(events).toContain('puff');
    expect(sim.insts.get('c')!.st.lit).toBe(false);
  });
});

describe('critters', () => {
  it('a sleeping cat stays put and the mouse ignores it', () => {
    const { x } = run({ parts: [floor(), P('cat', 10, 23.95, { id: 'cat' }), P('rodent', 20, 24.25, { id: 'm' })], ropes: [] }, 2);
    expect(x('cat')).toBeCloseTo(10, 1);
    expect(x('m')).toBeCloseTo(20, 1);
  });

  it('a woken cat chases the mouse, and the mouse runs away faster', () => {
    const { x, events } = run({ parts: [floor(), P('cat', 10, 23.95, { id: 'cat' }), P('rodent', 16, 24.25, { id: 'm' }), P('baseball', 10, 18)], ropes: [] }, 2);
    expect(events).toContain('meow');
    expect(x('cat')).toBeGreaterThan(15);
    expect(x('m') - x('cat')).toBeGreaterThan(6);
  });

  it('a wall stops the cat from spotting the mouse', () => {
    const { sim } = run(
      { parts: [floor(), P('cat', 10, 23.95, { id: 'cat' }), P('wall', 12.5, 23, { length: 3, angle: Math.PI / 2 }), P('rodent', 15, 24.25)], ropes: [] },
      1.5,
    );
    expect(sim.insts.get('cat')!.st.awake).toBeFalsy();
  });

  it('a bell ringing nearby wakes the cat', () => {
    const { sim } = run({ parts: [floor(), P('cat', 10, 23.95, { id: 'cat' }), P('bell', 14, 18), P('baseball', 14, 14)], ropes: [] }, 1.5);
    expect(sim.insts.get('cat')!.st.awake).toBe(true);
  });
});
