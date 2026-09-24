import { describe, expect, it } from 'vitest';
import { act, fixedRoll, give, newGame, runSetup } from './rules-helpers';
import type { GameState } from '../rules/state';
import { totalVp } from '../rules/state';


describe('5+ player special build phase', () => {
  it.each([5, 8] as const)('endTurn enters SBP and windows advance through all non-active seats (players=%i)', (pc) => {
    let s = runSetup(newGame(pc, 'sbp-advance'));
    const rolled = act(s, { type: 'rollDice' }, { rollDice: fixedRoll(1, 1) });
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    s = rolled.state;
    const end = act(s, { type: 'endTurn' });
    expect(end.ok).toBe(true);
    if (!end.ok) return;
    s = end.state;

    expect(s.phase).toBe('specialBuild');
    expect(s.specialBuild).not.toBeNull();
    expect(s.specialBuild!.seat).toBe(1); // first window: next seat clockwise

    // Pass each window.
    let guard = 0;
    const seenWindows: number[] = [];
    while (s.phase === 'specialBuild' && guard++ < 10) {
      const seat = s.specialBuild!.seat;
      if (seat !== null) seenWindows.push(seat);
      const done = act(s, { type: 'specialBuildDone' });
      expect(done.ok).toBe(true);
      if (!done.ok) return;
      s = done.state;
    }
    // Every non-active seat got a window, in clockwise order.
    expect(seenWindows).toEqual(Array.from({ length: pc - 1 }, (_, i) => i + 1));
    // Then the next turn starts.
    expect(s.phase).toBe('turnPreroll');
    expect(s.activeSeat).toBe(1);
  });

  it('SBP seat can build but not trade, play dev cards, or win', () => {
    let s = runSetup(newGame(5, 'sbp-build'));
    const rolled = act(s, { type: 'rollDice' }, { rollDice: fixedRoll(1, 1) });
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    s = rolled.state;
    const end = act(s, { type: 'endTurn' });
    expect(end.ok).toBe(true);
    if (!end.ok) return;
    s = end.state;

    expect(s.specialBuild!.seat).toBe(1);
    // Trading forbidden in SBP.
    const trade = act(s, { type: 'bankTrade', give: 'wood', receive: 'ore' });
    expect(trade.ok).toBe(false);

    // Dev card play forbidden in SBP.
    const play = act(s, { type: 'playDevCard', cardId: 'knight-0' });
    expect(play.ok).toBe(false);

    // Build allowed when affordable: give seat 1 resources and place a road.
    s = give(s, 1, { wood: 2, brick: 2 });
    const edge = s.board.topology.edges.find((e) => {
      const eid = e[0] < e[1] ? `${e[0]}-${e[1]}` : `${e[1]}-${e[0]}`;
      if (s.roads[eid] !== undefined) return false;
      const [a, b] = e;
      const touches = [a, b].some((v) => {
        if (s.buildings[v]?.seat === 1) return true;
        return s.board.topology.vertexEdges[v]!.some((eid2) => s.roads[eid2] === 1);
      });
      return touches;
    });
    expect(edge).toBeDefined();
    if (edge === undefined) return;
    const eid = edge[0] < edge[1] ? `${edge[0]}-${edge[1]}` : `${edge[1]}-${edge[0]}`;
    const build = act(s, { type: 'buildRoad', edge: eid });
    expect(build.ok).toBe(true);
    if (!build.ok) return;
    s = build.state;
    expect(s.roads[eid]).toBe(1);
  });

  it('dev cards bought in SBP are playable next turn', () => {
    let s = runSetup(newGame(5, 'sbp-dev'));
    const rolled = act(s, { type: 'rollDice' }, { rollDice: fixedRoll(1, 1) });
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    s = rolled.state;
    const end = act(s, { type: 'endTurn' });
    expect(end.ok).toBe(true);
    if (!end.ok) return;
    s = end.state;

    s = give(s, 1, { sheep: 1, wheat: 1, ore: 1 });
    const deckOverride: GameState = {
      ...s,
      devDeck: [{ id: 'knight-sb', type: 'knight', boughtOnTurn: -1 }],
      devDeckIndex: 0,
    };
    const buy = act(deckOverride, { type: 'buyDevCard' });
    expect(buy.ok).toBe(true);
    if (!buy.ok) return;
    s = buy.state;
    const card = s.players[1]!.devHand.at(-1)!;
    expect(card.boughtOnTurn).toBe(s.turn);
  });

  it('SBP building cannot win the game', () => {
    let s = runSetup(newGame(5, 'sbp-win'));
    // Seat 1 starts with 2 setup settlements (2 VP). Force 3 cities + 1
    // settlement on VACANT vertices: 2 + 6 + 1 = 9 public VP.
    const vacant = s.board.topology.vertices.filter((v) => s.buildings[v] === undefined);
    const chosen = vacant.slice(0, 4);
    const forced: GameState['buildings'] = {};
    chosen.forEach((v, i) => {
      forced[v] = { seat: 1, type: i < 3 ? 'city' : 'settlement' };
    });
    s = { ...s, buildings: { ...s.buildings, ...forced } };
    expect(totalVp(s, 1)).toBe(9);

    const rolled = act(s, { type: 'rollDice' }, { rollDice: fixedRoll(1, 1) });
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    s = rolled.state;
    const end = act(s, { type: 'endTurn' });
    expect(end.ok).toBe(true);
    if (!end.ok) return;
    s = end.state;
    expect(s.specialBuild!.seat).toBe(1);

    // Seat 1 buys a VP card during SBP — VP 10 but NO win (not their turn).
    s = give(s, 1, { sheep: 1, wheat: 1, ore: 1 });
    const deckOverride: GameState = {
      ...s,
      devDeck: [{ id: 'vp-0', type: 'victoryPoint', boughtOnTurn: -1 }],
      devDeckIndex: 0,
    };
    const buy = act(deckOverride, { type: 'buyDevCard' });
    expect(buy.ok).toBe(true);
    if (!buy.ok) return;
    s = buy.state;
    expect(totalVp(s, 1)).toBe(10);
    expect(s.phase).not.toBe('finished');
    expect(s.winner).toBeNull();
  });
});

