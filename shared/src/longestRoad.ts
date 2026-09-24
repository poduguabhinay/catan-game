// Longest road: exhaustive DFS over a player's edge subgraph with edge
// backtracking. An opponent settlement/city severs the chain (blocked
// vertex); loops are legal (edge-simple, not vertex-simple paths).
// Max 15 roads per player bounds the search; no caching needed.

import type { EdgeId, Topology, VertexId } from './topology';

export interface RoadNetwork {
  /** The player's road edge ids. */
  roads: EdgeId[];
  /** Vertices occupied by OPPONENT settlements/cities (block traversal). */
  blockedVertices: Set<VertexId>;
}

/**
 * Longest continuous road length (in edges) for one player.
 * Returns 0 when the player has no roads.
 */
export function longestRoadLength(
  roads: readonly EdgeId[],
  blockedVertices: ReadonlySet<VertexId>,
  topology: Topology,
): number {
  if (roads.length === 0) return 0;

  // Player's edge subgraph: vertex -> set of incident road edge ids.
  const incident = new Map<VertexId, EdgeId[]>();
  for (const eid of roads) {
    const [a, b] = topology.edgeEndpoints[eid]!;
    for (const v of [a, b]) {
      const list = incident.get(v);
      if (list === undefined) incident.set(v, [eid]);
      else if (!list.includes(eid)) list.push(eid);
    }
  }

  // Split into components: vertices joined through UNBLOCKED shared vertices.
  // Blocked vertices cut connectivity — an opponent settlement splits a chain.
  const componentOf = new Map<VertexId, number>();
  const components: VertexId[][] = [];
  for (const start of incident.keys()) {
    if (componentOf.has(start) || blockedVertices.has(start)) continue;
    const comp: VertexId[] = [];
    const queue: VertexId[] = [start];
    componentOf.set(start, components.length);
    while (queue.length > 0) {
      const v = queue.pop()!;
      comp.push(v);
      for (const eid of incident.get(v)!) {
        const [a, b] = topology.edgeEndpoints[eid]!;
        const other = a === v ? b : a;
        if (componentOf.has(other) || blockedVertices.has(other)) continue;
        componentOf.set(other, components.length);
        queue.push(other);
      }
    }
    components.push(comp);
  }

  let best = 0;
  // Start vertices: all unblocked component vertices, plus blocked vertices
  // that touch the player's roads (a chain may lead AWAY from an opponent
  // settlement, but never through it).
  const blockedStarts = [...blockedVertices].filter((v) => incident.has(v));
  const starts = [...new Set([...components.flat(), ...blockedStarts])];
  for (const start of starts) {
    for (const firstEdge of incident.get(start) ?? []) {
      const used = new Set<EdgeId>([firstEdge]);
      const [a, b] = topology.edgeEndpoints[firstEdge]!;
      const far = a === start ? b : a;
      best = Math.max(best, 1);
      // The far endpoint of the first edge may be blocked: the edge counts
      // and the path dead-ends there.
      if (blockedVertices.has(far)) continue;
      best = Math.max(best, dfsExtend(far, used, incident, blockedVertices, topology));
    }
  }
  return best;
}

function dfsExtend(
  current: VertexId,
  used: Set<EdgeId>,
  incident: ReadonlyMap<VertexId, EdgeId[]>,
  blocked: ReadonlySet<VertexId>,
  topology: Topology,
): number {
  let best = used.size;
  for (const eid of incident.get(current) ?? []) {
    if (used.has(eid)) continue;
    const [a, b] = topology.edgeEndpoints[eid]!;
    const next = a === current ? b : a;
    // An opponent settlement/city CUTS the road: the edge leading into it
    // still counts, but the path cannot continue through the blocked vertex.
    if (blocked.has(next)) {
      best = Math.max(best, used.size + 1);
      continue;
    }
    // Vertices may repeat (loops are legal); only edges are constrained.
    used.add(eid);
    best = Math.max(best, dfsExtend(next, used, incident, blocked, topology));
    used.delete(eid);
  }
  return best;
}
// ---------------------------------------------------------------------------

export interface PlayerRoads {
  seat: number;
  roads: EdgeId[];
}

export interface LongestRoadAward {
  holder: number | null;
  length: number; // length of the current holder's road (0 if none)
}

/**
 * Recompute the longest-road award over all players.
 * - First claim: unique maximum >= 5.
 * - Steal: strictly greater than current holder's length.
 * - Ties keep the current holder.
 * - If the holder's network was broken below the field and no unique >= 5
 *   maximum exists, the award is set aside (holder: null).
 */
export function computeLongestRoadAward(
  current: LongestRoadAward,
  allPlayers: readonly PlayerRoads[],
  buildings: ReadonlyMap<VertexId, number>, // vertex -> seat of owner (any settlement/city)
  topology: Topology,
): LongestRoadAward {
  // Per-player best length, accounting for opponent settlements blocking.
  const lengths = allPlayers.map(({ seat, roads }) => {
    const blocked = new Set<VertexId>();
    for (const [v, ownerSeat] of buildings) {
      if (ownerSeat !== seat) blocked.add(v);
    }
    return { seat, length: longestRoadLength(roads, blocked, topology) };
  });

  const maxLen = Math.max(...lengths.map((l) => l.length));

  if (current.holder === null) {
    if (maxLen < 5) return { holder: null, length: current.length };
    const top = lengths.filter((l) => l.length === maxLen);
    if (top.length > 1) return { holder: null, length: current.length };
    return { holder: top[0]!.seat, length: maxLen };
  }

  const holderLen = lengths.find((l) => l.seat === current.holder)?.length ?? 0;

  // Holder still has the strict maximum (ties keep the card).
  if (holderLen === maxLen && maxLen >= 5) {
    return { holder: current.holder, length: holderLen };
  }

  // Someone exceeds the holder: unique max >= 5 steals.
  if (maxLen >= 5) {
    const top = lengths.filter((l) => l.length === maxLen);
    if (top.length === 1 && top[0]!.seat !== current.holder) {
      return { holder: top[0]!.seat, length: maxLen };
    }
    // Tie at a new max between others: current holder lost the strict max.
    if (top.some((l) => l.seat === current.holder)) {
      return { holder: current.holder, length: holderLen };
    }
    return { holder: null, length: 0 }; // set aside until a unique max >= 5
  }

  // Holder's road fell below 5 and nobody else has >= 5: set aside.
  return { holder: null, length: 0 };
}
