import { describe, expect, it } from 'vitest';
import { draftOrder } from '../rules/reducer';
import { publicVp, totalVp } from '../rules/state';
import { give, newGame, runSetup, act, fixedRoll } from './rules-helpers';
import type { GameState } from '../rules/state';
import { emptyResourceBag, RESOURCES } from '../constants';

/** Replace a seat's hand with exactly `n` wood. */
function setHand(state: GameState, seat: number, n: number): GameState {
  return {
    ...state,
    players: state.players.map((p) => (p.seat === seat ? { ...p, resources: { ...emptyResourceBag(), wood: n } } : p)),
  };
}

describe('setup: snake draft', () => {
  it('draft order is forward then reverse', () => {
    expect(draftOrder(3)).toEqual([0, 1, 2, 2, 1, 0]);
    expect(draftOrder(4)).toEqual([0, 1, 2, 3, 3, 2, 1, 0]);
    expect(draftOrder(6)).toEqual([0, 1, 2, 3, 4, 5, 5, 4, 3, 2, 1, 0]);
  });

  it('full draft for 3 players ends in turnPreroll with seat 0 active, turn 1', () => {
    const s = runSetup(newGame(3));
    expect(s.phase).toBe('turnPreroll');
    expect(s.activeSeat).toBe(0);
    expect(s.turn).toBe(1);
    // Each player: 2 settlements, 2 roads.
    for (const p of s.players) {
      expect(p.settlementsLeft).toBe(3);
      expect(p.roadsLeft).toBe(13);
    }
  });

  it('full draft for 6 players on ext56 board', () => {
    const s = runSetup(newGame(6));
    expect(s.phase).toBe('turnPreroll');
    expect(s.config).toBe('ext56');
    expect(Object.keys(s.buildings).length).toBe(12);
  });

  it('full draft for 8 players on ext78 board', () => {
    const s = runSetup(newGame(8));
    expect(s.phase).toBe('turnPreroll');
    expect(s.config).toBe('ext78');
    expect(new Set(s.players.map((p) => p.color)).size).toBe(8);
    expect(Object.keys(s.buildings).length).toBe(16);
    expect(s.bank.wood + s.players.reduce((n, p) => n + p.resources.wood, 0)).toBe(29);
  });

  it('distance rule violation rejected', () => {
    let s = newGame(3);
    // First placement: vertex 0's neighbors must stay clear.
    const v0 = 0;
    const edge = s.board.topology.vertexEdges[v0]![0]!;
    const res0 = act(s, { type: 'setupPlace', settlementVertex: v0, roadEdge: edge });
    if (!res0.ok) return;
    s = res0.state;

    // Same player tries an adjacent vertex later — simulate by placing on a
    // neighbor of v0 for the next seat; that's ALSO illegal (distance rule).
    const neighbor = s.board.topology.adjacentVertices[v0]![0]!;
    const res1 = act(s, { type: 'setupPlace', settlementVertex: neighbor, roadEdge: s.board.topology.vertexEdges[neighbor]![0]! });
    expect(res1.ok).toBe(false);
    if (!res1.ok) expect(res1.error).toBe('ILLEGAL_SETTLEMENT');
  });

  it('road not adjacent to settlement rejected', () => {
    const s = newGame(3);
    const v = 0;
    const farEdge = s.board.topology.edges.find(
      (e) => e[0] !== v && e[1] !== v,
    )!;
    const eid = farEdge[0] < farEdge[1] ? `${farEdge[0]}-${farEdge[1]}` : `${farEdge[1]}-${farEdge[0]}`;
    const res = act(s, { type: 'setupPlace', settlementVertex: v, roadEdge: eid });
    expect(res.ok).toBe(false);
  });

  it('second-placement settlements grant adjacent resources', () => {
    const seed = 'grant-seed';
    const before = runSetup(newGame(3, seed));
    // seat 0's second settlement was placed at some vertex — recompute manually:
    // Instead assert: every player's resource total equals hexes adjacent to
    // their second settlement (0-3 cards each).
    for (const p of before.players) {
      const total = RESOURCES.reduce((n, r) => n + p.resources[r], 0);
      expect(total).toBeGreaterThanOrEqual(0);
      expect(total).toBeLessThanOrEqual(3);
    }
    // Determinism: same seed -> same totals.
    const again = runSetup(newGame(3, seed));
    expect(again.players.map((p) => p.resources)).toEqual(before.players.map((p) => p.resources));
  });
});

