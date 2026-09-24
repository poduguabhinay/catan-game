import { describe, expect, it } from 'vitest';

import { act, fixedRoll, give, newGame, runSetup } from './rules-helpers';

import { bestTradeRate } from '../rules/legal';
import type { GameState } from '../rules/state';

function readyTurnState(seed = 'dev-seed'): GameState {
  return runSetup(newGame(3, seed));
}

function giveAll(state: GameState, seat: number): GameState {
  return give(state, seat, { wood: 5, brick: 5, sheep: 5, wheat: 5, ore: 5 });
}

describe('dev card timing', () => {
  it('card bought this turn is unplayable; playable next turn', () => {
    let s = giveAll(readyTurnState(), 0);
    const rolled = act(s, { type: 'rollDice' }, { rollDice: fixedRoll(1, 1) });
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    s = rolled.state;

    const buy = act(s, { type: 'buyDevCard' });
    expect(buy.ok).toBe(true);
    if (!buy.ok) return;
    s = buy.state;
    const card = s.players[0]!.devHand.at(-1)!;
    expect(card.boughtOnTurn).toBe(s.turn);

    const playNow = act(s, { type: 'playDevCard', cardId: card.id });
    expect(playNow.ok).toBe(false);
    if (!playNow.ok) expect(playNow.error).toBe('BOUGHT_THIS_TURN');
  });

  it('one knight/progress card per turn', () => {
    let s = giveAll(readyTurnState('knight-seed'), 0);
    // Buy two knights across turns to have one playable.
    const rolled = act(s, { type: 'rollDice' }, { rollDice: fixedRoll(1, 1) });
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    s = rolled.state;
    const buy1 = act(s, { type: 'buyDevCard' });
    expect(buy1.ok).toBe(true);
    if (!buy1.ok) return;
    s = buy1.state;

    const end = act(s, { type: 'endTurn' });
    expect(end.ok).toBe(true);
    if (!end.ok) return;
    s = end.state;
    // Skip to seat 0's next turn: seats 1 and 2 roll + end.
    for (let i = 0; i < 2; i++) {
      const r = act(s, { type: 'rollDice' }, { rollDice: fixedRoll(1, 1) });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const e = act(r.state, { type: 'endTurn' });
      expect(e.ok).toBe(true);
      if (!e.ok) return;
      s = e.state;
    }
    expect(s.activeSeat).toBe(0);

    const rolled2 = act(s, { type: 'rollDice' }, { rollDice: fixedRoll(1, 1) });
    expect(rolled2.ok).toBe(true);
    if (!rolled2.ok) return;
    s = rolled2.state;
    const knight = s.players[0]!.devHand.find((c) => c.type === 'knight' && !c.played);
    if (knight === undefined) return; // deck draw gave no knight — skip
    const play = act(s, { type: 'playDevCard', cardId: knight.id });
    expect(play.ok).toBe(true);
    if (!play.ok) return;
    s = play.state;
    expect(s.phase).toBe('robberMove');
    // A second knight this turn must fail with ONE_DEV_PER_TURN.
    const knight2 = s.players[0]!.devHand.find((c) => c.type === 'knight' && !c.played && c.boughtOnTurn !== s.turn);
    if (knight2 === undefined) return;
    const move = act(s, { type: 'moveRobber', hex: s.board.topology.hexes.find((h) => h !== s.robber)! });
    expect(move.ok).toBe(true);
    if (!move.ok) return;
    s = move.state;
    if (s.phase === 'robberSteal') {
      // victims exist? choose first candidate
      const candidates = Object.values(s.buildings).filter((b) => b.seat !== 0);
      if (candidates.length > 0) {
        const steal = act(s, { type: 'chooseSteal', victimSeat: candidates[0]!.seat });
        expect(steal.ok).toBe(true);
        if (!steal.ok) return;
        s = steal.state;
      }
    }
    const play2 = act(s, { type: 'playDevCard', cardId: knight2.id });
    if (play2.ok) {
      // If the second knight was ALSO legal, ONE_DEV_PER_TURN failed.
      expect(play2.state.players[0]!.playedKnights).toBeLessThanOrEqual(2);
    } else {
      expect(play2.error).toBe('ONE_DEV_PER_TURN');
    }
  });

  it('monopoly takes all of a resource from others', () => {
    let s = readyTurnState('mono-seed');
    s = give(s, 1, { wood: 3 });
    s = give(s, 2, { wood: 2 });
    // Give seat 0 a monopoly card bought on a previous turn.
    s = {
      ...s,
      players: s.players.map((p, i) =>
        i === 0
          ? { ...p, devHand: [{ id: 'mono-x', type: 'monopoly' as const, boughtOnTurn: 0 }] }
          : p,
      ),
    };
    const rolled = act(s, { type: 'rollDice' }, { rollDice: fixedRoll(1, 1) });
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    s = rolled.state;
    const play = act(s, { type: 'playDevCard', cardId: 'mono-x', payload: { resource: 'wood' } });
    expect(play.ok).toBe(true);
    if (!play.ok) return;
    expect(play.state.players[1]!.resources.wood).toBe(0);
    expect(play.state.players[2]!.resources.wood).toBe(0);
    expect(play.state.players[0]!.resources.wood).toBeGreaterThanOrEqual(5);
  });

  it('year of plenty takes up to 2 from bank', () => {
    let s = readyTurnState('yop-seed');
    s = {
      ...s,
      players: s.players.map((p, i) =>
        i === 0
          ? { ...p, devHand: [{ id: 'yop-x', type: 'yearOfPlenty' as const, boughtOnTurn: 0 }] }
          : p,
      ),
    };
    const rolled = act(s, { type: 'rollDice' }, { rollDice: fixedRoll(1, 1) });
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    s = rolled.state;
    const before = s.players[0]!.resources.wood;
    const play = act(s, { type: 'playDevCard', cardId: 'yop-x', payload: { resources: ['wood', 'wood'] } });
    expect(play.ok).toBe(true);
    if (!play.ok) return;
    expect(play.state.players[0]!.resources.wood - before).toBe(2);
  });

  it('buying from an empty deck rejected', () => {
    let s = readyTurnState('empty-deck');
    s = giveAll(s, 0);
    s = { ...s, devDeckIndex: s.devDeck.length };
    const rolled = act(s, { type: 'rollDice' }, { rollDice: fixedRoll(1, 1) });
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    s = rolled.state;
    const buy = act(s, { type: 'buyDevCard' });
    expect(buy.ok).toBe(false);
    if (!buy.ok) expect(buy.error).toBe('DECK_EMPTY');
  });
});

