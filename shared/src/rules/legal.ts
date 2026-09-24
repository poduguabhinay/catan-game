// Legal-move queries — shared between server validation and client
// placement highlighting. All functions are pure reads over GameState.

import type { Board } from '../board';
import {
  BUILD_COSTS,
  canAfford,
  TERRAIN_RESOURCE,
  type Resource,
  type ResourceBag,
} from '../constants';
import type { EdgeId, HexId, VertexId } from '../topology';
import type { GameState, PlayerState } from './state';

/** Distance rule: no existing building on the vertex or any adjacent vertex. */
export function vertexRespectsDistanceRule(
  state: GameState,
  vertex: VertexId,
): boolean {
  if (state.buildings[vertex] !== undefined) return false;
  for (const n of state.board.topology.adjacentVertices[vertex] ?? []) {
    if (state.buildings[n] !== undefined) return false;
  }
  return true;
}

/** Is a settlement legal at `vertex` for `seat` (setup phase ignores roads)? */
export function canPlaceSettlement(
  state: GameState,
  seat: number,
  vertex: VertexId,
  isSetup: boolean,
): boolean {
  const player = state.players[seat]!;
  if (isSetup) {
    return vertexRespectsDistanceRule(state, vertex);
  }
  if (player.settlementsLeft <= 0) return false;
  if (!vertexRespectsDistanceRule(state, vertex)) return false;
  // Must touch one of the player's roads.
  const touchesRoad = (state.board.topology.vertexEdges[vertex] ?? []).some(
    (eid) => state.roads[eid] === seat,
  );
  if (!touchesRoad) return false;
  return canAfford(player.resources, BUILD_COSTS.settlement);
}

/** Is a city upgrade legal at `vertex` for `seat`? */
export function canPlaceCity(state: GameState, seat: number, vertex: VertexId): boolean {
  const b = state.buildings[vertex];
  const player = state.players[seat]!;
  return (
    b !== undefined &&
    b.seat === seat &&
    b.type === 'settlement' &&
    player.citiesLeft > 0 &&
    canAfford(player.resources, BUILD_COSTS.city)
  );
}

/**
 * Is a road legal on `edge` for `seat`?
 * Placement rule: the edge must be empty and at least one endpoint must
 * touch the player's network (own building on that vertex OR own road
 * through it). Opponent buildings on a vertex do NOT forbid placement —
 * they only sever longest-road computation.
 */
export function canPlaceRoad(state: GameState, seat: number, edge: EdgeId): boolean {
  const player = state.players[seat]!;
  if (player.roadsLeft <= 0) return false;
  if (state.roads[edge] !== undefined) return false;
  const endpoints = state.board.topology.edgeEndpoints[edge];
  if (endpoints === undefined) return false;
  const [a, b] = endpoints;
  const networkAt = (v: VertexId): boolean => {
    if (state.buildings[v]?.seat === seat) return true;
    return (state.board.topology.vertexEdges[v] ?? []).some(
      (eid) => state.roads[eid] === seat,
    );
  };
  if (!networkAt(a) && !networkAt(b)) return false;
  return canAfford(player.resources, BUILD_COSTS.road);
}

/** Setup road: must touch the settlement placed in the same draft step. */
export function canPlaceSetupRoad(
  state: GameState,
  seat: number,
  edge: EdgeId,
  settlementVertex: VertexId,
): boolean {
  if (state.roads[edge] !== undefined) return false;
  const endpoints = state.board.topology.edgeEndpoints[edge];
  if (endpoints === undefined) return false;
  const [a, b] = endpoints;
  return a === settlementVertex || b === settlementVertex;
}

/** All legal settlement vertices for `seat` in the given mode. */
export function legalSettlementVertices(
  state: GameState,
  seat: number,
  isSetup: boolean,
): VertexId[] {
  return state.board.topology.vertices.filter((v) =>
    canPlaceSettlement(state, seat, v, isSetup),
  );
}

/** All legal city vertices for `seat`. */
export function legalCityVertices(state: GameState, seat: number): VertexId[] {
  return state.board.topology.vertices.filter((v) => canPlaceCity(state, seat, v));
}

