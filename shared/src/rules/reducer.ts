// The rules engine: applyAction — a pure function over GameState. The server
// is the only caller with authority; the client reuses the legal.ts queries.
// State is NEVER mutated: every action clones the affected slices.

import { generateBoard, type Board } from '../board';
import {
  boardConfigForPlayers,
  BUILD_COSTS,
  canAfford,
  DEFAULT_RULES,
  emptyResourceBag,
  PIECE_LIMITS,
  RESOURCES,
  subtractCost,
  TERRAIN_RESOURCE,
  type Resource,
  type ResourceBag,
} from '../constants';
import { computeLongestRoadAward } from '../longestRoad';
import type { GameAction, GameEvent } from '../protocol';
import { createRng, type Rng } from '../rng';
import type { EdgeId, HexId, VertexId } from '../topology';
import {
  bestTradeRate,
  canPlaceCity,
  canPlaceRoad,
  canPlaceSettlement,
  canPlaceSetupRoad,
  legalRobberHexes,
  stealCandidates,
} from './legal';
import {
  type EngineOptions,
  type GameState,
  type InitialPlayer,
  type PlayerState,
} from './state';

export type ActionResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: string };

export interface RollDiceFn {
  (rng: Rng): { die1: number; die2: number };
}

const defaultRollDice: RollDiceFn = (rng) => ({
  die1: 1 + rng.int(6),
  die2: 1 + rng.int(6),
});

// ---------------------------------------------------------------------------
// Game creation
// ---------------------------------------------------------------------------

export function createGame(opts: EngineOptions): GameState {
  const config = boardConfigForPlayers(opts.playerCount);
  const board: Board = generateBoard(opts.playerCount, opts.seed);
  const rng = createRng(`${opts.seed}:devdeck`);
  const deck: Array<{ id: string; type: keyof typeof config.devDeck }> = [];
  for (const [type, count] of Object.entries(config.devDeck)) {
    for (let i = 0; i < count; i++) deck.push({ id: `${type}-${i}`, type: type as never });
  }
  const shuffled = rng.shuffle(deck).map((c) => ({
    id: c.id,
    type: c.type,
    boughtOnTurn: -1,
  }));

  const players: PlayerState[] = opts.players.map((p: InitialPlayer) => ({
    seat: p.seat,
    name: p.name,
    color: p.color,
    resources: emptyResourceBag(),
    devHand: [],
    playedKnights: 0,
    connected: true,
    roadsLeft: PIECE_LIMITS.roads,
    settlementsLeft: PIECE_LIMITS.settlements,
    citiesLeft: PIECE_LIMITS.cities,
  }));

  return {
    config: config.key,
    playerCount: opts.playerCount,
    rules: {
      victoryPointsToWin: opts.rules?.victoryPointsToWin ?? DEFAULT_RULES.victoryPointsToWin,
      discardLimit: opts.rules?.discardLimit ?? DEFAULT_RULES.discardLimit,
    },
    players,
    board,
    phase: 'setupForward',
    activeSeat: 0,
    turn: 0,
    dice: null,
    buildings: {},
    roads: {},
    robber: board.robberHex,
    bank: emptyResourceBagFrom(config.resourceBank),
    devDeck: shuffled,
    devDeckIndex: 0,
    trades: [],
    pendingDiscards: [],
    specialBuild: null,
    setupCursor: 0,
    longestRoad: { holder: null, length: 0 },
    largestArmy: { holder: null, knights: 0 },
    winner: null,
    devCardPlayedThisTurn: false,
    version: 1,
  };
}

function emptyResourceBagFrom(per: number): ResourceBag {
  return { wood: per, brick: per, sheep: per, wheat: per, ore: per };
}

// ---------------------------------------------------------------------------
// Setup draft order
// ---------------------------------------------------------------------------

/** Snake draft: forward 0..N-1 then reverse N-1..0. */
export function draftOrder(playerCount: number): number[] {
  const forward = Array.from({ length: playerCount }, (_, i) => i);
  return [...forward, ...[...forward].reverse()];
}

function isSecondPlacement(state: GameState): boolean {
  return state.setupCursor >= state.playerCount;
}

// ---------------------------------------------------------------------------
// applyAction
// ---------------------------------------------------------------------------