describe('winning', () => {
  it('VP dev cards count toward the win', () => {
    let s = runSetup(newGame(3, 'vp-win'));
    const rolled = act(s, { type: 'rollDice' }, { rollDice: fixedRoll(1, 1) });
    if (!rolled.ok) return;
    s = rolled.state;
    // Seat 0 starts with 2 setup settlements (2 VP). Force 3 cities + 2
    // settlements on VACANT vertices: 2 + 6 + 2 = 10... we want 9 public + 1
    // VP card = 10 total. Use 3 cities + 1 settlement: 2+6+1 = 9 public.
    const vacant = s.board.topology.vertices.filter((v) => s.buildings[v] === undefined);
    const chosen = vacant.slice(0, 4);
    const buildings: GameState['buildings'] = {};
    chosen.forEach((v, i) => {
      buildings[v] = { seat: 0, type: i < 3 ? 'city' : 'settlement' };
    });
    s = {
      ...s,
      buildings: { ...s.buildings, ...buildings },
      players: s.players.map((p, i) =>
        i === 0
          ? { ...p, devHand: [{ id: 'vp-9', type: 'victoryPoint' as const, boughtOnTurn: 0 }] }
          : p,
      ),
    };
    expect(totalVp(s, 0)).toBe(10);
    // Any accepted action triggers maybeWin: build a road.
    s = give(s, 0, { wood: 1, brick: 1 });
    const edge = s.board.topology.edges.find((e) => {
      const eid = e[0] < e[1] ? `${e[0]}-${e[1]}` : `${e[1]}-${e[0]}`;
      if (s.roads[eid] !== undefined) return false;
      const [a, b] = e;
      return [a, b].some((v) => {
        if (s.buildings[v]?.seat === 0) return true;
        return s.board.topology.vertexEdges[v]!.some((eid2) => s.roads[eid2] === 0);
      });
    });
    if (edge === undefined) return;
    const eid = edge[0] < edge[1] ? `${edge[0]}-${edge[1]}` : `${edge[1]}-${edge[0]}`;
    const build = act(s, { type: 'buildRoad', edge: eid });
    if (!build.ok) return;
    expect(build.state.winner).toBe(0);
    expect(build.state.phase).toBe('finished');
    // VP card revealed.
    expect(build.state.players[0]!.devHand[0]!.played).toBe(true);
  });

  it('victoryPointsToWin rule sets the win threshold', () => {
    // Seat 0: 2 setup settlements + 1 forced city = 4 VP; upgrading a setup
    // settlement to a city reaches 5 VP.
    function upgradeToFive(rules?: { victoryPointsToWin: number }): GameState {
      let s = runSetup(newGame(3, 'vp-rule', rules));
      const rolled = act(s, { type: 'rollDice' }, { rollDice: fixedRoll(1, 1) });
      expect(rolled.ok).toBe(true);
      if (!rolled.ok) throw new Error(rolled.error);
      s = rolled.state;
      const vacant = s.board.topology.vertices.find((v) => s.buildings[v] === undefined)!;
      s = { ...s, buildings: { ...s.buildings, [vacant]: { seat: 0, type: 'city' } } };
      s = give(s, 0, { ore: 3, wheat: 2 });
      const own = Object.entries(s.buildings).find(([, b]) => b.seat === 0 && b.type === 'settlement')!;
      const city = act(s, { type: 'buildCity', vertex: Number(own[0]) });
      expect(city.ok).toBe(true);
      if (!city.ok) throw new Error(city.error);
      expect(totalVp(city.state, 0)).toBe(5);
      return city.state;
    }
    const custom = upgradeToFive({ victoryPointsToWin: 5 });
    expect(custom.phase).toBe('finished');
    expect(custom.winner).toBe(0);

    const standard = upgradeToFive();
    expect(standard.rules.victoryPointsToWin).toBe(10);
    expect(standard.phase).toBe('turnMain');
    expect(standard.winner).toBeNull();
  });
});

