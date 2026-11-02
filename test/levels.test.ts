import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/levels';
import { Sim, findOverlaps, solveCheck } from '../src/sim';
import { PART_DEFS } from '../src/parts';

describe('levels', () => {
  for (const level of LEVELS) {
    describe(level.title, () => {
      it('is not already solved without player parts', () => {
        expect(solveCheck(level.scene, level.goals, 15).won).toBe(false);
      });

      it('reference solution wins', () => {
        const scene = {
          parts: [...level.scene.parts, ...level.solution.parts],
          ropes: [...level.scene.ropes, ...level.solution.ropes],
        };
        const r = solveCheck(scene, level.goals, 30);
        expect(r.won).toBe(true);
      });

      it('reference solution has no overlapping parts', () => {
        const sim = new Sim({
          parts: [...level.scene.parts, ...level.solution.parts],
          ropes: [...level.scene.ropes, ...level.solution.ropes],
        });
        expect([...findOverlaps(sim)]).toEqual([]);
      });

      it('reference solution only uses parts from the bin', () => {
        const used: Record<string, number> = {};
        for (const p of level.solution.parts) used[p.type] = (used[p.type] ?? 0) + 1;
        if (level.solution.ropes.length) used.rope = level.solution.ropes.length;
        for (const [type, n] of Object.entries(used)) {
          expect(level.bin[type as keyof typeof level.bin] ?? 0, `${type}`).toBeGreaterThanOrEqual(n);
        }
      });

      it('references valid part ids', () => {
        const ids = new Set([...level.scene.parts, ...level.solution.parts].map((p) => p.id));
        for (const p of level.scene.parts) expect(PART_DEFS[p.type]).toBeTruthy();
        for (const g of level.goals) {
          const refs = g.kind === 'toppled' ? g.targets : g.kind === 'inBucket' ? [g.target, g.bucket] : [g.target];
          for (const id of refs) expect(ids.has(id), id).toBe(true);
        }
      });
    });
  }
});

describe('determinism', () => {
  it('same scene produces the same result twice', () => {
    const l = LEVELS[0];
    const scene = { parts: [...l.scene.parts, ...l.solution.parts], ropes: [] };
    expect(solveCheck(scene, l.goals, 30).time).toBe(solveCheck(scene, l.goals, 30).time);
  });
});