export function applyAction(
  prev: GameState,
  action: GameAction,
  rng: Rng,
  rollDice: RollDiceFn = defaultRollDice,
): ActionResult {
  if (prev.phase === 'finished') {
    return fail('GAME_FINISHED');
  }
  switch (action.type) {
    case 'setupPlace': return setupPlace(prev, action);
    case 'rollDice': return rollDiceAction(prev, rng, rollDice);
    case 'buildRoad': return buildRoad(prev, action.edge, rng, false);
    case 'buildSettlement': return buildSettlement(prev, action.vertex, rng, false);
    case 'buildCity': return buildCity(prev, action.vertex);
    case 'buyDevCard': return buyDevCard(prev, rng);
    case 'playDevCard': return playDevCard(prev, action, rng);
    case 'moveRobber': return moveRobber(prev, action.hex);
    case 'chooseSteal': return chooseSteal(prev, action.victimSeat, rng);
    case 'discard': return discard(prev, action);
    case 'bankTrade': return bankTrade(prev, action.give, action.receive);
    case 'endTurn': return endTurn(prev);
    case 'tradeOffer': return tradeOffer(prev, action);
    case 'tradeRespond': return tradeRespond(prev, action);
    case 'tradeCounter': return tradeCounter(prev, action);
    case 'tradeCancel': return tradeCancel(prev, action);
    case 'specialBuildActivate': return specialBuildActivate(prev, action);
    case 'specialBuildDone': return specialBuildDone(prev);
    default: return fail('UNKNOWN_ACTION');
  }
}

function fail(error: string): ActionResult {
  return { ok: false, error };
}

/** Clone helper: shallow state + copy-on-write for touched slices. */
function cloneState(s: GameState): GameState {
  return {
    ...s,
    players: s.players.map((p) => ({ ...p, resources: { ...p.resources }, devHand: [...p.devHand] })),
    buildings: { ...s.buildings },
    roads: { ...s.roads },
    bank: { ...s.bank },
    trades: s.trades.map((t) => ({ ...t })),
    pendingDiscards: s.pendingDiscards.map((d) => ({ ...d })),
    dice: s.dice === null ? null : { ...s.dice },
    specialBuild: s.specialBuild === null ? null : { ...s.specialBuild, usedThisRound: { ...s.specialBuild.usedThisRound } },
    version: s.version + 1,
  };
}

// ---------------------------------------------------------------------------
// Setup phase
// ---------------------------------------------------------------------------

function setupPlace(prev: GameState, action: Extract<GameAction, { type: 'setupPlace' }>): ActionResult {
  if (prev.phase !== 'setupForward' && prev.phase !== 'setupReverse') {
    return fail('NOT_SETUP');
  }
  const seat = prev.activeSeat;
  const player = prev.players[seat]!;
  const vertex = action.settlementVertex;
  const edge = action.roadEdge;

  if (!canPlaceSettlement(prev, seat, vertex, true)) {
    return fail('ILLEGAL_SETTLEMENT');
  }
  if (!canPlaceSetupRoad(prev, seat, edge, vertex)) {
    return fail('ILLEGAL_ROAD');
  }
  if (player.settlementsLeft <= 0 || player.roadsLeft <= 0) {
    return fail('NO_PIECES');
  }

  const state = cloneState(prev);
  state.buildings[vertex] = { seat, type: 'settlement' };
  state.roads[edge] = seat;
  const p = state.players[seat]!;
  p.settlementsLeft -= 1;
  p.roadsLeft -= 1;

  const events: GameEvent[] = [
    { type: 'setupPlaced', seat, settlementVertex: vertex, roadEdge: edge, second: isSecondPlacement(prev) },
  ];

  // Second placement grants 1 resource per adjacent producing hex.
  if (isSecondPlacement(prev)) {
    for (const hex of state.board.topology.vertexHexes[vertex]!) {
      const terrain = state.board.hexes[hex]!.terrain;
      const resource = TERRAIN_RESOURCE[terrain];
      if (resource === null) continue;
      p.resources[resource] += 1;
      state.bank[resource] -= 1;
    }
  }

  // Advance draft.
  state.setupCursor += 1;
  const order = draftOrder(state.playerCount);
  if (state.setupCursor >= order.length) {
    state.phase = 'turnPreroll';
    state.activeSeat = 0;
    state.turn = 1;
    state.devCardPlayedThisTurn = false;
    events.push({ type: 'turnStarted', seat: 0, turn: 1 });
  } else {
    const nextSeat = order[state.setupCursor]!;
    const nextPhase = state.setupCursor >= state.playerCount ? 'setupReverse' : 'setupForward';
    state.phase = nextPhase;
    state.activeSeat = nextSeat;
  }
  return ok(state, events);
}

// ---------------------------------------------------------------------------
// Roll + production + robber flow
// ---------------------------------------------------------------------------