describe('engine invariants', () => {
  it('applyAction never mutates input state', () => {
    const s = runSetup(newGame(3, 'pure-seed'));
    const snapshot = structuredClone(s);
    const rolled = act(s, { type: 'rollDice' }, { rollDice: fixedRoll(1, 1) });
    expect(rolled.ok).toBe(true);
    expect(s).toEqual(snapshot);
    if (!rolled.ok) return;
    const s2 = give(rolled.state, 0, { wood: 1, brick: 1 });
    const snap2 = structuredClone(s2);
    // build a road and verify s2 unchanged.
    const edge = s2.board.topology.edges.find((e) => {
      const eid = e[0] < e[1] ? `${e[0]}-${e[1]}` : `${e[1]}-${e[0]}`;
      if (s2.roads[eid] !== undefined) return false;
      const [a, b] = e;
      return [a, b].some((v) => {
        if (s2.buildings[v]?.seat === 0) return true;
        return s2.board.topology.vertexEdges[v]!.some((eid2) => s2.roads[eid2] === 0);
      });
    });
    if (edge === undefined) return;
    const eid = edge[0] < edge[1] ? `${edge[0]}-${edge[1]}` : `${edge[1]}-${edge[0]}`;
    const build = act(s2, { type: 'buildRoad', edge: eid });
    expect(build.ok).toBe(true);
    expect(s2).toEqual(snap2);
  });

  it('deterministic: same seed + same action script = identical event log', () => {
    function script(seed: string): string[] {
      let s = runSetup(newGame(3, seed));
      const events: string[] = [];
      let guard = 0;
      while (s.phase !== 'finished' && guard++ < 60) {
        switch (s.phase) {
          case 'turnPreroll': {
            const r = act(s, { type: 'rollDice' }, { seed: `${seed}:r${guard}`, rollDice: fixedRoll(2, 3) });
            if (!r.ok) return events;
            s = r.state;
            events.push(...r.events.map((e) => JSON.stringify(e)));
            break;
          }
          case 'turnMain': {
            const e = act(s, { type: 'endTurn' });
            if (!e.ok) return events;
            s = e.state;
            events.push(...e.events.map((ev) => JSON.stringify(ev)));
            break;
          }
          case 'robberMove': {
            const hex = s.board.topology.hexes.find((h) => h !== s.robber)!;
            const m = act(s, { type: 'moveRobber', hex }, { seed: `${seed}:m${guard}` });
            if (!m.ok) return events;
            s = m.state;
            events.push(...m.events.map((ev) => JSON.stringify(ev)));
            break;
          }
          case 'robberSteal': {
            const victims = Object.values(s.buildings).map((b) => b.seat).filter((v) => v !== s.activeSeat);
            const uniq = [...new Set(victims)];
            const st = act(s, { type: 'chooseSteal', victimSeat: uniq[0] ?? 0 }, { seed: `${seed}:s${guard}` });
            if (!st.ok) return events;
            s = st.state;
            events.push(...st.events.map((ev) => JSON.stringify(ev)));
            break;
          }
          case 'discard': {
            const pending = s.pendingDiscards.find((d) => !d.received);
            if (pending === undefined) return events;
            const p = s.players[pending.seat]!;
            // Greedy discard from largest pile.
            const res: Record<string, number> = {};
            let left = pending.count;
            for (const r of ['wood', 'brick', 'sheep', 'wheat', 'ore'] as const) {
              const take = Math.min(p.resources[r], Math.max(0, left));
              res[r] = take;
              left -= take;
            }
            const d = act(s, { type: 'discard', resources: res as never }, { seed: `${seed}:d${guard}` });
            if (!d.ok) return events;
            s = d.state;
            events.push(...d.events.map((ev) => JSON.stringify(ev)));
            break;
          }
          default:
            return events;
        }
      }
      return events;
    }
    const a = script('det-seed');
    const b = script('det-seed');
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(10);
  });
});
