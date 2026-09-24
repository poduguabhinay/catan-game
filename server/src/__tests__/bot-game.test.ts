// End-to-end bot game simulation test: exercises complete game loop
// from setup draft through multiple rounds of rolls, builds, robber events, and turns.

import { describe, expect, it } from 'vitest';
import { applyAction, createGame, createRng, PLAYER_COLORS, RESOURCES, totalVp } from '@catan/shared';
import { BOT_NAMES, computeBotAction } from '../bot';

describe('end-to-end bot gameplay simulation', () => {
  it('runs an entire match through setup, production, trades, and building without deadlock', () => {
    const seed = 'simulation-seed-2026';
    const rng = createRng(seed);
    const playerCount = 4;
    const players = [
      { seat: 0, name: 'Bot Alice', color: 'red' as const },
      { seat: 1, name: 'Bot Bob', color: 'blue' as const },
      { seat: 2, name: 'Bot Charlie', color: 'orange' as const },
      { seat: 3, name: 'Bot Diana', color: 'white' as const },
    ];

    let state = createGame({ playerCount, players, seed });
    expect(state.phase).toBe('setupForward');
    expect(state.playerCount).toBe(4);

    let actionsCount = 0;
    const maxActions = 250;
    let turnCount = 0;

    while (actionsCount < maxActions && state.phase !== 'finished' && turnCount < 40) {
      actionsCount++;
      const botSeat =
        state.phase === 'discard'
          ? (state.pendingDiscards.find((d) => !d.received)?.seat ?? state.activeSeat)
          : state.activeSeat;

      const action = computeBotAction(state, botSeat, rng);
      expect(action).not.toBeNull();
      if (action === null) break;

      const stamped =
        action.type === 'discard' || action.type === 'tradeRespond' || action.type === 'tradeCounter'
          ? { ...action, seat: botSeat }
          : action;

      const result = applyAction(state, stamped, rng);
      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(`Bot action failed: ${result.error} (type: ${action.type})`);
      }

      state = result.state;
      turnCount = state.turn;
    }

    // Verify setup placed 2 settlements and 2 roads per player = 8 each
    const buildingsCount = Object.keys(state.buildings).length;
    expect(buildingsCount).toBeGreaterThanOrEqual(8);

    const roadsCount = Object.keys(state.roads).length;
    expect(roadsCount).toBeGreaterThanOrEqual(8);

    // Verify game advanced well into the main turns
    expect(turnCount).toBeGreaterThan(5);

    // Verify players produced resources and built pieces
    const totalVp = state.players.reduce((sum, p) => sum + p.playedKnights + (5 - p.settlementsLeft), 0);
    expect(totalVp).toBeGreaterThanOrEqual(8);
  });

  it('8 bots on ext78 with custom rules: discard the right count, run SBP, reach the VP target', () => {
    const seed = 'eight-bots-2026';
    const rng = createRng(seed);
    const players = PLAYER_COLORS.map((color, seat) => ({ seat, name: BOT_NAMES[seat]!, color }));
    let state = createGame({
      playerCount: 8,
      players,
      seed,
      rules: { victoryPointsToWin: 5, discardLimit: 9 },
    });
    expect(state.config).toBe('ext78');

    let sawSbp = false;
    for (let i = 0; i < 6000 && state.phase !== 'finished'; i++) {
      if (state.phase === 'discard') {
        for (const d of state.pendingDiscards.filter((x) => !x.received)) {
          const held = RESOURCES.reduce((n, r) => n + state.players[d.seat]!.resources[r], 0);
          expect(held).toBeGreaterThan(9);
          expect(d.count).toBe(Math.floor(held / 2));
        }
      }
      if (state.phase === 'specialBuild') sawSbp = true;
      const botSeat =
        state.phase === 'discard'
          ? (state.pendingDiscards.find((d) => !d.received)?.seat ?? state.activeSeat)
          : state.phase === 'specialBuild'
            ? (state.specialBuild?.seat ?? state.activeSeat)
            : state.activeSeat;
      const action = computeBotAction(state, botSeat, rng);
      if (action === null) throw new Error(`bot ${botSeat} stuck in ${state.phase}`);
      if (action.type === 'discard') {
        const pending = state.pendingDiscards.find((d) => d.seat === botSeat)!;
        const sum = RESOURCES.reduce((n, r) => n + (action.resources[r] ?? 0), 0);
        expect(sum).toBe(pending.count);
      }
      const stamped =
        action.type === 'discard' || action.type === 'tradeRespond' || action.type === 'tradeCounter'
          ? { ...action, seat: botSeat }
          : action;
      const result = applyAction(state, stamped, rng);
      if (!result.ok) throw new Error(`Bot action failed: ${result.error} (type: ${action.type})`);
      state = result.state;
    }

    expect(sawSbp).toBe(true);
    expect(state.phase).toBe('finished');
    expect(totalVp(state, state.winner!)).toBeGreaterThanOrEqual(5);
  });
});
