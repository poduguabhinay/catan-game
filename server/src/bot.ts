// Server Bot AI engine: decision making for AI-controlled seats across all phases.
// Fully rules-compliant, server-authoritative, and deterministic with the room's RNG.

import type {
  GameAction,
  GameState,
  HexId,
  Resource,
  Rng,
  VertexId,
} from '@catan/shared';
import {
  bestTradeRate,
  BUILD_COSTS,
  canAfford,
  canPlaceSetupRoad,
  legalCityVertices,
  legalRoadEdges,
  legalRobberHexes,
  legalSettlementVertices,
  PIPS,
  RESOURCES,
  stealCandidates,
  TERRAIN_RESOURCE,
} from '@catan/shared';

export const BOT_NAMES = [
  'Bot Alice',
  'Bot Bob',
  'Bot Charlie',
  'Bot Diana',
  'Bot Ethan',
  'Bot Fiona',
  'Bot George',
  'Bot Hana',
] as const;

function totalResources(bag: Record<Resource, number>): number {
  return bag.wood + bag.brick + bag.sheep + bag.wheat + bag.ore;
}

/** Score a vertex for settlement placement based on adjacent hex pips, terrain diversity, and harbors. */
function scoreVertex(state: GameState, vertex: VertexId): number {
  let score = 0;
  const hexes = state.board.topology.vertexHexes[vertex] ?? [];
  const resourcesSeen = new Set<Resource>();

  for (const h of hexes) {
    const hexData = state.board.hexes[h];
    if (hexData === undefined) continue;
    const res = TERRAIN_RESOURCE[hexData.terrain];
    if (res === null) continue;
    resourcesSeen.add(res);
    const pips = hexData.token !== null ? (PIPS[hexData.token] ?? 0) : 0;
    score += pips * 2.2;
  }

  // Bonus for resource variety (e.g. 3 different resources is great!)
  score += resourcesSeen.size * 3.5;

  // Bonus if on a harbor edge
  const edges = state.board.topology.vertexEdges[vertex] ?? [];
  for (const e of edges) {
    if (state.board.harbors[e] !== undefined) {
      score += 2.0;
      break;
    }
  }

  return score;
}

/** Score a hex for robber placement. Highly penalize own hexes; reward opponents' high-pip tiles. */
function scoreRobberHex(state: GameState, botSeat: number, hex: HexId): number {
  if (hex === state.robber) return -9999;
  const hexData = state.board.hexes[hex];
  if (hexData === undefined || hexData.terrain === 'desert') return -500;

  const pips = hexData.token !== null ? (PIPS[hexData.token] ?? 0) : 0;
  const score = pips * 2;

  const vertices = state.board.topology.hexVertices[hex] ?? [];
  let touchesBot = false;
  let opponentScore = 0;

  for (const v of vertices) {
    const b = state.buildings[v];
    if (b === undefined) continue;
    if (b.seat === botSeat) {
      touchesBot = true;
    } else {
      const opp = state.players[b.seat];
      const vp = opp ? opp.playedKnights + opp.citiesLeft : 2;
      opponentScore += (b.type === 'city' ? 6 : 3) * vp;
    }
  }

  if (touchesBot) return -1000;
  return score + opponentScore;
}

