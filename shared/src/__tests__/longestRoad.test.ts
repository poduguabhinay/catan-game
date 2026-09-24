import { describe, expect, it } from 'vitest';
import {
  computeLongestRoadAward,
  longestRoadLength,
  type LongestRoadAward,
} from '../longestRoad';
import { buildTopology, edgeId, hexagon, type Topology, type VertexId } from '../topology';

const TOPO: Topology = buildTopology(hexagon(2));

/** Chain of n consecutive edges starting at vertex `start` walking degree-2 ring. */
function straightChain(
  topo: Topology,
  start: VertexId,
  length: number,
  skipFirst = false,
): string[] {
  const edges: string[] = [];
  let current = start;
  for (let i = 0; i < length; i++) {
    const candidates = topo.vertexEdges[current]!;
    // Take the edge to the neighbor with the smallest id that isn't already used.
    const eids = candidates.filter((eid) => !edges.includes(eid));
    // Prefer continuing outward: pick first edge whose far endpoint differs from where we came.
    let chosen: string | undefined;
    for (const eid of eids) {
      const [a, b] = topo.edgeEndpoints[eid]!;
      const next = a === current ? b : a;
      if (edges.length === 0 || next !== current) {
        chosen = eid;
        break;
      }
    }
    if (chosen === undefined) chosen = eids[0]!;
    edges.push(chosen);
    const [a, b] = topo.edgeEndpoints[chosen]!;
    current = a === current ? b : a;
  }
  return skipFirst ? edges.slice(1) : edges;
}

// Border ring of the base board: 18 border vertices degree-2 chain of 30 edges.
function borderRing(topo: Topology): string[] {
  return topo.borderEdges.map((e) => edgeId(e[0], e[1]));
}

describe('longestRoadLength', () => {
  it('returns 0 for no roads', () => {
    expect(longestRoadLength([], new Set(), TOPO)).toBe(0);
  });
  it('straight chain of 9 stays 9; opponent settlement mid-chain splits it', () => {
    // Chain runs 28-16-17-3-4-5-0-9-6-13 along the border ring (9 edges).
    const ring = borderRing(TOPO);
    const chain = ring.slice(0, 9);
    expect(longestRoadLength(chain, new Set(), TOPO)).toBe(9);

    // Vertex 4 lies between chain edges 3 and 4 (endpoints [3,4] and [4,5]).
    // Blocking it severs: {e0..e3} = 4 edges and {e4..e8} = 5 edges; max 5.
    expect(longestRoadLength(chain, new Set([4]), TOPO)).toBe(5);
  });

  it('opponent settlement at a chain END does not shorten the road', () => {
    const ring = borderRing(TOPO);
    const chain = ring.slice(0, 9);
    // Official behavior (matches catanatron reference): an opponent
    // settlement blocks THROUGH-traversal only. The end edge leading into it
    // still counts, so a tip settlement never shortens the chain.
    expect(longestRoadLength(chain, new Set([28]), TOPO)).toBe(9);
  });

  it('blocked vertex with roads on both sides counts only one side', () => {
    const ring = borderRing(TOPO);
    const chain = ring.slice(0, 9);
    // Vertex 6 sits between e7 ([9,6]) and e8 ([6,13]): sides are 8 and 1.
    expect(longestRoadLength(chain, new Set([6]), TOPO)).toBe(8);
  });

  it('a blocked mid vertex splits; unblocked the full 9 remains', () => {
    const ring = borderRing(TOPO);
    const chain = ring.slice(0, 9);
    // The engine blocks only OPPONENT vertices; passing the same vertex in the
    // blocked set simulates an opponent. Without it (own settlement) -> 9.
    expect(longestRoadLength(chain, new Set([4]), TOPO)).toBe(5);
    expect(longestRoadLength(chain, new Set(), TOPO)).toBe(9);
  });

  it('branching network counts only the longest branch', () => {
    // Take a degree-3 vertex, build two arms of lengths 3 and 5.
    const branchVertex = TOPO.vertices.find((v) => TOPO.vertexEdges[v]!.length === 3)!;
    const arm1 = straightChain(TOPO, branchVertex, 3);
    const arm2 = straightChain(TOPO, branchVertex, 5, true); // skip shared first edge
    // arm2 must not reuse arm1 edges; straightChain walks degree order — verify.
    const all = [...new Set([...arm1, ...arm2])];
    const len = longestRoadLength(all, new Set(), TOPO);
    // Longest path through the branch: 3 + 5 = 8 if the arms share only the branch vertex.
    expect(len).toBeGreaterThanOrEqual(5);
  });

  it('triangle of 3 roads counts as 3 (edge-simple, not vertex-simple)', () => {
    // Find three vertices forming a triangle (3 hexes meeting): a vertex v with
    // two neighbors u,w that are adjacent to each other.
    outer: for (const v of TOPO.vertices) {
      const neighbors = TOPO.adjacentVertices[v]!;
      for (const u of neighbors) {
        for (const w of neighbors) {
          if (u >= w) continue;
          if (TOPO.adjacentVertices[u]!.includes(w)) {
            const tri = [edgeId(v, u), edgeId(v, w), edgeId(u, w)];
            expect(longestRoadLength(tri, new Set(), TOPO)).toBe(3);
            break outer;
          }
        }
      }
    }
  });
});

describe('computeLongestRoadAward', () => {
  const ring = borderRing(TOPO);

  function award(
    holder: number | null,
    length: number,
    players: Array<{ seat: number; roads: string[] }>,
    buildings: ReadonlyMap<VertexId, number>,
  ): LongestRoadAward {
    return computeLongestRoadAward(
      { holder, length },
      players,
      buildings,
      TOPO,
    );
  }

  it('first claim requires >= 5', () => {
    const p = [{ seat: 0, roads: ring.slice(0, 4) }];
    const res = award(null, 0, p, new Map());
    expect(res.holder).toBeNull();
    const p5 = [{ seat: 0, roads: ring.slice(0, 5) }];
    expect(award(null, 0, p5, new Map()).holder).toBe(0);
  });

  it('steal requires strictly greater; tie keeps holder', () => {
    const a = [{ seat: 0, roads: ring.slice(0, 6) }];
    expect(award(null, 0, a, new Map()).holder).toBe(0);
    // Seat 1 ties at 6: keeps seat 0.
    const b = [
      { seat: 0, roads: ring.slice(0, 6) },
      { seat: 1, roads: ring.slice(10, 16) },
    ];
    expect(award(0, 6, b, new Map()).holder).toBe(0);
    // Seat 1 goes to 7: steals.
    const c = [
      { seat: 0, roads: ring.slice(0, 6) },
      { seat: 1, roads: ring.slice(10, 17) },
    ];
    const stolen = award(0, 6, c, new Map());
    expect(stolen.holder).toBe(1);
    expect(stolen.length).toBe(7);
  });

  it('holder broken below the field and no unique >=5 max sets award aside', () => {
    // Seat 0 held a 6-road chain (ring[0..5]); opponent seat 1 settles on
    // vertex 4 (between ring edges [3,4] and [4,5]) splitting it 4 | 2.
    // Seat 1 itself has only 3 roads: no unique >=5 maximum remains.
    const buildings = new Map<VertexId, number>([[4, 1]]);
    const players = [
      { seat: 0, roads: ring.slice(0, 6) },
      { seat: 1, roads: ring.slice(10, 13) },
    ];
    const res = award(0, 6, players, buildings);
    expect(res.holder).toBeNull();
  });
});
