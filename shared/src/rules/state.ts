// Game state types — single JSON-serializable state object, immutable updates.

import type { Board, PlayerCount } from '../board';
import type {
  BoardConfigKey,
  DevCardType,
  GameRules,
  PlayerColor,
  ResourceBag,
} from '../constants';
import type { GameEvent } from '../protocol';
import type { EdgeId, HexId, VertexId } from '../topology';

export type Phase =
  | 'setupForward'
  | 'setupReverse'
  | 'turnPreroll'
  | 'turnMain'
  | 'robberMove'
  | 'robberSteal'
  | 'discard'
  | 'specialBuild'
  | 'finished';

export interface DevCardInstance {
  id: string;
  type: DevCardType;
  /** Turn number when purchased (cards are unplayable on the purchase turn). */
  boughtOnTurn: number;
  played?: boolean;
}

export interface PlayerState {
  seat: number;
  name: string;
  color: PlayerColor;
  resources: ResourceBag;
  devHand: DevCardInstance[];
  playedKnights: number;
  /** Server-injected connectivity flag (not part of game logic). */
  connected: boolean;
  roadsLeft: number;
  settlementsLeft: number;
  citiesLeft: number;
}

export interface TradeOffer {
  id: string;
  /** Proposing seat. */
  proposer: number;
  give: Partial<ResourceBag>;
  receive: Partial<ResourceBag>;
  status: 'open' | 'completed' | 'cancelled';
  /** Offer id this is a counter of (root offers have null). */
  counterOf: string | null;
  /** Seats that declined (offer stays open). */
  declinedBy: number[];
}

export interface PendingDiscard {
  seat: number;
  count: number;
  received: boolean;
}

export interface SpecialBuildState {
  /** Seat whose window is currently open (null between windows). */
  seat: number | null;
  /** Seats that already used their window this round. */
  usedThisRound: Record<number, boolean>;
}

export interface GameState {
  config: BoardConfigKey;
  playerCount: number;
  /** Room-configured rule variants (VP target, discard threshold). */
  rules: GameRules;
  players: PlayerState[];
  board: Board;
  phase: Phase;
  activeSeat: number;
  turn: number;
  dice: { die1: number; die2: number } | null;
  buildings: Record<VertexId, { seat: number; type: 'settlement' | 'city' }>;
  roads: Record<EdgeId, number>;
  robber: HexId;
  bank: ResourceBag;
  devDeck: DevCardInstance[];
  /** Index of the next card to draw in devDeck. */
  devDeckIndex: number;
  trades: TradeOffer[];
  pendingDiscards: PendingDiscard[];
  specialBuild: SpecialBuildState | null;
  setupCursor: number;
  longestRoad: { holder: number | null; length: number };
  largestArmy: { holder: number | null; knights: number };
  /** Seat ids that must still act in a multi-seat phase (robber steal alternatives). */
  winner: number | null;
  /** Per-seat flags for this turn: dev card already played. */
  devCardPlayedThisTurn: boolean;
  /** Monotonic version — bumped on every accepted action (client cache key). */
  version: number;
}

export interface InitialPlayer {
  seat: number;
  name: string;
  color: PlayerColor;
}

export interface EngineOptions {
  playerCount: PlayerCount;
  players: InitialPlayer[];
  seed: string;
  /** Rule overrides; missing fields fall back to DEFAULT_RULES (10 VP, discard above 7). */
  rules?: Partial<GameRules>;
  /** Dice source override (balanced deck lives server-side). Default: 2×rng.int(6). */
  rollDice?: (state: GameState, rng: { int(n: number): number }) => { die1: number; die2: number };
}

/** All events emitted so far (append-only log lives server-side). */
export interface EventLog {
  events: GameEvent[];
}

export type VictoryBreakdown = {
  settlements: number;
  cities: number;
  vpCards: number;
  longestRoad: boolean;
  largestArmy: boolean;
};

/** Public VP for a seat (excludes hidden VP cards). */
export function publicVp(state: GameState, seat: number): number {
  let vp = 0;
  for (const b of Object.values(state.buildings)) {
    if (b.seat === seat) vp += b.type === 'settlement' ? 1 : 2;
  }
  if (state.longestRoad.holder === seat) vp += 2;
  if (state.largestArmy.holder === seat) vp += 2;
  return vp;
}

/** Total VP for a seat including hidden VP dev cards. */
export function totalVp(state: GameState, seat: number): number {
  const p = state.players[seat]!;
  const vpCards = p.devHand.filter((c) => c.type === 'victoryPoint' && !c.played).length;
  return publicVp(state, seat) + vpCards;
}

export function victoryBreakdown(state: GameState, seat: number): VictoryBreakdown {
  const p = state.players[seat]!;
  let settlements = 0;
  let cities = 0;
  for (const b of Object.values(state.buildings)) {
    if (b.seat !== seat) continue;
    if (b.type === 'settlement') settlements++;
    else cities++;
  }
  return {
    settlements,
    cities,
    vpCards: p.devHand.filter((c) => c.type === 'victoryPoint' && !c.played).length,
    longestRoad: state.longestRoad.holder === seat,
    largestArmy: state.largestArmy.holder === seat,
  };
}
