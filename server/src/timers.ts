// Server-enforced turn timers with canonical auto-actions. Every auto-action
// flows through the same applyAction path — the server simply synthesizes
// the action on timeout.

import type { GameAction, GameState } from '@catan/shared';
import { RESOURCES } from '@catan/shared';
import type { Rng } from '@catan/shared';

/** Placeholder auto-actions the sockets layer must resolve into real ones. */
export type AutoAction =
  | { action: GameAction; description: string }
  | { action: { type: '__autoSetupPlace' }; description: string }
  | { action: { type: '__autoChooseSteal' }; description: string };

/**
 * Compute the canonical auto-action for the current state.
 * Returns null when the phase is not covered or timers are off.
 */
export function autoActionFor(
  phase: string,
  activeSeat: number,
  state: GameState,
  rng: Rng,
): AutoAction | null {
  switch (phase) {
    case 'setupForward':
    case 'setupReverse':
      return { action: { type: '__autoSetupPlace' }, description: 'auto setup placement' };
    case 'turnPreroll':
      return { action: { type: 'rollDice' }, description: 'auto roll' };
    case 'turnMain':
      return { action: { type: 'endTurn' }, description: 'auto end turn' };
    case 'discard': {
      const pending = state.pendingDiscards.find((d) => !d.received);
      if (pending === undefined) return null;
      // Greedy discard from the largest pile (fixed order ties).
      const p = state.players[pending.seat]!;
      const res: Partial<Record<string, number>> = {};
      let left = pending.count;
      for (const r of RESOURCES) {
        const take = Math.min(p.resources[r], left);
        if (take > 0) {
          res[r] = take;
          left -= take;
        }
        if (left === 0) break;
      }
      return {
        action: { type: 'discard', resources: res as never },
        description: `auto discard ${pending.count}`,
      };
    }
    case 'robberMove': {
      const hexes = state.board.topology.hexes.filter((h) => h !== state.robber);
      if (hexes.length === 0) return null;
      return { action: { type: 'moveRobber', hex: rng.pick(hexes) }, description: 'auto robber move' };
    }
    case 'robberSteal':
      return { action: { type: '__autoChooseSteal' }, description: 'auto steal choice' };
    case 'specialBuild':
      return { action: { type: 'specialBuildDone' }, description: 'auto special build pass' };
    default:
      return null;
  }
}

/** Sub-timer durations (ms). */
export const SUB_TIMERS = {
  discard: 30_000,
  robberMove: 30_000,
  robberSteal: 30_000,
  specialBuild: 30_000,
} as const;

export function phaseTimerMs(
  phase: string,
  turnTimerSec: number,
): number | null {
  if (turnTimerSec === 0) return null;
  switch (phase) {
    case 'setupForward':
    case 'setupReverse':
    case 'turnPreroll':
    case 'turnMain':
      return turnTimerSec * 1000;
    case 'discard':
      return SUB_TIMERS.discard;
    case 'robberMove':
      return SUB_TIMERS.robberMove;
    case 'robberSteal':
      return SUB_TIMERS.robberSteal;
    case 'specialBuild':
      return SUB_TIMERS.specialBuild;
    default:
      return null;
  }
}

export type TimerPayload = {
  phase: string;
  deadlineUnixMs: number;
};
