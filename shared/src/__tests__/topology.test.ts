import { describe, expect, it } from 'vitest';
import {
  bigBoard,
  buildTopology,
  edgeOf,
  hexagon,
  hexId,
  type Edge,
} from '../topology';
import { createRng } from '../rng';

const BASE = buildTopology(hexagon(2));
const EXT56 = buildTopology(bigBoard());

function eulerDiscCheck(
  hexCount: number,
  vertices: number,
  edges: number,
): number {
  return vertices - edges + hexCount; // must equal 1 for a planar disc
}

describe('base board topology (radius-2 hexagon)', () => {
  it('has exactly 19 hexes, 54 vertices, 72 edges, 30 border edges', () => {
    expect(BASE.hexes.length).toBe(19);
    expect(BASE.vertices.length).toBe(54);
    expect(BASE.edges.length).toBe(72);
    expect(BASE.borderEdges.length).toBe(30);
  });

  it('satisfies Euler disc invariant V - E + F = 1', () => {
    expect(eulerDiscCheck(19, BASE.vertices.length, BASE.edges.length)).toBe(1);
  });

  it('every hex has 6 distinct corner vertices and 6 distinct edges', () => {
    for (const h of BASE.hexes) {
      const verts = BASE.hexVertices[h]!;
      expect(new Set(verts).size).toBe(6);
      expect(new Set(BASE.hexEdges[h]!).size).toBe(6);
    }
  });

  it('every vertex has degree 2 or 3', () => {
    for (const v of BASE.vertices) {
      expect([2, 3]).toContain(BASE.vertexEdges[v]!.length);
    }
  });

  it('interior edges shared by exactly 2 hexes; border edges by exactly 1', () => {
    const counts = BASE.edges.map((e) => BASE.edgeHexes[edgeOf(e)]!.length);
    const interior = counts.filter((c) => c === 2).length;
    const border = counts.filter((c) => c === 1).length;
    expect(interior + border).toBe(72);
    expect(border).toBe(30);
  });

  it('vertex-hex adjacency: every vertex touches 1-3 hexes', () => {
    for (const v of BASE.vertices) {
      expect(BASE.vertexHexes[v]!.length).toBeGreaterThanOrEqual(1);
      expect(BASE.vertexHexes[v]!.length).toBeLessThanOrEqual(3);
    }
  });
});

describe('ext56 board topology (3-4-5-6-5-4-3 rows)', () => {
  it('has exactly 30 hexes, 80 vertices, 109 edges, 38 border edges', () => {
    expect(EXT56.hexes.length).toBe(30);
    expect(EXT56.vertices.length).toBe(80);
    expect(EXT56.edges.length).toBe(109);
    expect(EXT56.borderEdges.length).toBe(38);
  });

  it('satisfies Euler disc invariant', () => {
    expect(eulerDiscCheck(30, EXT56.vertices.length, EXT56.edges.length)).toBe(1);
  });

  it('every hex has 6 distinct corners and edges', () => {
    for (const h of EXT56.hexes) {
      expect(new Set(EXT56.hexVertices[h]!).size).toBe(6);
      expect(new Set(EXT56.hexEdges[h]!).size).toBe(6);
    }
  });

  it('row widths are 3,4,5,6,5,4,3', () => {
    const rows = new Map<number, number>();
    for (const h of EXT56.hexes) {
      const r = Number(h.split(',')[1]);
      rows.set(r, (rows.get(r) ?? 0) + 1);
    }
    const widths = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, w]) => w);
    expect(widths).toEqual([3, 4, 5, 6, 5, 4, 3]);
  });

  it('every row is centred on the same x (no skewed half)', () => {
    const sums = new Map<number, { x: number; n: number }>();
    for (const h of EXT56.hexes) {
      const [q, r] = h.split(',').map(Number) as [number, number];
      const acc = sums.get(r) ?? { x: 0, n: 0 };
      sums.set(r, { x: acc.x + q + r / 2, n: acc.n + 1 });
    }
    const centres = new Set([...sums.values()].map(({ x, n }) => x / n));
    expect(centres.size).toBe(1);
  });
});

describe('edge identity', () => {
  it('edgeOf sorts endpoints; ids are direction-independent', () => {
    const e1: Edge = [3, 7];
    const e2: Edge = [7, 3];
    expect(edgeOf(e1)).toBe(edgeOf(e2));
    expect(edgeOf(e1)).toBe('3-7');
  });

  it('hexagon neighbor lookup finds exactly the in-board neighbors', () => {
    // Center hex (0,0) of the base board has 6 neighbors.
    expect(BASE.hexNeighbors[hexId(0, 0)]!.length).toBe(6);
    // A corner hex has 3 neighbors.
    const corner = BASE.hexes.find((h) => h === hexId(2, -2))!;
    expect(BASE.hexNeighbors[corner]!.length).toBe(3);
  });
});

describe('rng determinism', () => {
  it('same seed produces identical 100 outputs', () => {
    const a = createRng('seed-1');
    const b = createRng('seed-1');
    const seqA = Array.from({ length: 100 }, () => a.next());
    const seqB = Array.from({ length: 100 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('different seeds differ', () => {
    const a = createRng('seed-1');
    const b = createRng('seed-2');
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('int stays in [0, maxExclusive) across many draws', () => {
    const rng = createRng('bounds');
    for (let i = 0; i < 1000; i++) {
      const n = rng.int(6);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(6);
    }
  });

  it('shuffle returns a permutation of the input', () => {
    const rng = createRng('shuffle');
    const input = Array.from({ length: 19 }, (_, i) => i);
    const out = rng.shuffle(input);
    expect([...out].sort((a, b) => a - b)).toEqual(input);
    expect(input).toEqual(Array.from({ length: 19 }, (_, i) => i)); // untouched
  });
});
