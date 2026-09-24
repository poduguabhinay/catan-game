// Seeded, deterministic board generation. Terrain multiset, token multiset
// (with the no-adjacent-6/8 constraint), harbor placement, and robber start
// are all derived from the seed.

import {
  boardConfigForPlayers,
  type BoardConfig,
  type BoardConfigKey,
  type Resource,
  type Terrain,
} from './constants';
import { createRng } from './rng';
import {
  type Axial,
  bigBoard,
  buildTopology,
  edgeOf,
  hexagon,
  hexId,
  parseHexId,
  type Edge,
  type EdgeId,
  type HexId,
  type Topology,
} from './topology';

export type HarborType = 'generic' | 'specialty';

export interface Harbor {
  type: HarborType;
  /** For specialty harbors: the 2:1 resource. */
  resource?: Resource;
}

export interface BoardHex {
  terrain: Terrain;
  /** null on desert. */
  token: number | null;
}

export interface Board {
  config: BoardConfigKey;
  topology: Topology;
  hexes: Record<HexId, BoardHex>;
  /** Harbor per occupied border edge id. */
  harbors: Record<EdgeId, Harbor>;
  robberHex: HexId;
  seed: string;
}

export type PlayerCount = 3 | 4 | 5 | 6 | 7 | 8;

/** Hex layout per board config: 19-hex, 30-hex extension, 37-hex radius-3. */
function shapeFor(key: BoardConfigKey): Axial[] {
  if (key === 'ext78') return hexagon(3);
  if (key === 'ext56') return bigBoard();
  return hexagon(2);
}

function isHot(token: number): boolean {
  return token === 6 || token === 8;
}

function tokensHaveAdjacentHot(topology: Topology, assignment: Record<HexId, number>): boolean {
  for (const h of topology.hexes) {
    const t = assignment[h]!;
    if (!isHot(t)) continue;
    for (const n of topology.hexNeighbors[h]!) {
      const nt = assignment[n];
      if (nt !== undefined && isHot(nt)) return true;
    }
  }
  return false;
}

/**
 * Deterministic constructive fallback: place 6/8 tokens first on a randomly
 * grown independent set of hexes, then fill the rest. Always yields a valid
 * assignment for every shipped config (hot tokens are far fewer than the
 * board's independence number).
 */
function constructiveTokens(
  topology: Topology,
  terrains: Record<HexId, Terrain>,
  config: BoardConfig,
  seed: string,
): Record<HexId, number> {
  const hot = config.tokens.filter(isHot);
  const cold = config.tokens.filter((t) => !isHot(t));
  const landHexes = topology.hexes.filter((h) => terrains[h] !== 'desert');
  for (let attempt = 0; attempt < 1000; attempt++) {
    const rng = createRng(`${seed}:fallback#${attempt}`);
    const order = rng.shuffle(landHexes);
    const hotHexes = new Set<HexId>();
    for (const h of order) {
      if (hotHexes.size === hot.length) break;
      if (topology.hexNeighbors[h]!.some((n) => hotHexes.has(n))) continue;
      hotHexes.add(h);
    }
    if (hotHexes.size < hot.length) continue;
    const hotTokens = rng.shuffle(hot);
    const coldTokens = rng.shuffle(cold);
    const assignment: Record<HexId, number> = {};
    let hi = 0;
    let ci = 0;
    for (const h of landHexes) {
      assignment[h] = hotHexes.has(h) ? hotTokens[hi++]! : coldTokens[ci++]!;
    }
    return assignment;
  }
  throw new Error(`no valid 6/8 token layout for config ${config.key}`);
}