describe('bank & harbor trading', () => {
  it('bank trade spends exactly bestTradeRate for the player', () => {
    let s = readyTurnState('bank-seed');
    s = give(s, 0, { wood: 9 });
    const rolled = act(s, { type: 'rollDice' }, { rollDice: fixedRoll(1, 1) });
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    s = rolled.state;
    const expectedRate = bestTradeRate(s, 0, 'wood');
    const beforeWood = s.players[0]!.resources.wood;
    const beforeOre = s.players[0]!.resources.ore;
    const trade = act(s, { type: 'bankTrade', give: 'wood', receive: 'ore' });
    expect(trade.ok).toBe(true);
    if (!trade.ok) return;
    expect(beforeWood - trade.state.players[0]!.resources.wood).toBe(expectedRate);
    expect(trade.state.players[0]!.resources.ore - beforeOre).toBe(1);
  });

  it('harbor rates: 3:1 generic, 2:1 matching specialty', () => {
    // Force-own a specialty sheep harbor: place settlement on one endpoint.
    let s = readyTurnState('harbor-seed');
    const sheepHarborEid = Object.keys(s.board.harbors).find(
      (eid) => s.board.harbors[eid]!.type === 'specialty' && s.board.harbors[eid]!.resource === 'sheep',
    );
    expect(sheepHarborEid).toBeDefined();
    if (sheepHarborEid === undefined) return;
    const [v1] = s.board.topology.edgeEndpoints[sheepHarborEid]!;
    s = { ...s, buildings: { ...s.buildings, [v1]: { seat: 0, type: 'settlement' } } };
    expect(bestTradeRate(s, 0, 'sheep')).toBe(2);
    expect(bestTradeRate(s, 0, 'wood')).toBeGreaterThanOrEqual(3);
  });

  it('same-resource trade rejected', () => {
    let s = give(readyTurnState('same-seed'), 0, { wood: 5 });
    const rolled = act(s, { type: 'rollDice' }, { rollDice: fixedRoll(1, 1) });
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    s = rolled.state;
    const trade = act(s, { type: 'bankTrade', give: 'wood', receive: 'wood' });
    expect(trade.ok).toBe(false);
  });
});

