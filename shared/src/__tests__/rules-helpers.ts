// Rules engine test helpers: deterministic state fixtures.

import { applyAction, createGame, type ActionResult, type RollDiceFn } from '../rules/reducer';
import type { GameState } from '../rules/state';
import type { GameAction, GameEvent } from '../protocol';
import { createRng, type Rng } from '../rng';
import {
  canPlaceSetupRoad,
  legalSettlementVertices,
} from '../rules/legal';
import type { EdgeId, VertexId } from '../topology';
import type { PlayerCount } from '../board';
import { PLAYER_COLORS, type GameRules, type PlayerColor } from '../constants';

export function makePlayers(n: number): Array<{ seat: number; name: string; color: PlayerColor }> {
  return Array.from({ length: n }, (_, i) => ({ seat: i, name: `P${i}`, color: PLAYER_COLORS[i]! }));
}

export function newGame(
  playerCount: PlayerCount,
  seed = 'test-seed',
  rules?: Partial<GameRules>,
): GameState {
  return createGame({ playerCount, players: makePlayers(playerCount), seed, ...(rules ? { rules } : {}) });
}

export function act(
  state: GameState,
  action: GameAction,
  opts: { seed?: string; rollDice?: RollDiceFn } = {},
): ActionResult {
  const rng: Rng = createRng(opts.seed ?? `${state.board.seed}:act${state.version}`);
  return applyAction(state, action, rng, opts.rollDice);
}

/** Force a specific dice roll for the next rollDice action. */
export function fixedRoll(die1: number, die2: number): RollDiceFn {
  return () => ({ die1, die2 });
}

/** Complete the whole setup draft automatically with legal placements. */
export function runSetup(state: GameState, opts: { seed?: string } = {}): GameState {
  let s = state;
  let guard = 0;
  while ((s.phase === 'setupForward' || s.phase === 'setupReverse') && guard++ < 20) {
    const seat = s.activeSeat;
    const vertex = legalSettlementVertices(s, seat, true)[0]!;
    // First legal edge touching the settlement.
    const edges = s.board.topology.vertexEdges[vertex]!;
    const edge = edges.find((e) => canPlaceSetupRoad(s, seat, e, vertex)) ?? edges[0]!;
    const res = act(s, { type: 'setupPlace', settlementVertex: vertex, roadEdge: edge }, opts);
    if (!res.ok) throw new Error(`setup failed for seat ${seat}: ${res.error}`);
    s = res.state;
  }
  return s;
}

/** Give resources to a seat directly (test helper — bypasses production). */
export function give(state: GameState, seat: number, resources: Partial<Record<'wood' | 'brick' | 'sheep' | 'wheat' | 'ore', number>>): GameState {
  const p = state.players[seat]!;
  const players = [...state.players];
  players[seat] = {
    ...p,
    resources: { ...p.resources },
  };
  for (const [r, n] of Object.entries(resources)) {
    const bag = players[seat]!.resources as Record<string, number | undefined>;
    bag[r] = (bag[r] ?? 0) + (n ?? 0);
  }
  return { ...state, players };
}

/** Place a road for seat bypassing cost (test helper via free build path). */
export function forceRoad(state: GameState, seat: number, edge: EdgeId): GameState {
  return { ...state, roads: { ...state.roads, [edge]: seat }, players: state.players.map((p, i) => i === seat ? { ...p, roadsLeft: p.roadsLeft - 1 } : p) };
}

export type { GameState, GameAction, GameEvent, VertexId, EdgeId };
