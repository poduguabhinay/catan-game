// Board topology: axial hex coordinates (pointy-top, redblobgames convention),
// vertex/edge identity derived from rounded pixel positions. Pure module —
// no terrain or game state.

export interface Axial {
  q: number;
  r: number;
}

/** s coordinate of cube space (derived, not stored). */
export function cubeS({ q, r }: Axial): number {
  return -q - r;
}

/** Pointy-top axial neighbor directions, clockwise from east. */
export const HEX_DIRS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
] as const;

export type HexId = string; // `${q},${r}`
export type VertexId = number; // 0..53 (base) / 0..79 (ext56) / 0..95 (ext78)
export type Edge = [VertexId, VertexId]; // sorted tuple [min, max]
export type EdgeId = string; // `${a}-${b}`

export function hexId(q: number, r: number): HexId {
  return `${q},${r}`;
}

export function edgeId(a: VertexId, b: VertexId): EdgeId {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export function edgeOf(e: Edge): EdgeId {
  return edgeId(e[0], e[1]);
}

export function parseHexId(id: HexId): Axial {
  const [q, r] = id.split(',');
  return { q: Number(q), r: Number(r) };
}

// ---------------------------------------------------------------------------
// Pixel layout — the SAME constants must be used for vertex/edge derivation
// and rendering, so dedupe keys and SVG coordinates always agree.
// ---------------------------------------------------------------------------

export const HEX_SIZE = 100.0;
const SQRT3 = Math.sqrt(3);

export interface Pt {
  x: number;
  y: number;
}

export function hexToPixel(q: number, r: number): Pt {
  return { x: HEX_SIZE * SQRT3 * (q + r / 2), y: HEX_SIZE * 1.5 * r };
}

/**
 * Exact integer lattice position of a pointy-top hex corner.
 * All corners live on a half-unit grid: X = (2q + r + k) units of S·√3/2
 * (k ∈ {-1,0,1} for corner offsets), Y = (3r + m) units of S/2
 * (m ∈ {-2,-1,1,2}). Integer keys dedupe EXACTLY — no float rounding,
 * no coordinate drift between neighbor hexes.
 */
export interface LatticePt {
  /** x in units of S·√3/2 */
  gx: number;
  /** y in units of S/2 */
  gy: number;
}

/** Corner offsets (clockwise from east) in lattice units. */
const CORNER_OFFSETS: readonly [number, number][] = [
  [1, -1], // 330°  (S·√3/2, −S/2)
  [1, 1], // 30°   (S·√3/2, +S/2)
  [0, 2], // 90°   (0, +S)
  [-1, 1], // 150°
  [-1, -1], // 210°
  [0, -2], // 270°
] as const;

export function hexCornerLattice(q: number, r: number): LatticePt[] {
  // center lattice: (2q + r, 3r) in the same units.
  return CORNER_OFFSETS.map(([k, m]) => ({ gx: 2 * q + r + k, gy: 3 * r + m }));
}

/** Pixel position of a lattice point (single rounding at the very end). */
export function latticeToPixel(p: LatticePt): Pt {
  return {
    x: round6((p.gx * (HEX_SIZE * SQRT3)) / 2),
    y: round6((p.gy * HEX_SIZE) / 2),
  };
}

/** Pointy-top corner pixel positions, clockwise from east (rendering). */
export function hexCorners(q: number, r: number): Pt[] {
  return hexCornerLattice(q, r).map(latticeToPixel);
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** Regular hexagon of given radius (radius 2 = standard 19-hex board). */
export function hexagon(radius: number): Axial[] {
  const out: Axial[] = [];
  for (let r = -radius; r <= radius; r++) {
    const qMin = Math.max(-radius, -r - radius);
    const qMax = Math.min(radius, -r + radius);
    for (let q = qMin; q <= qMax; q++) out.push({ q, r });
  }
  return out;
}

/**
 * 5-6 player extension board: rows of widths 3,4,5,6,5,4,3 (30 hexes), every
 * row centred on the same x (pixel x ∝ q + r/2) so the island is symmetric.
 */
export function bigBoard(): Axial[] {
  const rows: Array<[number, number, number]> = [
    // [r, qMin, qMax]
    [-3, 0, 2],
    [-2, -1, 2],
    [-1, -2, 2],
    [0, -3, 2],
    [1, -3, 1],
    [2, -3, 0],
    [3, -3, -1],
  ];
  const out: Axial[] = [];
  for (const [r, qMin, qMax] of rows) {
    for (let q = qMin; q <= qMax; q++) out.push({ q, r });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Topology
// ---------------------------------------------------------------------------

export interface Topology {
  /** Canonical hex order (sorted by r then q). */
  hexes: HexId[];
  vertices: VertexId[];
  edges: Edge[];
  /** Hex -> its 6 neighbor hex ids present on the board (3-4 on the border). */
  hexNeighbors: Record<HexId, HexId[]>;
  /** Hex -> its 6 corner vertex ids (clockwise from east). */
  hexVertices: Record<HexId, VertexId[]>;
  /** Hex -> its 6 edge ids (clockwise from east). */
  hexEdges: Record<HexId, EdgeId[]>;
  /** Vertex -> adjacent hex ids (1-3). */
  vertexHexes: Record<VertexId, HexId[]>;
  /** Edge -> adjacent hex ids (1-2). */
  edgeHexes: Record<EdgeId, HexId[]>;
  /** Vertex -> adjacent edge ids (2-3). */
  vertexEdges: Record<VertexId, EdgeId[]>;
  /** Vertex -> adjacent vertices via a shared edge (2-3). */
  adjacentVertices: Record<VertexId, VertexId[]>;
  /** Edge -> endpoints. */
  edgeEndpoints: Record<EdgeId, Edge>;
  /** Border edges (touched by exactly 1 hex) in cyclic board order. */
  borderEdges: Edge[];
  /** Pixel position per vertex. */
  vertexPos: Record<VertexId, Pt>;
}

/**
 * Derive the complete board graph from a list of hexes. Vertices are deduped
 * by rounded pixel position, numbered in first-seen order over canonical
 * hex order. Deterministic for a given shape.
 */
export function buildTopology(shape: readonly Axial[]): Topology {
  const hexes = [...shape]
    .map((h) => ({ q: h.q, r: h.r }))
    .sort((a, b) => a.r - b.r || a.q - b.q);

  const latticeToVertex = new Map<string, VertexId>();
  const vertexPos: Record<VertexId, Pt> = {};
  const hexVertices: Record<HexId, VertexId[]> = {};
  const hexEdgeIds: Record<HexId, EdgeId[]> = {};
  const edgeSet = new Map<EdgeId, { hexes: HexId[]; endpoints: Edge }>();
  const vertexEdges: Record<VertexId, EdgeId[]> = {};
  const adjacentVertices: Record<VertexId, VertexId[]> = {};
  const vertexHexes: Record<VertexId, HexId[]> = {};

  const vertexAt = (lp: LatticePt): VertexId => {
    const key = `${lp.gx},${lp.gy}`;
    let v = latticeToVertex.get(key);
    if (v === undefined) {
      v = latticeToVertex.size;
      latticeToVertex.set(key, v);
      vertexPos[v] = latticeToPixel(lp);
      vertexEdges[v] = [];
      adjacentVertices[v] = [];
      vertexHexes[v] = [];
    }
    return v;
  };

  for (const { q, r } of hexes) {
    const id = hexId(q, r);
    const cornerLattice = hexCornerLattice(q, r);
    const vids = cornerLattice.map((lp) => vertexAt(lp));
    hexVertices[id] = vids;

    // Register hex on each of its corner vertices (dedupe: a vertex can be
    // hit twice only for degenerate shapes; standard shapes never do).
    for (const v of vids) {
      if (!vertexHexes[v]!.includes(id)) vertexHexes[v]!.push(id);
    }

    const edgeIds: EdgeId[] = [];
    for (let i = 0; i < 6; i++) {
      const a = vids[i]!;
      const b = vids[(i + 1) % 6]!;
      const eid = edgeId(a, b);
      edgeIds.push(eid);
      let entry = edgeSet.get(eid);
      if (entry === undefined) {
        entry = { hexes: [], endpoints: [a, b] };
        edgeSet.set(eid, entry);
        vertexEdges[a]!.push(eid);
        vertexEdges[b]!.push(eid);
        if (!adjacentVertices[a]!.includes(b)) adjacentVertices[a]!.push(b);
        if (!adjacentVertices[b]!.includes(a)) adjacentVertices[b]!.push(a);
      }
      if (!entry.hexes.includes(id)) entry.hexes.push(id);
    }
    hexEdgeIds[id] = edgeIds;
  }

  const hexNeighbors: Record<HexId, HexId[]> = {};
  for (const { q, r } of hexes) {
    const id = hexId(q, r);
    const neighbors: HexId[] = [];
    for (const d of HEX_DIRS) {
      const nId = hexId(q + d.q, r + d.r);
      if (hexVertices[nId] !== undefined) neighbors.push(nId);
    }
    hexNeighbors[id] = neighbors;
  }

  // Border edges in cyclic order: sort the 1-hex edges geometrically by angle
  // around the board center (stable for all shapes we generate).
  const borderEdges = [...edgeSet.entries()]
    .filter(([, e]) => e.hexes.length === 1)
    .map(([eid, e]) => {
      const [a, b] = e.endpoints;
      const pa = vertexPos[a]!;
      const pb = vertexPos[b]!;
      const mx = (pa.x + pb.x) / 2;
      const my = (pa.y + pb.y) / 2;
      return { eid, edge: e.endpoints, mx, my };
    });

  let cx = 0;
  let cy = 0;
  for (const b of borderEdges) {
    cx += b.mx;
    cy += b.my;
  }
  cx /= borderEdges.length;
  cy /= borderEdges.length;
  borderEdges.sort((a, b) => {
    const angA = Math.atan2(a.my - cy, a.mx - cx);
    const angB = Math.atan2(b.my - cy, b.mx - cx);
    return angA - angB;
  });

  const edgeHexes: Record<EdgeId, HexId[]> = {};
  const edgeEndpoints: Record<EdgeId, Edge> = {};
  const edges: Edge[] = [];
  for (const [eid, e] of edgeSet) {
    edgeHexes[eid] = e.hexes;
    edgeEndpoints[eid] = e.endpoints;
    edges.push(e.endpoints);
  }

  const vertices = [...latticeToVertex.values()].sort((a, b) => a - b);

  return {
    hexes: hexes.map((h) => hexId(h.q, h.r)),
    vertices,
    edges,
    hexNeighbors,
    hexVertices,
    hexEdges: hexEdgeIds,
    vertexHexes,
    edgeHexes,
    vertexEdges,
    adjacentVertices,
    edgeEndpoints,
    borderEdges: borderEdges.map((b) => b.edge),
    vertexPos,
  };
}

/** Pixel segment for an edge (rendering helper). */
export function edgeToSegment(topology: Topology, eid: EdgeId): [Pt, Pt] {
  const [a, b] = topology.edgeEndpoints[eid]!;
  return [topology.vertexPos[a]!, topology.vertexPos[b]!];
}