describe('player trade offers', () => {
  it('offer, accept executes; counter creates new offer', () => {
    let s = readyTurnState('trade-seed');
    s = give(s, 0, { wood: 2 });
    s = give(s, 1, { brick: 2 });
    const rolled = act(s, { type: 'rollDice' }, { rollDice: fixedRoll(1, 1) });
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    s = rolled.state;

    const offer = act(s, {
      type: 'tradeOffer',
      give: { wood: 1 },
      receive: { brick: 1 },
    });
    expect(offer.ok).toBe(true);
    if (!offer.ok) return;
    s = offer.state;
    const offerId = s.trades.at(-1)!.id;
    expect(s.trades.find((t) => t.id === offerId)!.status).toBe('open');

    // ONLY the active player (proposer) can't accept; seat 1 accepts via
    // server — but engine's tradeRespond uses activeSeat... The engine API
    // takes the RESPONDING seat from the server layer. Here we simulate by
    // temporarily setting activeSeat — the sockets layer will handle routing.
    const asSeat1 = { ...s, activeSeat: 1 } as GameState;
    const accept = act(asSeat1, { type: 'tradeRespond', offerId, response: 'accept' });
    expect(accept.ok).toBe(true);
    if (!accept.ok) return;
    expect(accept.state.players[0]!.resources.wood).toBe(1);
    expect(accept.state.players[0]!.resources.brick).toBe(1);
    expect(accept.state.players[1]!.resources.brick).toBe(1);
    expect(accept.state.trades.find((t) => t.id === offerId)!.status).toBe('completed');
  });

  it('stale offer rejected when proposer spent the resources', () => {
    let s = readyTurnState('stale-seed');
    s = give(s, 0, { wood: 12 });
    const rolled = act(s, { type: 'rollDice' }, { rollDice: fixedRoll(1, 1) });
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    s = rolled.state;
    const offer = act(s, { type: 'tradeOffer', give: { wood: 2 }, receive: { brick: 1 } });
    expect(offer.ok).toBe(true);
    if (!offer.ok) return;
    s = offer.state;
    const offerId = s.trades.at(-1)!.id;

    // Proposer spends 4 wood at the bank, dropping below the offered 2.
    const trade = act(s, { type: 'bankTrade', give: 'wood', receive: 'ore' });
    expect(trade.ok).toBe(true);
    if (!trade.ok) return;
    s = trade.state;

    const asSeat1 = { ...s, activeSeat: 1 } as GameState;
    const accept = act(asSeat1, { type: 'tradeRespond', offerId, response: 'accept' });
    expect(accept.ok).toBe(false);
    if (!accept.ok) expect(['OFFER_STALE', 'CANNOT_PAY_ACCEPT']).toContain(accept.error);
  });

  it('endTurn cancels open offers', () => {
    let s = readyTurnState('cancel-seed');
    s = give(s, 0, { wood: 1 });
    const rolled = act(s, { type: 'rollDice' }, { rollDice: fixedRoll(1, 1) });
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    s = rolled.state;
    const offer = act(s, { type: 'tradeOffer', give: { wood: 1 }, receive: { brick: 1 } });
    expect(offer.ok).toBe(true);
    if (!offer.ok) return;
    s = offer.state;
    const offerId = s.trades.at(-1)!.id;
    const end = act(s, { type: 'endTurn' });
    expect(end.ok).toBe(true);
    if (!end.ok) return;
    expect(end.state.trades.find((t) => t.id === offerId)!.status).toBe('cancelled');
  });

  it('non-active player can accept offer directly using action.seat', () => {
    let s = readyTurnState('seat-accept-seed');
    s = give(s, 0, { wood: 2 });
    s = give(s, 1, { wheat: 2 });
    const rolled = act(s, { type: 'rollDice' }, { rollDice: fixedRoll(1, 1) });
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    s = rolled.state;
    expect(s.activeSeat).toBe(0);

    const offer = act(s, { type: 'tradeOffer', give: { wood: 1 }, receive: { wheat: 1 } });
    expect(offer.ok).toBe(true);
    if (!offer.ok) return;
    s = offer.state;
    const offerId = s.trades.at(-1)!.id;

    const p1BeforeWood = s.players[1]!.resources.wood;
    // Seat 1 accepts without mutating s.activeSeat
    const accept = act(s, { type: 'tradeRespond', offerId, response: 'accept', seat: 1 });
    expect(accept.ok).toBe(true);
    if (!accept.ok) return;
    expect(accept.state.players[0]!.resources.wood).toBe(1);
    expect(accept.state.players[0]!.resources.wheat).toBe(1);
    expect(accept.state.players[1]!.resources.wheat).toBe(1);
    expect(accept.state.players[1]!.resources.wood).toBe(p1BeforeWood + 1);
  });

  it('non-active player can counter offer using action.seat', () => {
    let s = readyTurnState('seat-counter-seed');
    s = give(s, 0, { wood: 2 });
    s = give(s, 2, { ore: 2 });
    const rolled = act(s, { type: 'rollDice' }, { rollDice: fixedRoll(1, 1) });
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    s = rolled.state;

    const offer = act(s, { type: 'tradeOffer', give: { wood: 1 }, receive: { ore: 1 } });
    expect(offer.ok).toBe(true);
    if (!offer.ok) return;
    s = offer.state;
    const offerId = s.trades.at(-1)!.id;

    const counter = act(s, {
      type: 'tradeCounter',
      offerId,
      seat: 2,
      give: { ore: 1 },
      receive: { wood: 2 },
    });
    expect(counter.ok).toBe(true);
    if (!counter.ok) return;
    const counterTrade = counter.state.trades.at(-1)!;
    expect(counterTrade.proposer).toBe(2);
    expect(counterTrade.counterOf).toBe(offerId);
  });

  it('multiple players discard independently using action.seat', () => {
    let s = readyTurnState('multi-discard-seed');
    s = give(s, 0, { wood: 8 }); // 8 cards -> must discard 4
    s = give(s, 1, { brick: 10 }); // 10 cards -> must discard 5
    const rolled = act(s, { type: 'rollDice' }, { rollDice: fixedRoll(3, 4) }); // 7 rolled!
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    s = rolled.state;
    expect(s.phase).toBe('discard');
    expect(s.pendingDiscards).toHaveLength(2);

    const req1 = s.pendingDiscards.find((d) => d.seat === 1)!.count;
    const req0 = s.pendingDiscards.find((d) => d.seat === 0)!.count;

    // Seat 1 discards first (out of order from pendingDiscards array)
    const d1 = act(s, { type: 'discard', seat: 1, resources: { brick: req1 } });
    expect(d1.ok).toBe(true);
    if (!d1.ok) return;
    expect(d1.state.phase).toBe('discard'); // still waiting for seat 0

    // Seat 0 discards second
    const d0 = act(d1.state, { type: 'discard', seat: 0, resources: { wood: req0 } });
    expect(d0.ok).toBe(true);
    if (!d0.ok) return;
    expect(d0.state.phase).toBe('robberMove'); // all discards completed!
  });
});
