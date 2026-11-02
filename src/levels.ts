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
    hint: 'A tilted trampoline launches things sideways. Turn on the trajectory preview (T) to aim.',
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
    solution: { parts: [S('trampoline', 5, 18, 's1', { angle: 0.4 })], ropes: [] },
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
    blurb: 'Knock over every domino.',
    hint: 'Conveyor belts carry whatever lands on them. Flip one with F to reverse it.',
    scene: {
      parts: [
        floor(),
        L('bowling', 5, 2, 'ball'),
        ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => L('domino', 19 + i * 1.1, 23.8, `d${i}`)),
        L('wall', 33, 22, 'stop', { length: 5, angle: V }),
      ],
      ropes: [],
    },
    bin: { conveyor: 1, wall: 1 },
    goals: [
      {
        kind: 'toppled',
        targets: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => `d${i}`),
        label: 'Topple all 9 dominoes',
      },
    ],
    solution: {
      parts: [S('conveyor', 7, 6, 's1', { length: 6 }), S('wall', 14, 17, 's2', { length: 6, angle: 0.5 })],
      ropes: [],
    },
  },
  {
    id: 'teeter-toss',
    title: 'Teeter Toss',
    blurb: 'Launch the baseball into the bucket up on the high shelf.',
    hint: 'Something heavy landing on the raised end of a teeter-totter flings the other end up.',
    scene: {
      parts: [
        floor(),
        L('bowling', 24, 2, 'heavy'),
        L('wall', 31, 14, 'shelf', { length: 8 }),
        L('bucket', 31, 13.15, 'bucket', { pinned: true }),
        L('wall', 32.05, 9, 'backboard', { length: 7, angle: V }),
      ],
      ropes: [],
    },
    bin: { seesaw: 1, baseball: 1, wall: 2 },
    goals: [{ kind: 'inBucket', target: 'sball', bucket: 'bucket', label: 'Baseball in the bucket' }],
    solution: {
      parts: [S('seesaw', 21.5, 23.25, 's1', { length: 7 }), S('baseball', 18.5, 23.5, 'sball')],
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
];