/** All legal road edges for `seat`. */
export function legalRoadEdges(state: GameState, seat: number): EdgeId[] {
  return state.board.topology.edges
    .map((e) => (e[0] < e[1] ? `${e[0]}-${e[1]}` : `${e[1]}-${e[0]}`))
    .filter((eid) => canPlaceRoad(state, seat, eid));
}

/** Legal robber destinations: any hex except the current robber hex. */
export function legalRobberHexes(state: GameState): HexId[] {
  return state.board.topology.hexes.filter((h) => h !== state.robber);
}

/** Opponents with a building adjacent to `hex` (robber steal candidates). */
export function stealCandidates(state: GameState, hex: HexId): number[] {
  const seats = new Set<number>();
  for (const v of state.board.topology.hexVertices[hex] ?? []) {
    const b = state.buildings[v];
    if (b !== undefined) seats.add(b.seat);
  }
  const active = state.activeSeat;
  return [...seats].filter((s) => s !== active);
}

/** Best bank-trade rate for `give` for `seat` (4 / 3 / 2). */
export function bestTradeRate(state: GameState, seat: number, give: Resource): number {
  const topology = state.board.topology;
  for (const [eid, harbor] of Object.entries(state.board.harbors)) {
    if (harbor.type === 'generic') continue;
    if (harbor.resource !== give) continue;
    const [v1, v2] = topology.edgeEndpoints[eid]!;
    const owns = [v1, v2].some((v) => state.buildings[v]?.seat === seat);
    if (owns) return 2;
  }
  for (const [eid, harbor] of Object.entries(state.board.harbors)) {
    if (harbor.type !== 'specialty') continue;
    const [v1, v2] = topology.edgeEndpoints[eid]!;
    const owns = [v1, v2].some((v) => state.buildings[v]?.seat === seat);
    if (owns) return 3;
  }
  return 4;
}

/** Hexes producing for the player when `number` rolls (robber blocks). */
export function producingHexesForPlayer(
  board: Board,
  buildings: GameState['buildings'],
  robber: HexId,
  seat: number,
  number: number,
): { hex: HexId; resource: Resource; amount: number }[] {
  const out: { hex: HexId; resource: Resource; amount: number }[] = [];
  for (const hex of board.topology.hexes) {
    if (hex === robber) continue;
    const hexData = board.hexes[hex]!;
    if (hexData.token !== number) continue;
    const resource = TERRAIN_RESOURCE[hexData.terrain];
    if (resource === null) continue;
    for (const v of board.topology.hexVertices[hex]!) {
      const b = buildings[v];
      if (b === undefined || b.seat !== seat) continue;
      out.push({ hex, resource, amount: b.type === 'settlement' ? 1 : 2 });
    }
  }
  return out;
}

/** Player's harbor rate info for UI (rate per resource). */
export function harborRates(state: GameState, seat: number): Record<Resource, number> {
  const rates: Record<Resource, number> = {
    wood: 4, brick: 4, sheep: 4, wheat: 4, ore: 4,
  };
  let hasGeneric = false;
  const topology = state.board.topology;
  for (const [eid, harbor] of Object.entries(state.board.harbors)) {
    const [v1, v2] = topology.edgeEndpoints[eid]!;
    const owns = [v1, v2].some((v) => state.buildings[v]?.seat === seat);
    if (!owns) continue;
    if (harbor.type === 'generic') {
      hasGeneric = true;
    } else if (harbor.resource !== undefined) {
      rates[harbor.resource] = Math.min(rates[harbor.resource], 2);
    }
  }
  if (hasGeneric) {
    for (const r of Object.keys(rates) as Resource[]) {
      rates[r] = Math.min(rates[r], 3);
    }
  }
  return rates;
}

export function playerTotal(bag: ResourceBag): number {
  return bag.wood + bag.brick + bag.sheep + bag.wheat + bag.ore;
}

export function playerCanBuyDev(state: GameState, seat: number): boolean {
  const p: PlayerState = state.players[seat]!;
  return (
    state.devDeckIndex < state.devDeck.length &&
    canAfford(p.resources, BUILD_COSTS.devCard)
  );
}