function rollDiceAction(prev: GameState, rng: Rng, rollDice: RollDiceFn): ActionResult {
  if (prev.phase !== 'turnPreroll') {
    return fail('NOT_PREROLL');
  }
  const state = cloneState(prev);
  const { die1, die2 } = rollDice(rng);
  state.dice = { die1, die2 };
  const sum = die1 + die2;
  const events: GameEvent[] = [{ type: 'rolled', seat: prev.activeSeat, die1, die2 }];

  if (sum === 7) {
    // Discard phase for every player holding more than the discard limit.
    state.phase = 'discard';
    state.pendingDiscards = state.players
      .filter((p) => total(p) > state.rules.discardLimit)
      .map((p) => ({ seat: p.seat, count: Math.floor(total(p) / 2), received: false }));
    if (state.pendingDiscards.length === 0) {
      state.phase = 'robberMove';
      events.push({ type: 'robberMoved', seat: null, hex: state.robber });
    }
    return ok(state, events);
  }

  // Production per resource: bank shortage rule — if the bank cannot cover ALL
  // payouts of a resource, nobody gets it, unless a single player claims it.
  const payouts: Record<Resource, Array<{ seat: number; amount: number }>> = {
    wood: [], brick: [], sheep: [], wheat: [], ore: [],
  };
  for (const hex of state.board.topology.hexes) {
    if (hex === state.robber) continue;
    const token = state.board.hexes[hex]!.token;
    if (token !== sum) continue;
    const terrain = state.board.hexes[hex]!.terrain;
    const resource = TERRAIN_RESOURCE[terrain];
    if (resource === null) continue;
    for (const v of state.board.topology.hexVertices[hex]!) {
      const b = state.buildings[v];
      if (b === undefined) continue;
      payouts[resource].push({ seat: b.seat, amount: b.type === 'settlement' ? 1 : 2 });
    }
  }
  for (const resource of RESOURCES) {
    const claims = payouts[resource];
    if (claims.length === 0) continue;
    const totalDue = claims.reduce((n, c) => n + c.amount, 0);
    const available = state.bank[resource];
    if (totalDue <= available) {
      for (const c of claims) {
        state.players[c.seat]!.resources[resource] += c.amount;
        state.bank[resource] -= c.amount;
        events.push({ type: 'produced', seat: c.seat, resource, amount: c.amount });
      }
    } else if (claims.length === 1) {
      // Single claimant gets whatever remains.
      const c = claims[0]!;
      state.players[c.seat]!.resources[resource] += available;
      state.bank[resource] = 0;
      events.push({ type: 'produced', seat: c.seat, resource, amount: available });
      events.push({ type: 'bankShortage', resource });
    } else {
      events.push({ type: 'bankShortage', resource });
    }
  }

  state.phase = 'turnMain';
  return ok(state, events);
}

/** Total resource count of a player (helper local to avoid import cycle). */
function total(p: PlayerState): number {
  return RESOURCES.reduce((n, r) => n + p.resources[r], 0);
}

function discard(prev: GameState, action: Extract<GameAction, { type: 'discard' }>): ActionResult {
  if (prev.phase !== 'discard') {
    return fail('NOT_DISCARD');
  }
  const pending = prev.pendingDiscards.filter((d) => !d.received);
  if (pending.length === 0) return fail('NO_PENDING_DISCARD');
  const target = action.seat !== undefined
    ? pending.find((d) => d.seat === action.seat)
    : pending[0]!;
  if (target === undefined) return fail('NO_PENDING_DISCARD');
  const seat = target.seat;
  const player = prev.players[seat]!;

  const bag = action.resources;
  const sum = RESOURCES.reduce((n, r) => n + (bag[r] ?? 0), 0);
  if (sum !== target.count) {
    return fail('DISCARD_COUNT_MISMATCH');
  }
  for (const r of RESOURCES) {
    if ((bag[r] ?? 0) > player.resources[r]) return fail('DISCARD_OVERSpend');
  }

  const state = cloneState(prev);
  const p = state.players[seat]!;
  for (const r of RESOURCES) {
    const n = bag[r] ?? 0;
    p.resources[r] -= n;
    state.bank[r] += n;
  }
  const idx = state.pendingDiscards.findIndex((d) => d.seat === seat);
  if (idx >= 0) state.pendingDiscards[idx]!.received = true;

  const events: GameEvent[] = [
    { type: 'discarded', seat, resources: bag },
  ];

  if (state.pendingDiscards.every((d) => d.received)) {
    state.pendingDiscards = [];
    state.phase = 'robberMove';
  }
  return ok(state, events);
}

function moveRobber(prev: GameState, hex: HexId): ActionResult {
  if (prev.phase !== 'robberMove') {
    return fail('NOT_ROBBER_MOVE');
  }
  if (!legalRobberHexes(prev).includes(hex)) {
    return fail('ILLEGAL_ROBBER_HEX');
  }
  const state = cloneState(prev);
  state.robber = hex;
  const events: GameEvent[] = [{ type: 'robberMoved', seat: prev.activeSeat, hex }];

  const candidates = stealCandidates(state, hex);
  const withCards = candidates.filter((s) => total(state.players[s]!) > 0);
  if (withCards.length > 0) {
    state.phase = 'robberSteal';
  } else {
    state.phase = 'turnMain';
  }
  return ok(state, events);
}

