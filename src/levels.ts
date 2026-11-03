import type { Level, Part, PartType, Rope } from './model';
import { defaultPart } from './parts';

/** level part: locked by default */
function L(type: PartType, x: number, y: number, id: string, o: Partial<Part> = {}): Part {
  return { ...defaultPart(type, x, y, id), locked: true, ...o };
}
/** solution part: movable */
function S(type: PartType, x: number, y: number, id: string, o: Partial<Part> = {}): Part {
  return { ...defaultPart(type, x, y, id), ...o };
}
function R(id: string, a: string, b: string, o: Partial<Rope> = {}): Rope {
  return { id, a, b, ...o };
}

const floor = () => L('wall', 20, 24.75, 'floor', { length: 40 });
const V = Math.PI / 2;

export const LEVELS: Level[] = [
  {
    id: 'roll-with-it',
    title: 'Roll With It',
    blurb: 'Get the bowling ball into the bucket. Drag walls from the parts bin and tilt them into ramps.',
    hint: 'Select a wall and press Q / E (or drag the blue knob) to tilt it.',
    scene: {
      parts: [
        floor(),
        L('bowling', 5, 2, 'ball'),
        L('wall', 37, 19.5, 'backstop', { length: 10, angle: V }),
        L('bucket', 35.9, 23.9, 'bucket', { pinned: true }),
      ],
      ropes: [],
    },
    bin: { wall: 2 },
    goals: [{ kind: 'inBucket', target: 'ball', bucket: 'bucket', label: 'Bowling ball in the bucket' }],
    solution: {
      parts: [
        S('wall', 8, 6, 's1', { length: 10, angle: 0.25 }),
        S('wall', 22, 11, 's2', { length: 12, angle: 0.15 }),
      ],
      ropes: [],
    },
  },
  {
    id: 'boing',
    title: 'Boing!',
    blurb: 'The basketball needs to clear the wall and land in the bucket.',
    hint: 'A tilted trampoline launches things sideways. Try a few angles: Reset puts everything back.',
    scene: {
      parts: [
        floor(),
        L('basketball', 5, 3, 'ball'),
        L('wall', 20, 19.5, 'divider', { length: 10, angle: V }),
        L('bucket', 30, 23.9, 'bucket', { pinned: true }),
      ],
      ropes: [],
    },
    bin: { trampoline: 1, wall: 1 },
    goals: [{ kind: 'inBucket', target: 'ball', bucket: 'bucket', label: 'Basketball in the bucket' }],
    solution: { parts: [S('trampoline', 5, 14, 's1', { angle: 0.3 })], ropes: [] },
  },
  {
    id: 'breeze-pop',
    title: 'Breeze Pop',
    blurb: 'Pop the balloon. It is stuck under the shelf, a long way from the pin.',
    hint: 'Fans push light things a long way.',
    scene: {
      parts: [
        floor(),
        L('wall', 18, 9, 'shelf', { length: 30 }),
        L('balloon', 7, 10.4, 'balloon'),
        L('needle', 15.4, 10.05, 'pin', { angle: -Math.PI / 2 }),
        L('crate', 22, 24, 'crate1'),
        L('crate', 23.2, 24, 'crate2'),
      ],
      ropes: [],
    },
    bin: { fan: 1 },
    goals: [{ kind: 'popped', target: 'balloon', label: 'Pop the balloon' }],
    solution: { parts: [S('fan', 4, 10.6, 's1')], ropes: [] },
  },
  {
    id: 'chain-reaction',
    title: 'Chain Reaction',
    blurb: 'Knock over every domino. The bowling ball is sitting on a conveyor belt with no power.',
    hint: 'Pick the Drive Belt, click the motor’s pulley, then one of the conveyor’s rollers.',
    scene: {
      parts: [
        floor(),
        L('conveyor', 7, 6, 'belt', { length: 6 }),
        L('bowling', 6, 5.22, 'ball'),
        ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => L('domino', 19 + i * 1.1, 23.8, `d${i}`)),
        L('wall', 33, 22, 'stop', { length: 5, angle: V }),
      ],
      ropes: [],
    },
    bin: { motor: 1, belt: 1, wall: 1 },
    goals: [
      {
        kind: 'toppled',
        targets: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => `d${i}`),
        label: 'Topple all 9 dominoes',
      },
    ],
    solution: {
      parts: [S('motor', 4, 10, 'm1'), S('wall', 14, 17, 's2', { length: 6, angle: 0.5 })],
      ropes: [],
      belts: [{ id: 'sb', a: 'm1', b: 'belt' }],
    },
  },
  {
    id: 'teeter-toss',
    title: 'See-Saw Toss',
    blurb: 'Launch the baseball off the see-saw and into the bucket on the shelf.',
    hint: 'Something heavy landing on the raised end of a see-saw flings the other end up.',
    scene: {
      parts: [
        floor(),
        L('bowling', 6, 2, 'heavy'),
        L('seesaw', 21.5, 23.25, 'see', { length: 7 }),
        L('baseball', 18.5, 23.5, 'ball'),
        L('wall', 29.5, 18.85, 'shelf', { length: 6 }),
        L('bucket', 28.5, 18, 'bucket', { pinned: true }),
        L('wall', 29.5, 15, 'backboard', { length: 6, angle: V }),
      ],
      ropes: [],
    },
    bin: { wall: 2 },
    goals: [{ kind: 'inBucket', target: 'ball', bucket: 'bucket', label: 'Baseball in the bucket' }],
    solution: {
      parts: [S('wall', 8.5, 4.5, 's1', { length: 11, angle: Math.PI / 12 })],
      ropes: [],
    },
  },
  {
    id: 'lift-off',
    title: 'Lift Off',
    blurb: 'Get the baseball up into the target zone at the top.',
    hint: 'Pick the Rope from the bin, then click the balloon and the baseball to tie them together.',
    scene: {
      parts: [
        floor(),
        L('baseball', 20, 24.25, 'ball'),
        L('wall', 20, 0.75, 'ceiling', { length: 10 }),
      ],
      ropes: [],
    },
    bin: { balloon: 1, rope: 1 },
    goals: [
      {
        kind: 'inZone',
        target: 'ball',
        zone: { x: 16, y: 1, w: 8, h: 4 },
        label: 'Baseball in the zone',
      },
    ],
    solution: {
      parts: [S('balloon', 20, 21, 's1')],
      ropes: [R('sr', 's1', 'ball')],
    },
  },
  {
    id: 'counterweight',
    title: 'Counterweight',
    blurb: 'Raise the crate into the zone. The bucket on the other end of the rope is empty.',
    hint: 'Something heavy in the bucket will out-weigh the crate.',
    scene: {
      parts: [
        floor(),
        L('pulley', 20, 3, 'pulley'),
        L('crate', 17, 24, 'crate'),
        L('bucket', 21, 9, 'bucket'),
        L('bowling', 35, 2, 'ball'),
      ],
      ropes: [R('r1', 'crate', 'bucket', { via: 'pulley', locked: true })],
    },
    bin: { wall: 2 },
    goals: [
      { kind: 'inZone', target: 'crate', zone: { x: 13, y: 4, w: 9, h: 8 }, label: 'Crate in the zone' },
    ],
    solution: {
      parts: [S('wall', 30, 5, 's1', { length: 12, angle: -0.3 })],
      ropes: [],
    },
  },
  {
    id: 'gear-head',
    title: 'Gear Head',
    blurb: 'Get the crate into the zone on the left. The motor only turns one way…',
    hint: 'Gears whose teeth touch turn in opposite directions. Belts keep the direction the same.',
    scene: {
      parts: [
        floor(),
        L('motor', 30, 12, 'motor'),
        L('conveyor', 20, 18, 'belt', { length: 10 }),
        L('crate', 22, 17.22, 'crate'),
      ],
      ropes: [],
    },
    bin: { gear: 2, belt: 2 },
    goals: [{ kind: 'inZone', target: 'crate', zone: { x: 5, y: 21, w: 9, h: 4 }, label: 'Crate in the zone' }],
    solution: {
      parts: [S('gear', 30, 7, 'g1', { length: 2 }), S('gear', 28, 7, 'g2', { length: 2 })],
      ropes: [],
      belts: [
        { id: 'sb1', a: 'motor', b: 'g1' },
        { id: 'sb2', a: 'g2', b: 'belt', bEnd: 1 },
      ],
    },
  },
  {
    id: 'snap-happy',
    title: 'Snap Happy',
    blurb: 'Get the baseball into the bucket. It is sitting in a cocked mousetrap.',
    hint: 'Anything that lands on (or rolls onto) the cheese pedal springs the trap.',
    scene: {
      parts: [
        floor(),
        L('mousetrap', 24, 24.4, 'trap'),
        L('baseball', 24.7, 23.85, 'ball'),
        L('bowling', 5, 2, 'heavy'),
        L('wall', 12.5, 17.85, 'shelf', { length: 3 }),
        L('bucket', 12.5, 17, 'bucket', { pinned: true }),
        L('wall', 11.45, 14.5, 'back', { length: 4, angle: V }),
      ],
      ropes: [],
    },
    bin: { curve: 1, wall: 1 },
    goals: [{ kind: 'inBucket', target: 'ball', bucket: 'bucket', label: 'Baseball in the bucket' }],
    solution: { parts: [S('curve', 8, 20, 's1', { length: 8 })], ropes: [] },
  },
  {
    id: 'mouse-power',
    title: 'Mouse Power',
    blurb: 'Deliver the crate to the zone. The conveyor has no power, and the mouse is fast asleep.',
    hint: 'Belt the mouse wheel to the conveyor, then give the cage a bump to wake it up.',
    scene: {
      parts: [
        floor(),
        L('mouse', 9, 20.25, 'mouse'),
        L('conveyor', 22, 15, 'belt', { length: 10 }),
        L('crate', 19, 14.22, 'crate'),
        L('baseball', 3, 2, 'ball'),
      ],
      ropes: [],
    },
    bin: { belt: 1, wall: 1 },
    goals: [{ kind: 'inZone', target: 'crate', zone: { x: 28, y: 20, w: 8, h: 5 }, label: 'Crate in the zone' }],
    solution: {
      parts: [S('wall', 3.5, 9.5, 's1', { length: 4, angle: Math.PI / 12 })],
      ropes: [],
      belts: [{ id: 'sb', a: 'mouse', b: 'belt' }],
    },
  },
  {
    id: 'cut-loose',
    title: 'Cut Loose',
    blurb: 'Launch the baseball into the bucket. There is an anvil hanging right above the see-saw…',
    hint: 'Scissors snip any rope between their blades when something hits the handles.',
    scene: {
      parts: [
        floor(),
        L('seesaw', 21.5, 23.25, 'see', { length: 7 }),
        L('baseball', 18.5, 23.5, 'ball'),
        L('hook', 24.5, 6, 'hook'),
        L('anvil', 24.5, 11, 'anvil'),
        L('wall', 13.5, 4.5, 'ramp', { length: 11.5, angle: 0.27 }),
        L('steelball', 9, 2, 'roller'),
        L('bucket', 29.5, 23.9, 'bucket', { pinned: true }),
      ],
      ropes: [R('rope', 'hook', 'anvil', { locked: true })],
    },
    bin: { scissors: 1 },
    goals: [{ kind: 'inBucket', target: 'ball', bucket: 'bucket', label: 'Baseball in the bucket' }],
    solution: { parts: [S('scissors', 23.25, 8.25, 's1')], ropes: [] },
  },
  {
    id: 'kaboom',
    title: 'Kaboom',
    blurb: 'The basketball is locked in a cage with a glass floor. Get it into the bucket.',
    hint: 'TNT goes off when something heavy slams into it, and glass doesn’t like explosions.',
    scene: {
      parts: [
        floor(),
        L('bowling', 6, 2, 'heavy'),
        L('wall', 10, 5, 'ramp', { length: 12, angle: 0.25 }),
        L('wall', 28, 8.25, 'roof', { length: 4 }),
        L('wall', 26.25, 10.25, 'cageL', { length: 3.5, angle: V }),
        L('wall', 29.75, 10.25, 'cageR', { length: 3.5, angle: V }),
        L('glass', 28, 12.1, 'pane', { length: 3.25 }),
        L('basketball', 28, 11.5, 'ball'),
        L('funnel', 28, 18, 'funnel'),
        L('bucket', 28, 23.9, 'bucket', { pinned: true }),
      ],
      ropes: [],
    },
    bin: { tnt: 1, wall: 1 },
    goals: [{ kind: 'inBucket', target: 'ball', bucket: 'bucket', label: 'Basketball in the bucket' }],
    solution: {
      parts: [S('wall', 22.5, 14.5, 's1', { length: 2 }), S('tnt', 22.5, 13.85, 's2')],
      ropes: [],
    },
  },
  {
    id: 'bright-idea',
    title: 'Bright Idea',
    blurb: 'Light the candle up on the shelf. The only flame is all the way down on the floor.',
    hint: 'A magnifying glass focuses light from behind it into a hot spot in front. Rotate it to aim up.',
    scene: {
      parts: [
        floor(),
        L('candle', 8, 23.95, 'src', { flip: true }),
        L('wall', 15, 19.25, 'shelf', { length: 3 }),
        L('candle', 15, 18.7, 'tgt'),
      ],
      ropes: [],
    },
    bin: { lens: 1 },
    goals: [{ kind: 'lit', target: 'tgt', label: 'Light the candle' }],
    solution: { parts: [S('lens', 12.5, 19.5, 's1', { angle: -Math.PI / 4 })], ropes: [] },
  },
  {
    id: 'spark-plug',
    title: 'Spark Plug',
    blurb: 'Ring the bell with the rocket. You will need to light its fuse somehow.',
    hint: 'Flint throws sparks when something hits it hard. Where does the steel ball end up?',
    scene: {
      parts: [
        floor(),
        L('wall', 26, 23.3, 'pad', { length: 0.75 }),
        L('rocket', 26, 22.05, 'rocket'),
        L('steelball', 4, 2, 'ball'),
        L('wall', 9, 5.5, 'ramp', { length: 11, angle: 0.3 }),
        L('wall', 20, 12, 'roof', { length: 6 }),
        L('bell', 26, 3, 'bell'),
      ],
      ropes: [],
    },
    bin: { flint: 1, wall: 1 },
    goals: [{ kind: 'rung', target: 'bell', label: 'Ring the bell' }],
    solution: {
      parts: [S('wall', 28.5, 18, 's1', { length: 4, angle: V }), S('flint', 27, 24.25, 's2')],
      ropes: [],
    },
  },
  {
    id: 'here-kitty',
    title: 'Here, Kitty',
    blurb: 'Get the mouse home to its hole on the right. It will only run if something chases it.',
    hint: 'The cat is a light sleeper: a bell ringing nearby will wake it.',
    scene: {
      parts: [
        L('wall', 13, 24.75, 'floorL', { length: 26 }),
        L('wall', 35, 24.75, 'floorR', { length: 10 }),
        L('cat', 6, 23.95, 'cat'),
        L('rodent', 14, 24.25, 'mouse'),
        L('hook', 9, 13, 'hang'),
        L('bell', 9, 14.4, 'bell'),
        L('baseball', 3, 2, 'ball'),
        L('wall', 39.6, 22.5, 'end', { length: 4, angle: V }),
      ],
      ropes: [],
    },
    bin: { wall: 2 },
    goals: [{ kind: 'inZone', target: 'mouse', zone: { x: 34, y: 21, w: 5.5, h: 3.5 }, label: 'Mouse in its hole' }],
    solution: {
      parts: [S('wall', 28, 24.75, 's1', { length: 4.5 }), S('wall', 2, 12, 's2', { length: 3, angle: Math.PI / 12 })],
      ropes: [],
    },
  },
  {
    id: 'night-light',
    title: 'Night Light',
    blurb: 'Ring the bell. No candles this time — just a sleepy mouse, a light bulb and a rocket.',
    hint: 'The bulb is a dynamo: it needs something turning it. Then focus its light on the fuse.',
    scene: {
      parts: [
        floor(),
        L('mouse', 5, 20.25, 'wheel'),
        L('baseball', 5, 10, 'ball'),
        L('bulb', 14, 22.4, 'bulb'),
        L('wall', 26, 23.3, 'pad', { length: 0.75 }),
        L('rocket', 26, 22.05, 'rocket'),
        L('bell', 26, 3, 'bell'),
      ],
      ropes: [],
    },
    bin: { belt: 1, lens: 1 },
    goals: [{ kind: 'rung', target: 'bell', label: 'Ring the bell' }],
    solution: {
      parts: [S('lens', 23, 23, 's1')],
      ropes: [],
      belts: [{ id: 'sb', a: 'wheel', b: 'bulb' }],
    },
  },
];