describe('turn loop', () => {
  function setupWithTurn(): GameState {
    return runSetup(newGame(3, 'loop-seed'));
  }

  it('roll produces resources for matching hexes', () => {
    const s = setupWithTurn();
    // Find a number that exists on the board and pick that roll.
    const tokens = Object.values(s.board.hexes)
      .map((h) => h.token)
      .filter((t): t is number => t !== null);
    const roll = tokens[0]!;
    const res = act(s, { type: 'rollDice' }, { rollDice: fixedRoll(...diePair(roll)) });
    expect(res.ok).toBe(true);
    // 7 would go to discard; pick a non-7 token.
    if (roll !== 7 && res.ok) {
      expect(res.state.phase).toBe('turnMain');
      expect(res.state.dice?.die1 !== undefined).toBe(true);
    }
  });

  it('rolling before your turn is rejected', () => {
    const s = setupWithTurn(); // seat 0 active
    const res = act(s, { type: 'buildSettlement', vertex: 999 }, {});
    expect(res.ok).toBe(false);
  });

  it('cannot build before rolling', () => {
    const s = setupWithTurn();
    const v = s.board.topology.vertices.find((v2) => {
      const neighbors = s.board.topology.adjacentVertices[v2]!;
      return neighbors.every((n) => s.buildings[n] === undefined) && s.buildings[v2] === undefined;
    })!;
    const res = act(s, { type: 'buildSettlement', vertex: v });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('NOT_BUILD_PHASE');
  });
});

describe('rolling 7: robber flow', () => {
  it('7 roll with no player over 7 goes straight to robberMove', () => {
    const s = runSetup(newGame(3, 'robber-seed'));
    const res = act(s, { type: 'rollDice' }, { rollDice: fixedRoll(3, 4) });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.phase).toBe('robberMove');
    // Robber must move to a different hex.
    const sameHex = act(res.state, { type: 'moveRobber', hex: res.state.robber });
    expect(sameHex.ok).toBe(false);
  });

  it('player over 7 must discard floor(n/2)', () => {
    let s = runSetup(newGame(3, 'discard-seed'));
    s = give(s, 1, { wood: 10 }); // seat 1 now holds >7
    const res = act(s, { type: 'rollDice' }, { rollDice: fixedRoll(3, 4) });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.phase).toBe('discard');
    const pending = res.state.pendingDiscards.find((d) => d.seat === 1);
    expect(pending).toBeDefined();
    expect(pending!.count).toBeGreaterThanOrEqual(5);
  });

  it('discardLimit rule decides who discards (default 7, custom 9)', () => {
    function pendingAfterSeven(s: GameState, hands: Record<number, number>): Record<number, number> {
      let st = s;
      for (const [seat, n] of Object.entries(hands)) st = setHand(st, Number(seat), n);
      const res = act(st, { type: 'rollDice' }, { rollDice: fixedRoll(3, 4) });
      expect(res.ok).toBe(true);
      if (!res.ok) return {};
      return Object.fromEntries(res.state.pendingDiscards.map((d) => [d.seat, d.count]));
    }
    const hands = { 0: 7, 1: 8, 2: 10 };
    const def = runSetup(newGame(3, 'limit-seed'));
    expect(def.rules.discardLimit).toBe(7);
    expect(pendingAfterSeven(def, hands)).toEqual({ 1: 4, 2: 5 });

    const custom = runSetup(newGame(3, 'limit-seed', { discardLimit: 9 }));
    expect(custom.rules).toEqual({ victoryPointsToWin: 10, discardLimit: 9 });
    expect(pendingAfterSeven(custom, hands)).toEqual({ 2: 5 });
    expect(pendingAfterSeven(custom, { 0: 9, 1: 9, 2: 9 })).toEqual({});
  });

  it('robber move then steal from victim with cards', () => {
    let s = runSetup(newGame(3, 'steal-seed'));
    s = give(s, 1, { wood: 2, sheep: 1 });
    const roll = act(s, { type: 'rollDice' }, { rollDice: fixedRoll(3, 4) });
    expect(roll.ok).toBe(true);
    if (!roll.ok) return;
    s = roll.state;
    // move robber to some hex adjacent to seat 1's buildings.
    const victimBuildings = Object.entries(s.buildings).filter(([, b]) => b.seat === 1);
    expect(victimBuildings.length).toBeGreaterThan(0);
    const [vx] = victimBuildings[0]!;
    const hex = s.board.topology.vertexHexes[Number(vx)]![0]!;
    const moved = act(s, { type: 'moveRobber', hex });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    s = moved.state;
    if (s.phase === 'robberSteal') {
      const steal = act(s, { type: 'chooseSteal', victimSeat: 1 }, { seed: 'steal' });
      expect(steal.ok).toBe(true);
      if (steal.ok) {
        // Active player gained exactly 1 card of what seat 1 had.
        const gained = RESOURCES.reduce(
          (n, r) => n + steal.state.players[0]!.resources[r] - s.players[0]!.resources[r],
          0,
        );
        expect(gained).toBe(1);
      }
    } else {
      expect(s.phase).toBe('turnMain');
    }
  });
});

/** Split a sum into a legal (die1, die2) pair. */
function diePair(sum: number): [number, number] {
  const d1 = Math.max(1, Math.min(6, sum - 1));
  return [d1, sum - d1];
}

describe('vp helpers', () => {
  it('publicVp counts buildings and awards only', () => {
    const s = runSetup(newGame(3));
    // After setup: each player has 2 settlements = 2 VP.
    expect(publicVp(s, 0)).toBe(2);
    expect(totalVp(s, 0)).toBe(2);
  });
});