export function generateBoard(playerCount: PlayerCount, seed: string): Board {
  const config = boardConfigForPlayers(playerCount);
  const topology = buildTopology(shapeFor(config.key));

  // --- Terrain assignment: shuffled multiset over canonical hex order ---
  const terrainRng = createRng(`${seed}:terrain`);
  const terrainsArr = terrainRng.shuffle(config.terrains);
  const terrains: Record<HexId, Terrain> = {};
  topology.hexes.forEach((h, i) => {
    terrains[h] = terrainsArr[i]!;
  });

  // --- Token assignment with no-adjacent-6/8 retry loop ---
  let tokens: Record<HexId, number> | null = null;
  let attempt = 0;
  while (attempt < 500 && tokens === null) {
    const rng = createRng(`${seed}:#${attempt}`);
    const shuffled = rng.shuffle(config.tokens);
    const candidate: Record<HexId, number> = {};
    let i = 0;
    for (const h of topology.hexes) {
      if (terrains[h] === 'desert') continue;
      candidate[h] = shuffled[i]!;
      i++;
    }
    if (!tokensHaveAdjacentHot(topology, candidate)) {
      tokens = candidate;
    }
    attempt++;
  }
  if (tokens === null) {
    // Constructive fallback: always valid (defended by board tests).
    tokens = constructiveTokens(topology, terrains, config, seed);
  }

  const hexes: Record<HexId, BoardHex> = {};
  for (const h of topology.hexes) {
    hexes[h] = { terrain: terrains[h]!, token: terrains[h] === 'desert' ? null : tokens[h] ?? null };
  }

  // --- Robber starts on the first desert in canonical order ---
  const desertHex = topology.hexes.find((h) => terrains[h] === 'desert');
  if (desertHex === undefined) throw new Error('board config without desert');

  // --- Harbors: evenly spaced border edges, shuffled type multiset ---
  const harborRng = createRng(`${seed}:harbors`);
  const borderCount = topology.borderEdges.length;
  const harborCount = config.specialtyHarbors.length + config.genericHarbors;
  const chosenEdges: Edge[] = [];
  const usedIndices = new Set<number>();
  for (let i = 0; i < harborCount; i++) {
    let idx = Math.round((i * borderCount) / harborCount);
    // Avoid two harbors on the same border edge when rounding collides.
    while (usedIndices.has(idx)) idx = (idx + 1) % borderCount;
    usedIndices.add(idx);
    chosenEdges.push(topology.borderEdges[idx]!);
  }

  const harborTypes: Harbor[] = [
    ...config.specialtyHarbors.map((res) => ({ type: 'specialty', resource: res }) as Harbor),
    ...Array.from({ length: config.genericHarbors }, () => ({ type: 'generic' }) as Harbor),
  ];
  const shuffledHarbors = harborRng.shuffle(harborTypes);

  const harbors: Record<EdgeId, Harbor> = {};
  chosenEdges.forEach((e, i) => {
    harbors[edgeOf(e)] = shuffledHarbors[i]!;
  });

  return { config: config.key, topology, hexes, harbors, robberHex: desertHex, seed };
}

/** Convenience: the player-visible hex at axial coords (testing/debug). */
export function hexAt(board: Board, q: number, r: number): BoardHex {
  const h = board.hexes[hexId(q, r)];
  if (h === undefined) throw new Error(`no hex at ${q},${r}`);
  return h;
}

/** All hex ids adjacent to a vertex (1-3). */
export function hexesAtVertex(board: Board, vertex: number): HexId[] {
  return board.topology.vertexHexes[vertex] ?? [];
}

/** True if the robber could move to this hex (any non-current hex). */
export function canMoveRobberTo(board: Board, hex: HexId): boolean {
  return board.hexes[hex] !== undefined && hex !== board.robberHex;
}

/** Harbor vertices: every vertex touching a harbor border edge. */
export function harborVertices(board: Board): Record<EdgeId, [number, number]> {
  const out: Record<EdgeId, [number, number]> = {};
  for (const eid of Object.keys(board.harbors)) {
    const [a, b] = board.topology.edgeEndpoints[eid]!;
    out[eid] = [a, b];
  }
  return out;
}

// parseHexId re-export keeps board consumers from importing topology internals.
export { parseHexId };