/** Determine the next action for a bot in the given game state. */
export function computeBotAction(
  state: GameState,
  botSeat: number,
  rng: Rng,
): GameAction | null {
  // 1. DISCARD PHASE: Must discard if required
  if (state.phase === 'discard') {
    const pending = state.pendingDiscards.find((d) => d.seat === botSeat && !d.received);
    if (pending === undefined) return null;

    const p = state.players[botSeat]!;
    const toDiscard: Record<Resource, number> = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    let needed = pending.count;

    // Discard greedily from the resource with the most cards
    const sortedRes = [...RESOURCES].sort((a, b) => p.resources[b] - p.resources[a]);
    for (const r of sortedRes) {
      const take = Math.min(p.resources[r], needed);
      toDiscard[r] = take;
      needed -= take;
      if (needed === 0) break;
    }

    return { type: 'discard', seat: botSeat, resources: toDiscard };
  }

  // 2. OPEN TRADES FROM OTHER PLAYERS: Evaluate and respond
  if (state.phase === 'turnMain' && state.activeSeat !== botSeat) {
    const openTrade = state.trades.find(
      (t) => t.status === 'open' && t.proposer !== botSeat && !t.declinedBy.includes(botSeat),
    );
    if (openTrade !== undefined) {
      const p = state.players[botSeat]!;
      // Check if bot can afford what proposer wants
      const canAffordGive = RESOURCES.every(
        (r) => (openTrade.receive[r] ?? 0) <= p.resources[r],
      );
      const receivesCount = RESOURCES.reduce((s, r) => s + (openTrade.give[r] ?? 0), 0);
      const givesCount = RESOURCES.reduce((s, r) => s + (openTrade.receive[r] ?? 0), 0);

      // Bot accepts if it can afford and the trade is fair or advantageous (receives >= gives)
      if (canAffordGive && receivesCount >= givesCount && receivesCount > 0) {
        return { type: 'tradeRespond', offerId: openTrade.id, response: 'accept', seat: botSeat };
      }
      return { type: 'tradeRespond', offerId: openTrade.id, response: 'decline', seat: botSeat };
    }
  }

  // 3. SPECIAL BUILD PHASE (5+ players)
  if (state.phase === 'specialBuild') {
    if (state.specialBuild?.seat !== botSeat) return null;
    const p = state.players[botSeat]!;

    // Can we build a city?
    if (canAfford(p.resources, BUILD_COSTS.city)) {
      const cities = legalCityVertices(state, botSeat);
      if (cities.length > 0) {
        const target = cities.reduce((best, v) => (scoreVertex(state, v) > scoreVertex(state, best) ? v : best), cities[0]!);
        return { type: 'buildCity', vertex: target };
      }
    }
    // Can we build a settlement?
    if (canAfford(p.resources, BUILD_COSTS.settlement)) {
      const settlements = legalSettlementVertices(state, botSeat, false);
      if (settlements.length > 0) {
        const target = settlements.reduce((best, v) => (scoreVertex(state, v) > scoreVertex(state, best) ? v : best), settlements[0]!);
        return { type: 'buildSettlement', vertex: target };
      }
    }
    // Can we build a road?
    if (canAfford(p.resources, BUILD_COSTS.road)) {
      const roads = legalRoadEdges(state, botSeat);
      if (roads.length > 0) {
        return { type: 'buildRoad', edge: rng.pick(roads) };
      }
    }
    // Can we buy a dev card?
    if (canAfford(p.resources, BUILD_COSTS.devCard) && state.devDeckIndex < state.devDeck.length) {
      return { type: 'buyDevCard' };
    }
    return { type: 'specialBuildDone' };
  }

  // If it's not the bot's active turn, no further actions
  if (state.activeSeat !== botSeat) return null;

  // 4. SETUP PHASES
  if (state.phase === 'setupForward' || state.phase === 'setupReverse') {
    const legalVertices = legalSettlementVertices(state, botSeat, true);
    if (legalVertices.length === 0) return null;

    // Pick vertex with highest score
    let bestVertex = legalVertices[0]!;
    let bestScore = -Infinity;
    for (const v of legalVertices) {
      const s = scoreVertex(state, v);
      if (s > bestScore) {
        bestScore = s;
        bestVertex = v;
      }
    }

    // Pick an adjacent road edge
    const edges = state.board.topology.vertexEdges[bestVertex] ?? [];
    const validEdges = edges.filter((e) => canPlaceSetupRoad(state, botSeat, e, bestVertex));
    const chosenEdge = validEdges.length > 0 ? rng.pick(validEdges) : edges[0];
    if (chosenEdge === undefined) return null;

    return { type: 'setupPlace', settlementVertex: bestVertex, roadEdge: chosenEdge };
  }

  // 5. TURN PREROLL
  if (state.phase === 'turnPreroll') {
    const p = state.players[botSeat]!;
    // Consider playing Knight before rolling if robber is on one of bot's tiles
    const knight = p.devHand.find((c) => c.type === 'knight' && !c.played && c.boughtOnTurn < state.turn);
    if (knight !== undefined && !state.devCardPlayedThisTurn) {
      const robberVertices = state.board.topology.hexVertices[state.robber] ?? [];
      const touchesBot = robberVertices.some((v) => state.buildings[v]?.seat === botSeat);
      if (touchesBot) {
        return { type: 'playDevCard', cardId: knight.id };
      }
    }
    return { type: 'rollDice' };
  }

  // 6. ROBBER MOVE
  if (state.phase === 'robberMove') {
    const hexes = legalRobberHexes(state);
    if (hexes.length === 0) return null;

    let bestHex = hexes[0]!;
    let bestScore = -Infinity;
    for (const h of hexes) {
      const s = scoreRobberHex(state, botSeat, h);
      if (s > bestScore) {
        bestScore = s;
        bestHex = h;
      }
    }

    return { type: 'moveRobber', hex: bestHex };
  }

  // 7. ROBBER STEAL
  if (state.phase === 'robberSteal') {
    const candidates = stealCandidates(state, state.robber);
    const withCards = candidates.filter((s) => totalResources(state.players[s]!.resources) > 0);
    const pool = withCards.length > 0 ? withCards : candidates;
    if (pool.length === 0) return null;

    // Target the opponent with the most total resources or highest public VP
    let bestVictim = pool[0]!;
    let maxCards = -1;
    for (const s of pool) {
      const count = totalResources(state.players[s]!.resources);
      if (count > maxCards) {
        maxCards = count;
        bestVictim = s;
      }
    }

    return { type: 'chooseSteal', victimSeat: bestVictim };
  }

  // 8. TURN MAIN: Build, trade, dev cards, end turn
  if (state.phase === 'turnMain') {
    const p = state.players[botSeat]!;

    // A. Play Dev Card if advantageous
    if (!state.devCardPlayedThisTurn) {
      // 1. Year of plenty
      const yop = p.devHand.find((c) => c.type === 'yearOfPlenty' && !c.played && c.boughtOnTurn < state.turn);
      if (yop !== undefined) {
        // Pick 2 resources that the bot is lowest on
        const needed = [...RESOURCES].sort((a, b) => p.resources[a] - p.resources[b]);
        const r1 = needed[0]!;
        const r2 = needed[1]!;
        return { type: 'playDevCard', cardId: yop.id, payload: { resources: [r1, r2] } };
      }

      // 2. Monopoly
      const mono = p.devHand.find((c) => c.type === 'monopoly' && !c.played && c.boughtOnTurn < state.turn);
      if (mono !== undefined) {
        // Guess the resource opponents have most of (e.g. wheat or ore or wood)
        const targetRes: Resource = p.resources.ore < p.resources.wheat ? 'ore' : 'wheat';
        return { type: 'playDevCard', cardId: mono.id, payload: { resource: targetRes } };
      }

      // 3. Road Building
      const rb = p.devHand.find((c) => c.type === 'roadBuilding' && !c.played && c.boughtOnTurn < state.turn);
      if (rb !== undefined && p.roadsLeft >= 2) {
        const legalRoads = legalRoadEdges(state, botSeat);
        if (legalRoads.length >= 2) {
          return { type: 'playDevCard', cardId: rb.id, payload: { edges: [legalRoads[0]!, legalRoads[1]!] } };
        }
      }

      // 4. Knight (if robber on bot tile)
      const knight = p.devHand.find((c) => c.type === 'knight' && !c.played && c.boughtOnTurn < state.turn);
      if (knight !== undefined) {
        const robberVertices = state.board.topology.hexVertices[state.robber] ?? [];
        if (robberVertices.some((v) => state.buildings[v]?.seat === botSeat)) {
          return { type: 'playDevCard', cardId: knight.id };
        }
      }
    }

    // B. Upgrade to City (highest priority for victory points)
    if (canAfford(p.resources, BUILD_COSTS.city) && p.citiesLeft > 0) {
      const cities = legalCityVertices(state, botSeat);
      if (cities.length > 0) {
        const target = cities.reduce((best, v) => (scoreVertex(state, v) > scoreVertex(state, best) ? v : best), cities[0]!);
        return { type: 'buildCity', vertex: target };
      }
    }

    // C. Build Settlement
    if (canAfford(p.resources, BUILD_COSTS.settlement) && p.settlementsLeft > 0) {
      const settlements = legalSettlementVertices(state, botSeat, false);
      if (settlements.length > 0) {
        const target = settlements.reduce((best, v) => (scoreVertex(state, v) > scoreVertex(state, best) ? v : best), settlements[0]!);
        return { type: 'buildSettlement', vertex: target };
      }
    }

    // D. Bank Trade to afford Settlement or City if close
    const canDoBankTrade = (neededRes: Resource): GameAction | null => {
      for (const give of RESOURCES) {
        if (give === neededRes) continue;
        const rate = bestTradeRate(state, botSeat, give);
        if (p.resources[give] >= rate + 1 && state.bank[neededRes] > 0) {
          return { type: 'bankTrade', give, receive: neededRes };
        }
      }
      return null;
    };

    // If 1 card away from City, try bank trade
    if (p.citiesLeft > 0 && p.resources.wheat >= 2 && p.resources.ore === 2) {
      const trade = canDoBankTrade('ore');
      if (trade !== null) return trade;
    }
    if (p.citiesLeft > 0 && p.resources.wheat === 1 && p.resources.ore >= 3) {
      const trade = canDoBankTrade('wheat');
      if (trade !== null) return trade;
    }

    // If 1 card away from Settlement, try bank trade
    if (p.settlementsLeft > 0 && legalSettlementVertices(state, botSeat, false).length > 0) {
      const missing = (['wood', 'brick', 'sheep', 'wheat'] as const).filter((r) => p.resources[r] === 0);
      if (missing.length === 1) {
        const trade = canDoBankTrade(missing[0]!);
        if (trade !== null) return trade;
      }
    }

    // E. Build Road toward legal settlement locations
    if (canAfford(p.resources, BUILD_COSTS.road) && p.roadsLeft > 0) {
      const roads = legalRoadEdges(state, botSeat);
      if (roads.length > 0 && p.settlementsLeft > 0) {
        return { type: 'buildRoad', edge: rng.pick(roads) };
      }
    }

    // F. Buy Dev Card if affordable and deck not empty
    if (canAfford(p.resources, BUILD_COSTS.devCard) && state.devDeckIndex < state.devDeck.length) {
      return { type: 'buyDevCard' };
    }

    // G. Nothing more to do -> End Turn
    return { type: 'endTurn' };
  }

  return null;
}
