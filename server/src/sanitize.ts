// Snapshot sanitizer: full GameState -> per-seat view. Hides other players'
// resource compositions and dev-card identities; keeps public counts.

import type { GameState } from '@catan/shared';
import { publicVp } from '@catan/shared';
import type { Resource } from '@catan/shared';

export interface PublicPlayer {
  seat: number;
  name: string;
  color: string;
  resourceCount: number;
  devCardCount: number;
  playedKnights: number;
  connected: boolean;
  publicVp: number;
  roadsLeft: number;
  settlementsLeft: number;
  citiesLeft: number;
}

export interface OwnView {
  seat: number;
  resources: Record<Resource, number>;
  devHand: Array<{ id: string; type: string; boughtOnTurn: number; played: boolean }>;
  totalVp: number;
}

export interface PersonalSnapshot {
  version: number;
  config: GameState['config'];
  playerCount: number;
  rules: GameState['rules'];
  phase: GameState['phase'];
  activeSeat: number;
  specialBuildSeat: number | null;
  turn: number;
  dice: { die1: number; die2: number } | null;
  board: GameState['board'];
  buildings: GameState['buildings'];
  roads: GameState['roads'];
  robber: GameState['robber'];
  bank: GameState['bank'];
  devDeckCount: number;
  trades: GameState['trades'];
  pendingDiscards: Array<{ seat: number; count: number; received: boolean }>;
  longestRoad: GameState['longestRoad'];
  largestArmy: GameState['largestArmy'];
  winner: number | null;
  players: PublicPlayer[];
  you: OwnView;
}

function ownTotalVp(state: GameState, seat: number): number {
  const p = state.players[seat]!;
  return publicVp(state, seat) + p.devHand.filter((c) => c.type === 'victoryPoint' && !c.played).length;
}

export function sanitize(state: GameState, seat: number): PersonalSnapshot {
  const players: PublicPlayer[] = state.players.map((p) => {
    const resourceCount =
      p.resources.wood + p.resources.brick + p.resources.sheep + p.resources.wheat + p.resources.ore;
    return {
      seat: p.seat,
      name: p.name,
      color: p.color,
      resourceCount,
      devCardCount: p.devHand.filter((c) => !c.played).length,
      playedKnights: p.playedKnights,
      connected: p.connected,
      publicVp: publicVp(state, p.seat),
      roadsLeft: p.roadsLeft,
      settlementsLeft: p.settlementsLeft,
      citiesLeft: p.citiesLeft,
    };
  });

  const own = state.players[seat]!;

  return {
    version: state.version,
    config: state.config,
    playerCount: state.playerCount,
    rules: { ...state.rules },
    phase: state.phase,
    activeSeat: state.activeSeat,
    specialBuildSeat: state.specialBuild?.seat ?? null,
    turn: state.turn,
    dice: state.dice,
    board: state.board,
    buildings: state.buildings,
    roads: state.roads,
    robber: state.robber,
    bank: state.bank,
    devDeckCount: state.devDeck.length - state.devDeckIndex,
    trades: state.trades,
    pendingDiscards: state.pendingDiscards.map((d) => ({ ...d })),
    longestRoad: state.longestRoad,
    largestArmy: state.largestArmy,
    winner: state.winner,
    players,
    you: {
      seat,
      resources: { ...own.resources },
      devHand: own.devHand
        .filter((c) => !c.played)
        .map((c) => ({ id: c.id, type: c.type, boughtOnTurn: c.boughtOnTurn, played: c.played === true })),
      totalVp: ownTotalVp(state, seat),
    },
  };
}