function chooseSteal(prev: GameState, victimSeat: number, rng: Rng): ActionResult {
  if (prev.phase !== 'robberSteal') {
    return fail('NOT_ROBBER_STEAL');
  }
  const candidates = stealCandidates(prev, prev.robber);
  if (!candidates.includes(victimSeat)) {
    return fail('ILLEGAL_VICTIM');
  }
  const state = cloneState(prev);
  const victim = state.players[victimSeat]!;
  const resourcesHeld = RESOURCES.filter((r) => victim.resources[r] > 0);
  let stolenResource: Resource | null = null;
  if (resourcesHeld.length > 0) {
    const stolen = rng.pick(resourcesHeld);
    victim.resources[stolen] -= 1;
    state.players[prev.activeSeat]!.resources[stolen] += 1;
    stolenResource = stolen;
  }
  state.phase = 'turnMain';
  const events: GameEvent[] = [
    { type: 'stolenFrom', seat: prev.activeSeat, victim: victimSeat, resource: stolenResource },
  ];
  return ok(state, events);
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

function buildRoad(prev: GameState, edge: EdgeId, rng: Rng, free: boolean): ActionResult {
  const acting = prev.specialBuild !== null && prev.specialBuild.seat !== null
    ? prev.specialBuild.seat
    : prev.activeSeat;
  if (prev.phase !== 'turnMain' && prev.phase !== 'specialBuild') {
    return fail('NOT_BUILD_PHASE');
  }
  if (prev.phase === 'specialBuild') {
    const sb = prev.specialBuild;
    if (sb === null || sb.seat === null) return fail('NO_SB_WINDOW');
    if (acting !== sb.seat) return fail('NOT_SB_ACTOR');
  }
  if (!canPlaceRoad(prev, acting, edge)) {
    return fail('ILLEGAL_ROAD');
  }
  const state = cloneState(prev);
  const p = state.players[acting]!;
  if (!free) {
    p.resources = subtractCost(p.resources, BUILD_COSTS.road);
    state.bank.wood += BUILD_COSTS.road.wood ?? 0;
    state.bank.brick += BUILD_COSTS.road.brick ?? 0;
  }
  p.roadsLeft -= 1;
  state.roads[edge] = acting;

  const events: GameEvent[] = [{ type: 'roadBuilt', seat: acting, edge, ...(free ? { free: true } : {}) }];
  recomputeLongestRoad(state, events);
  if (!free) maybeWin(state, events);
  return ok(state, events);
}

function buildSettlement(prev: GameState, vertex: VertexId, _rng: Rng, free: boolean): ActionResult {
  const acting = prev.specialBuild?.seat ?? prev.activeSeat;
  if (prev.phase !== 'turnMain' && prev.phase !== 'specialBuild') {
    return fail('NOT_BUILD_PHASE');
  }
  if (prev.phase === 'specialBuild') {
    const sb = prev.specialBuild;
    if (sb === null || sb.seat === null) return fail('NO_SB_WINDOW');
    if (acting !== sb.seat) return fail('NOT_SB_ACTOR');
  }
  if (!canPlaceSettlement(prev, acting, vertex, false)) {
    return fail('ILLEGAL_SETTLEMENT');
  }
  const state = cloneState(prev);
  const p = state.players[acting]!;
  if (!free) {
    p.resources = subtractCost(p.resources, BUILD_COSTS.settlement);
    for (const r of RESOURCES) state.bank[r] += BUILD_COSTS.settlement[r as keyof typeof BUILD_COSTS.settlement] ?? 0;
  }
  p.settlementsLeft -= 1;
  state.buildings[vertex] = { seat: acting, type: 'settlement' };

  const events: GameEvent[] = [{ type: 'settlementBuilt', seat: acting, vertex }];
  recomputeLongestRoad(state, events);
  if (!free) maybeWin(state, events);
  return ok(state, events);
}

function buildCity(prev: GameState, vertex: VertexId): ActionResult {
  const acting = prev.specialBuild?.seat ?? prev.activeSeat;
  if (prev.phase !== 'turnMain' && prev.phase !== 'specialBuild') {
    return fail('NOT_BUILD_PHASE');
  }
  if (prev.phase === 'specialBuild') {
    const sb = prev.specialBuild;
    if (sb === null || sb.seat === null) return fail('NO_SB_WINDOW');
    if (acting !== sb.seat) return fail('NOT_SB_ACTOR');
  }
  if (!canPlaceCity(prev, acting, vertex)) {
    return fail('ILLEGAL_CITY');
  }
  const state = cloneState(prev);
  const p = state.players[acting]!;
  p.resources = subtractCost(p.resources, BUILD_COSTS.city);
  state.bank.wheat += BUILD_COSTS.city.wheat;
  state.bank.ore += BUILD_COSTS.city.ore;
  p.settlementsLeft += 1;
  p.citiesLeft -= 1;
  state.buildings[vertex] = { seat: acting, type: 'city' };

  const events: GameEvent[] = [{ type: 'cityBuilt', seat: acting, vertex }];
  maybeWin(state, events);
  return ok(state, events);
}

// ---------------------------------------------------------------------------
// Dev cards
// ---------------------------------------------------------------------------

function buyDevCard(prev: GameState, rng: Rng): ActionResult {
  const acting = prev.specialBuild?.seat ?? prev.activeSeat;
  if (prev.phase !== 'turnMain' && prev.phase !== 'specialBuild') {
    return fail('NOT_BUILD_PHASE');
  }
  if (prev.phase === 'specialBuild') {
    const sb = prev.specialBuild;
    if (sb === null || sb.seat === null) return fail('NO_SB_WINDOW');
    if (acting !== sb.seat) return fail('NOT_SB_ACTOR');
  }
  const p = prev.players[acting]!;
  if (prev.devDeckIndex >= prev.devDeck.length) {
    return fail('DECK_EMPTY');
  }
  if (!canAfford(p.resources, BUILD_COSTS.devCard)) {
    return fail('CANNOT_AFFORD');
  }
  const state = cloneState(prev);
  const card = state.devDeck[state.devDeckIndex]!;
  state.devDeckIndex += 1;
  const player = state.players[acting]!;
  player.resources = subtractCost(player.resources, BUILD_COSTS.devCard);
  state.bank.sheep += 1;
  state.bank.wheat += 1;
  state.bank.ore += 1;
  const bought: typeof card = { ...card, boughtOnTurn: state.turn };
  player.devHand.push(bought);

  const events: GameEvent[] = [{ type: 'devCardBought', seat: acting }];
  void rng;
  return ok(state, events);
}

function playDevCard(
  prev: GameState,
  action: Extract<GameAction, { type: 'playDevCard' }>,
  rng: Rng,
): ActionResult {
  if (prev.phase !== 'turnPreroll' && prev.phase !== 'turnMain') {
    return fail('NOT_DEV_PHASE');
  }
  const seat = prev.activeSeat;
  const p = prev.players[seat]!;
  const card = p.devHand.find((c) => c.id === action.cardId);
  if (card === undefined) return fail('NO_SUCH_CARD');
  if (card.played) return fail('CARD_ALREADY_PLAYED');
  if (card.boughtOnTurn === prev.turn) return fail('BOUGHT_THIS_TURN');
  if (card.type === 'victoryPoint') return fail('VP_NOT_PLAYABLE');

  if (prev.devCardPlayedThisTurn) {
    return fail('ONE_DEV_PER_TURN');
  }

  const state = cloneState(prev);
  const player = state.players[seat]!;
  const cardIdx = player.devHand.findIndex((c) => c.id === action.cardId);
  const theCard = player.devHand[cardIdx]!;

  const events: GameEvent[] = [];

  switch (theCard.type) {
    case 'knight': {
      theCard.played = true;
      player.playedKnights += 1;
      state.devCardPlayedThisTurn = true;
      state.phase = 'robberMove';
      events.push({ type: 'devCardPlayed', seat, cardId: theCard.id, cardType: 'knight' });
      // Largest army recompute after knight play.
      recomputeLargestArmy(state, events);
      // Knight during preroll: after robber+steal, phase returns to preroll
      // so the player still rolls. Track via flag:
      (state as GameState & { knightFromPreroll?: boolean }).knightFromPreroll =
        prev.phase === 'turnPreroll';
      return ok(state, events);
    }
    case 'roadBuilding': {
      const edges = action.payload?.edges;
      if (edges === undefined || edges.length !== 2) return fail('RB_NEEDS_2_EDGES');
      // Both roads placed as one action, validated in order.
      let working = state;
      for (const e of edges) {
        const res = buildRoad(working, e, rng, true);
        if (!res.ok) return res;
        working = res.state;
        events.push(...res.events);
      }
      working.devCardPlayedThisTurn = true;
      const marked = working.players[seat]!;
      const c = marked.devHand.find((x) => x.id === action.cardId);
      if (c !== undefined) c.played = true;
      events.unshift({ type: 'devCardPlayed', seat, cardId: action.cardId, cardType: 'roadBuilding' });
      return ok(working, events);
    }
    case 'monopoly': {
      const resource = action.payload?.resource;
      if (resource === undefined) return fail('MONO_NEEDS_RESOURCE');
      theCard.played = true;
      state.devCardPlayedThisTurn = true;
      let takenTotal = 0;
      for (const other of state.players) {
        if (other.seat === seat) continue;
        const n = other.resources[resource];
        other.resources[resource] = 0;
        player.resources[resource] += n;
        takenTotal += n;
      }
      events.push({ type: 'devCardPlayed', seat, cardId: theCard.id, cardType: 'monopoly' });
      events.push({ type: 'produced', seat, resource, amount: takenTotal });
      return ok(state, events);
    }
    case 'yearOfPlenty': {
      const resources = action.payload?.resources;
      if (resources === undefined || resources.length === 0 || resources.length > 2) {
        return fail('YOP_NEEDS_RESOURCES');
      }
      theCard.played = true;
      state.devCardPlayedThisTurn = true;
      for (const r of resources) {
        const avail = state.bank[r];
        const give = Math.min(avail, 1);
        state.bank[r] -= give;
        player.resources[r] += give;
        events.push({ type: 'produced', seat, resource: r, amount: give });
      }
      events.push({ type: 'devCardPlayed', seat, cardId: theCard.id, cardType: 'yearOfPlenty' });
      return ok(state, events);
    }
    default:
      return fail('UNPLAYABLE_CARD');
  }
}

// ---------------------------------------------------------------------------
// Trading
// ---------------------------------------------------------------------------

function bankTrade(prev: GameState, give: Resource, receive: Resource): ActionResult {
  if (prev.phase !== 'turnMain') return fail('NOT_TRADE_PHASE');
  const seat = prev.activeSeat;
  const p = prev.players[seat]!;
  const rate = bestTradeRate(prev, seat, give);
  if (p.resources[give] < rate) return fail('INSUFFICIENT_FOR_RATE');
  if (stateBankHas(prev, receive) < 1) return fail('BANK_EMPTY');
  if (give === receive) return fail('SAME_RESOURCE');

  const state = cloneState(prev);
  const player = state.players[seat]!;
  player.resources[give] -= rate;
  player.resources[receive] += 1;
  state.bank[give] += rate;
  state.bank[receive] -= 1;
  const events: GameEvent[] = [
    { type: 'bankTraded', seat, give, giveAmount: rate, receive },
  ];
  return ok(state, events);
}

function stateBankHas(state: GameState, r: Resource): number {
  return state.bank[r];
}

function validTradeAmounts(give: Partial<ResourceBag>, receive: Partial<ResourceBag>): boolean {
  const g = RESOURCES.reduce((n, r) => n + (give[r] ?? 0), 0);
  const rv = RESOURCES.reduce((n, r) => n + (receive[r] ?? 0), 0);
  if (g === 0 || rv === 0) return false;
  // No same-resource-for-same-resource on either side.
  for (const r of RESOURCES) {
    if ((give[r] ?? 0) > 0 && (receive[r] ?? 0) > 0) return false;
  }
  for (const bag of [give, receive]) {
    for (const r of RESOURCES) {
      if ((bag[r] ?? 0) < 0) return false;
    }
  }
  return true;
}

function tradeOffer(prev: GameState, action: Extract<GameAction, { type: 'tradeOffer' }>): ActionResult {
  if (prev.phase !== 'turnMain') return fail('NOT_TRADE_PHASE');
  const seat = prev.activeSeat;
  if (!validTradeAmounts(action.give, action.receive)) return fail('INVALID_TRADE');
  const p = prev.players[seat]!;
  for (const r of RESOURCES) {
    if ((action.give[r] ?? 0) > p.resources[r]) return fail('OFFER_UNAFFORDABLE');
  }
  const state = cloneState(prev);
  const id = `t${state.version}`;
  state.trades.push({
    id,
    proposer: seat,
    give: { ...action.give },
    receive: { ...action.receive },
    status: 'open',
    counterOf: null,
    declinedBy: [],
  });
  const events: GameEvent[] = [
    { type: 'tradeOffered', offerId: id, proposer: seat, give: fillBag(action.give), receive: fillBag(action.receive) },
  ];
  return ok(state, events);
}

function tradeCounter(prev: GameState, action: Extract<GameAction, { type: 'tradeCounter' }>): ActionResult {
  if (prev.phase !== 'turnMain') return fail('NOT_TRADE_PHASE');
  const target = prev.trades.find((t) => t.id === action.offerId);
  if (target === undefined || target.status !== 'open') return fail('OFFER_NOT_OPEN');
  const seat = action.seat !== undefined ? action.seat : prev.activeSeat;
  if (target.proposer === seat) return fail('CANNOT_COUNTER_OWN_OFFER');
  if (!validTradeAmounts(action.give, action.receive)) return fail('INVALID_TRADE');
  // The countering player must afford what they offer.
  const p = prev.players[seat];
  if (p === undefined) return fail('NO_SUCH_PLAYER');
  for (const r of RESOURCES) {
    if ((action.give[r] ?? 0) > p.resources[r]) return fail('OFFER_UNAFFORDABLE');
  }
  const state = cloneState(prev);
  const id = `t${state.version}`;
  state.trades.push({
    id,
    proposer: seat,
    give: { ...action.give },
    receive: { ...action.receive },
    status: 'open',
    counterOf: action.offerId,
    declinedBy: [],
  });
  const events: GameEvent[] = [
    { type: 'tradeCountered', offerId: id, counterOf: action.offerId, proposer: seat, give: fillBag(action.give), receive: fillBag(action.receive) },
  ];
  return ok(state, events);
}

function tradeRespond(prev: GameState, action: Extract<GameAction, { type: 'tradeRespond' }>): ActionResult {
  if (prev.phase !== 'turnMain') return fail('NOT_TRADE_PHASE');
  const offer = prev.trades.find((t) => t.id === action.offerId);
  if (offer === undefined || offer.status !== 'open') return fail('OFFER_NOT_OPEN');
  const seat = action.seat !== undefined ? action.seat : prev.activeSeat;
  if (offer.proposer === seat) return fail('CANNOT_SELF_TRADE');

  if (action.response === 'decline') {
    const state = cloneState(prev);
    const t = state.trades.find((x) => x.id === action.offerId)!;
    if (!t.declinedBy.includes(seat)) t.declinedBy.push(seat);
    return ok(state, [{ type: 'tradeDeclined', offerId: action.offerId, responder: seat }]);
  }

  // Accept: execute between offer.proposer (gives offer.give) and seat.
  const proposer = prev.players[offer.proposer]!;
  const accepter = prev.players[seat];
  if (accepter === undefined) return fail('NO_SUCH_PLAYER');
  for (const r of RESOURCES) {
    if ((offer.give[r] ?? 0) > proposer.resources[r]) return fail('OFFER_STALE');
    if ((offer.receive[r] ?? 0) > accepter.resources[r]) return fail('CANNOT_PAY_ACCEPT');
  }
  const state = cloneState(prev);
  const pr = state.players[offer.proposer]!;
  const ac = state.players[seat]!;
  for (const r of RESOURCES) {
    pr.resources[r] -= offer.give[r] ?? 0;
    pr.resources[r] += offer.receive[r] ?? 0;
    ac.resources[r] -= offer.receive[r] ?? 0;
    ac.resources[r] += offer.give[r] ?? 0;
  }
  const t = state.trades.find((x) => x.id === action.offerId)!;
  t.status = 'completed';
  const events: GameEvent[] = [
    { type: 'tradeCompleted', offerId: action.offerId, from: offer.proposer, to: seat, give: fillBag(offer.give), receive: fillBag(offer.receive) },
  ];
  return ok(state, events);
}

function tradeCancel(prev: GameState, action: Extract<GameAction, { type: 'tradeCancel' }>): ActionResult {
  const offer = prev.trades.find((t) => t.id === action.offerId);
  if (offer === undefined || offer.status !== 'open') return fail('OFFER_NOT_OPEN');
  if (offer.proposer !== prev.activeSeat) return fail('NOT_YOUR_OFFER');
  const state = cloneState(prev);
  const t = state.trades.find((x) => x.id === action.offerId)!;
  t.status = 'cancelled';
  return ok(state, [{ type: 'tradeCancelled', offerId: action.offerId, by: prev.activeSeat }]);
}

function fillBag(partial: Partial<ResourceBag>): Record<Resource, number> {
  return {
    wood: partial.wood ?? 0,
    brick: partial.brick ?? 0,
    sheep: partial.sheep ?? 0,
    wheat: partial.wheat ?? 0,
    ore: partial.ore ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Turn lifecycle
// ---------------------------------------------------------------------------

function endTurn(prev: GameState): ActionResult {
  if (prev.phase !== 'turnMain' && prev.phase !== 'turnPreroll') {
    return fail('NOT_YOUR_TURN_END');
  }
  const seat = prev.activeSeat;
  const state = cloneState(prev);

  const events: GameEvent[] = [{ type: 'turnEnded', seat }];
  state.trades = state.trades.map((t) =>
    t.status === 'open' ? { ...t, status: 'cancelled' as const } : t,
  );
  state.dice = null;
  state.devCardPlayedThisTurn = false;

  // 5-6p: enter the special build sequence before the next turn. Windows
  // auto-advance clockwise; each non-active seat may build once per round.
  if (state.playerCount >= 5) {
    state.specialBuild = { seat: null, usedThisRound: {} };
    state.phase = 'specialBuild';
    return sbNext(state, events);
  }

  advanceTurn(state, events);
  return ok(state, events);
}

function specialBuildActivate(
  prev: GameState,
  action: Extract<GameAction, { type: 'specialBuildActivate' }>,
): ActionResult {
  // Windows open automatically (sbNext); activation re-asserts the current
  // window owner — the server validates socket seat == action.seat first.
  if (prev.phase !== 'specialBuild') return fail('NOT_SB_TIME');
  const sb = prev.specialBuild;
  if (sb === null) return fail('NO_SB_STATE');
  if (action.seat !== sb.seat) return fail('NOT_YOUR_WINDOW');
  return ok(cloneState(prev), []);
}

function specialBuildDone(prev: GameState): ActionResult {
  if (prev.phase !== 'specialBuild') return fail('NOT_SB');
  const sb = prev.specialBuild;
  if (sb === null) return fail('NO_SB_STATE');
  if (sb.seat === null) {
    // Queue idle: auto-pass to the next eligible seat or finish the phase.
    return sbNext(prev, []);
  }
  const state = cloneState(prev);
  state.specialBuild = {
    ...sb,
    seat: null,
    usedThisRound: { ...sb.usedThisRound, [sb.seat]: true },
  };
  const events: GameEvent[] = [{ type: 'specialBuildDone', seat: sb.seat }];
  return sbNext(state, events);
}

/** Advance the specialBuild window to the next eligible seat or end phase. */
function sbNext(state: GameState, events: GameEvent[]): ActionResult {
  const order = seatQueueForSb(state);
  const nextSeat = order.find((s) => state.specialBuild!.usedThisRound[s] !== true);
  if (nextSeat !== undefined) {
    state.specialBuild = { ...state.specialBuild!, seat: nextSeat };
    events.push({ type: 'specialBuildActivated', seat: nextSeat });
    return ok(state, events);
  }
  // All windows used or passed — start the next turn.
  state.specialBuild = null;
  advanceTurn(state, events);
  return ok(state, events);
}

/** Clockwise seats eligible for a special-build window after the turn ends. */
function seatQueueForSb(state: GameState): number[] {
  const out: number[] = [];
  for (let i = 1; i < state.playerCount; i++) {
    out.push((state.activeSeat + i) % state.playerCount);
  }
  return out;
}

function advanceTurn(state: GameState, events: GameEvent[]): void {
  const nextSeat = (state.activeSeat + 1) % state.playerCount;
  // Reset SB usage when the round wraps back to seat 0's turn start.
  if (nextSeat === 0 && state.specialBuild === null) {
    // usedThisRound resets when each player's OWN turn ends — handled by
    // clearing on endTurn of the last seat; simple full reset on wrap:
    state.specialBuild = null;
  }
  state.activeSeat = nextSeat;
  state.turn += 1;
  state.phase = 'turnPreroll';
  state.devCardPlayedThisTurn = false;
  events.push({ type: 'turnStarted', seat: nextSeat, turn: state.turn });
}

// ---------------------------------------------------------------------------
// Awards & victory
// ---------------------------------------------------------------------------

function recomputeLongestRoad(state: GameState, events: GameEvent[]): void {
  const players = state.players.map((p) => ({ seat: p.seat, roads: Object.keys(state.roads).filter((e) => state.roads[e] === p.seat) }));
  const buildings = new Map<VertexId, number>();
  for (const [v, b] of Object.entries(state.buildings)) {
    buildings.set(Number(v), b.seat);
  }
  const prevHolder = state.longestRoad.holder;
  const award = computeLongestRoadAward(
    state.longestRoad,
    players,
    buildings,
    state.board.topology,
  );
  const changed = award.holder !== prevHolder;
  state.longestRoad = award;
  if (changed) {
    events.push({ type: 'longestRoadChanged', from: prevHolder, to: award.holder, length: award.length });
  }
}

function recomputeLargestArmy(state: GameState, events: GameEvent[]): void {
  const prevHolder = state.largestArmy.holder;
  const prevKnights = state.largestArmy.knights;
  let bestSeat: number | null = null;
  let bestKnights = 3; // minimum to claim
  for (const p of state.players) {
    if (p.playedKnights >= bestKnights) {
      if (p.playedKnights > bestKnights || bestSeat === null) {
        // Strictly greater steals; ties keep the current holder.
        if (p.playedKnights > bestKnights || prevHolder === null) {
          bestSeat = p.seat;
          bestKnights = p.playedKnights;
        }
      }
    }
  }
  // Holder keeps award on ties.
  if (prevHolder !== null) {
    const holderKnights = state.players[prevHolder]?.playedKnights ?? 0;
    let beaten = false;
    for (const p of state.players) {
      if (p.seat !== prevHolder && p.playedKnights > holderKnights) {
        beaten = true;
        bestSeat = p.seat;
        bestKnights = p.playedKnights;
      }
    }
    if (!beaten) {
      bestSeat = prevHolder;
      bestKnights = holderKnights;
    }
  }
  if (bestSeat !== null && (bestSeat !== prevHolder || bestKnights !== prevKnights)) {
    state.largestArmy = { holder: bestSeat, knights: bestKnights };
    if (bestSeat !== prevHolder) {
      events.push({ type: 'largestArmyChanged', from: prevHolder, to: bestSeat, knights: bestKnights });
    }
  }
}

function maybeWin(state: GameState, events: GameEvent[]): void {
  // Win checks only on the acting player's own turn (SBP can't win).
  if (state.phase === 'specialBuild') return;
  const seat = state.activeSeat;
  if (totalVpIncluding(state, seat) >= state.rules.victoryPointsToWin) {
    state.phase = 'finished';
    state.winner = seat;
    // Reveal all VP cards of the winner.
    for (const c of state.players[seat]!.devHand) {
      if (c.type === 'victoryPoint') c.played = true;
    }
    events.push({ type: 'victory', seat, vp: totalVpIncluding(state, seat) });
  }
}

function totalVpIncluding(state: GameState, seat: number): number {
  const p = state.players[seat]!;
  let vp = 0;
  for (const b of Object.values(state.buildings)) {
    if (b.seat === seat) vp += b.type === 'settlement' ? 1 : 2;
  }
  if (state.longestRoad.holder === seat) vp += 2;
  if (state.largestArmy.holder === seat) vp += 2;
  vp += p.devHand.filter((c) => c.type === 'victoryPoint' && !c.played).length;
  return vp;
}

function ok(state: GameState, events: GameEvent[]): ActionResult {
  return { ok: true, state, events };
}
