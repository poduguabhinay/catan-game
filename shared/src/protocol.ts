// Wire protocol: discriminated action union + event union. Zod schemas
// validate client payloads server-side (schemas co-located so client and
// server share the exact contract).

import { z } from 'zod';
import type { Resource } from './constants';
import type { EdgeId, HexId } from './topology';

// ---------------------------------------------------------------------------
// Actions (client -> server)
// ---------------------------------------------------------------------------

export const resourceSchema = z.enum(['wood', 'brick', 'sheep', 'wheat', 'ore']);
/**
 * Partial resource bag over the wire: keys are resources, values non-negative.
 * All 5 keys are optional individually; the reducer validates sums.
 */
export const resourceBagSchema = z.record(
  resourceSchema,
  z.number().int().nonnegative(),
) as unknown as z.ZodType<Partial<Record<'wood' | 'brick' | 'sheep' | 'wheat' | 'ore', number>>>;

export const gameActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('setupPlace'),
    settlementVertex: z.number().int().nonnegative(),
    roadEdge: z.string(),
  }),
  z.object({ type: z.literal('rollDice') }),
  z.object({ type: z.literal('buildRoad'), edge: z.string() }),
  z.object({ type: z.literal('buildSettlement'), vertex: z.number().int().nonnegative() }),
  z.object({ type: z.literal('buildCity'), vertex: z.number().int().nonnegative() }),
  z.object({ type: z.literal('buyDevCard') }),
  z.object({
    type: z.literal('playDevCard'),
    cardId: z.string(),
    payload: z
      .object({
        resources: z.array(resourceSchema).max(2).optional(), // year of plenty
        resource: resourceSchema.optional(), // monopoly
        edges: z.array(z.string()).length(2).optional(), // road building
      })
      .optional(),
  }),
  z.object({ type: z.literal('moveRobber'), hex: z.string() }),
  z.object({ type: z.literal('chooseSteal'), victimSeat: z.number().int().nonnegative() }),
  z.object({
    type: z.literal('discard'),
    seat: z.number().int().nonnegative().optional(),
    resources: resourceBagSchema,
  }),
  z.object({
    type: z.literal('bankTrade'),
    give: resourceSchema,
    receive: resourceSchema,
  }),
  z.object({ type: z.literal('endTurn') }),
  z.object({
    type: z.literal('tradeOffer'),
    give: resourceBagSchema,
    receive: resourceBagSchema,
  }),
  z.object({
    type: z.literal('tradeRespond'),
    seat: z.number().int().nonnegative().optional(),
    offerId: z.string(),
    response: z.enum(['accept', 'decline']),
  }),
  z.object({
    type: z.literal('tradeCounter'),
    seat: z.number().int().nonnegative().optional(),
    offerId: z.string(),
    give: resourceBagSchema,
    receive: resourceBagSchema,
  }),
  z.object({ type: z.literal('tradeCancel'), offerId: z.string() }),
  z.object({ type: z.literal('specialBuildActivate'), seat: z.number().int().nonnegative() }),
  z.object({ type: z.literal('specialBuildDone') }),
]);

export type GameAction = z.infer<typeof gameActionSchema>;

// ---------------------------------------------------------------------------
// Events (server -> clients; also the JSONL log line payload)
// ---------------------------------------------------------------------------

export type TradeDirection = { give: Partial<Record<Resource, number>>; receive: Partial<Record<Resource, number>> };

export type GameEvent =
  | { type: 'gameStarted'; playerCount: number; seed: string }
  | { type: 'setupPlaced'; seat: number; settlementVertex: number; roadEdge: EdgeId; second: boolean }
  | { type: 'rolled'; seat: number; die1: number; die2: number }
  | { type: 'produced'; seat: number; resource: Resource; amount: number }
  | { type: 'bankShortage'; resource: Resource }
  | { type: 'roadBuilt'; seat: number; edge: EdgeId; free?: boolean }
  | { type: 'settlementBuilt'; seat: number; vertex: number }
  | { type: 'cityBuilt'; seat: number; vertex: number }
  | { type: 'devCardBought'; seat: number }
  | { type: 'devCardPlayed'; seat: number; cardId: string; cardType: string }
  | { type: 'robberMoved'; seat: number | null; hex: HexId }
  | { type: 'stolenFrom'; seat: number; victim: number; resource: Resource | null }
  | { type: 'discardRequired'; seat: number; count: number }
  | { type: 'discarded'; seat: number; resources: Partial<Record<Resource, number>> }
  | { type: 'tradeOffered'; offerId: string; proposer: number; give: Record<Resource, number>; receive: Record<Resource, number> }
  | { type: 'tradeCountered'; offerId: string; counterOf: string; proposer: number; give: Record<Resource, number>; receive: Record<Resource, number> }
  | { type: 'tradeCompleted'; offerId: string; from: number; to: number; give: Record<Resource, number>; receive: Record<Resource, number> }
  | { type: 'tradeDeclined'; offerId: string; responder: number }
  | { type: 'tradeCancelled'; offerId: string; by: number }
  | { type: 'bankTraded'; seat: number; give: Resource; giveAmount: number; receive: Resource }
  | { type: 'longestRoadChanged'; from: number | null; to: number | null; length: number }
  | { type: 'largestArmyChanged'; from: number | null; to: number | null; knights: number }
  | { type: 'specialBuildActivated'; seat: number }
  | { type: 'specialBuildDone'; seat: number }
  | { type: 'turnStarted'; seat: number; turn: number }
  | { type: 'turnEnded'; seat: number }
  | { type: 'timedOut'; seat: number; autoAction: string }
  | { type: 'victory'; seat: number; vp: number };

export const DEV_CARD_ID_PREFIX = 'dev';
