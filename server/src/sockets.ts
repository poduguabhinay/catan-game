// Socket.io event wiring: room lifecycle, game actions, timers, reconnect.
// Single authoritative path: every game mutation runs through applyAction.

import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import {
  gameActionSchema,
  generateBoard,
  legalSettlementVertices,
  stealCandidates,
  type GameAction,
} from '@catan/shared';
import type { PlayerColor, PlayerCount } from '@catan/shared';
import { applyAction } from '@catan/shared';
import type { RoomManager} from './rooms';
import { type Room } from './rooms';
import type { GameLog } from './jsonl';
import { sanitize } from './sanitize';
import { autoActionFor, phaseTimerMs } from './timers';
import { createBalancedDiceSource } from './dice';
import { computeBotAction } from './bot';

export interface ServerContext {
  io: Server;
  rooms: RoomManager;
  log: GameLog;
  timers: Map<string, NodeJS.Timeout>; // roomCode -> active timeout
  timerDeadlines: Map<string, { phase: string; deadlineUnixMs: number }>;
}

const joinPayloadSchema = z.object({
  code: z.string().length(4),
  name: z.string().min(1).max(24).optional(),
  token: z.string().min(10).optional(),
});

const createPayloadSchema = z.object({ name: z.string().min(1).max(24) });

const setReadySchema = z.object({ ready: z.boolean() });
const pickColorSchema = z.object({ color: z.string() });
const settingsSchema = z.object({
  maxPlayers: z.number().int().min(3).max(8).optional(),
  turnTimerSec: z.number().int().min(0).max(600).optional(),
  diceMode: z.enum(['random', 'balanced']).optional(),
  victoryPointsToWin: z.number().int().min(3).max(20).optional(),
  discardLimit: z.number().int().min(5).max(20).optional(),
});

export function roomStatePayload(room: Room): unknown {
  return {
    roomCode: room.code,
    host: room.hostSeatIndex,
    players: room.seats.map((s) => ({
      seatIndex: s.seatIndex,
      name: s.name,
      color: s.color,
      ready: s.ready,
      connected: s.connected,
      isBot: s.isBot === true,
    })),
    settings: room.settings,
    seed: room.seed,
    started: room.game !== null,
  };
}

function broadcastRoom(ctx: ServerContext, room: Room): void {
  ctx.io.to(room.code).emit('room:state', roomStatePayload(room));
}

function broadcastGame(ctx: ServerContext, room: Room): void {
  if (room.game === null) return;
  for (const seat of room.seats) {
    if (seat.socketId === null) continue;
    ctx.io.to(seat.socketId).emit('game:state', sanitize(room.game.state, seat.seatIndex));
  }
  // Spectators / disconnected sockets still get a public board view via log.
}

function armTimer(ctx: ServerContext, room: Room): void {
  const existing = ctx.timers.get(room.code);
  if (existing !== undefined) {
    clearTimeout(existing);
    ctx.timers.delete(room.code);
  }
  if (room.game === null) return;
  const phase = room.game.state.phase;
  if (phase === 'finished') return;
  const ms = phaseTimerMs(phase, room.settings.turnTimerSec);
  if (ms === null) return;

  const deadline = Date.now() + ms;
  ctx.timerDeadlines.set(room.code, { phase, deadlineUnixMs: deadline });
  ctx.io.to(room.code).emit('game:timer', { phase, deadlineUnixMs: deadline });

  const timeout = setTimeout(() => {
    void runAutoAction(ctx, room.code);
  }, ms);
  ctx.timers.set(room.code, timeout);
}

async function runAutoAction(ctx: ServerContext, code: string): Promise<void> {
  const room = ctx.rooms.getRoom(code);
  ctx.timers.delete(code);
  if (room?.game === null || room === undefined || room.game === null) return;
  const state = room.game.state;
  const rng = ctx.rooms.gameRng(room);
  const auto = autoActionFor(state.phase, state.activeSeat, state, rng);
  if (auto === null) {
    armTimer(ctx, room);
    return;
  }

  // Synthesize the placeholder actions that need legal queries.
  let action: GameAction | null;
  if (auto.action.type === '__autoSetupPlace') {
    const seat = state.activeSeat;
    const vertices = legalSettlementVertices(state, seat, true);
    if (vertices.length === 0) {
      action = null;
    } else {
      const vertex = rng.pick(vertices);
      const edges = state.board.topology.vertexEdges[vertex] ?? [];
      const edge = edges.find((e) => state.roads[e] === undefined) ?? edges[0];
      action =
        edge === undefined
          ? null
          : { type: 'setupPlace', settlementVertex: vertex, roadEdge: edge };
    }
  } else if (auto.action.type === '__autoChooseSteal') {
    const candidates = stealCandidates(state, state.robber);
    const withCards = candidates.filter((s) => {
      const p = state.players[s]!;
      return RESOURCES_TOTAL(p.resources) > 0;
    });
    const pool = withCards.length > 0 ? withCards : candidates;
    action = pool.length > 0 ? { type: 'chooseSteal', victimSeat: rng.pick(pool) } : null;
  } else {
    action = auto.action;
  }
  if (action === null) {
    armTimer(ctx, room);
    return;
  }

  const rollDice = makeRollSource(ctx, room);
  const result = applyAction(state, action, rng, rollDice);
  if (result.ok) {
    room.game.state = result.state;
    for (const e of result.events) {
      room.game.events.push(e);
      ctx.log.append(room.code, e);
      ctx.io.to(room.code).emit('game:event', e);
    }
    if (state.activeSeat !== result.state.activeSeat || state.phase !== result.state.phase) {
      ctx.io.to(room.code).emit(
        'game:timer',
        ctx.timerDeadlines.get(room.code) ?? { phase: result.state.phase, deadlineUnixMs: 0 },
      );
    }
  }
  broadcastGame(ctx, room);
  armTimer(ctx, room);
  triggerBotTurnIfNeeded(ctx, room);
}

function RESOURCES_TOTAL(bag: Record<string, number>): number {
  return Object.values(bag).reduce((a, b) => a + b, 0);
}

/** Dice source honoring the room's diceMode. */
function makeRollSource(ctx: ServerContext, room: Room): Parameters<typeof applyAction>[3] {
  if (room.settings.diceMode !== 'balanced') return undefined;
  const balanced = createBalancedDiceSource();
  return (rng) => {
    const prev = room.game?.state.dice ?? null;
    const p = prev === null ? null : [prev.die1, prev.die2] as [number, number];
    return balanced.roll(rng, p);
  };
}

function handleGameAction(ctx: ServerContext, socket: Socket | null, room: Room, seat: number, action: GameAction): void {
  if (room.game === null) {
    socket?.emit('error', { message: 'GAME_NOT_STARTED' });
    return;
  }
  const state = room.game.state;
  const rng = ctx.rooms.gameRng(room);

  // Seat gate: only actions from the correct actor reach the engine.
  const actorOk = isActorAllowed(state, action, seat);
  if (!actorOk) {
    socket?.emit('error', { message: 'NOT_YOUR_ACTION' });
    return;
  }

  // Stamp authenticated seat on non-active actions
  let stampedAction = action;
  if (action.type === 'discard' || action.type === 'tradeRespond' || action.type === 'tradeCounter') {
    stampedAction = { ...action, seat };
  }

  const result = applyAction(state, stampedAction, rng, makeRollSource(ctx, room));
  if (!result.ok) {
    socket?.emit('error', { message: result.error });
    return;
  }
  room.game.state = result.state;
  for (const e of result.events) {
    room.game.events.push(e);
    ctx.log.append(room.code, e);
    ctx.io.to(room.code).emit('game:event', e);
  }
  broadcastGame(ctx, room);
  armTimer(ctx, room);
  triggerBotTurnIfNeeded(ctx, room);
}

const botTimers = new Map<string, NodeJS.Timeout>();

function triggerBotTurnIfNeeded(ctx: ServerContext, room: Room): void {
  if (room.game === null || room.game.state.phase === 'finished') return;

  const existing = botTimers.get(room.code);
  if (existing !== undefined) {
    clearTimeout(existing);
    botTimers.delete(room.code);
  }

  const botSeats = new Set(room.seats.filter((s) => s.isBot).map((s) => s.seatIndex));
  if (botSeats.size === 0) return;

  const state = room.game.state;
  let targetBotSeat: number | null = null;

  if (state.phase === 'discard') {
    const pendingBot = state.pendingDiscards.find((d) => !d.received && botSeats.has(d.seat));
    if (pendingBot !== undefined) targetBotSeat = pendingBot.seat;
  } else if (botSeats.has(state.activeSeat)) {
    targetBotSeat = state.activeSeat;
  } else if (state.phase === 'specialBuild' && state.specialBuild !== null && state.specialBuild.seat !== null && botSeats.has(state.specialBuild.seat)) {
    targetBotSeat = state.specialBuild.seat;
  } else if (state.phase === 'turnMain') {
    const openTrade = state.trades.find((t) => t.status === 'open' && t.proposer !== state.activeSeat);
    if (openTrade !== undefined) {
      const botToRespond = room.seats.find((s) => s.isBot && s.seatIndex !== openTrade.proposer && !openTrade.declinedBy.includes(s.seatIndex));
      if (botToRespond !== undefined) targetBotSeat = botToRespond.seatIndex;
    }
  }

  if (targetBotSeat === null) return;

  const botSeat = targetBotSeat;
  const timer = setTimeout(() => {
    botTimers.delete(room.code);
    const currentRoom = ctx.rooms.getRoom(room.code);
    if (currentRoom?.game === null || currentRoom === undefined || currentRoom.game === null) return;
    if (currentRoom.game.state.phase === 'finished') return;

    const act = computeBotAction(currentRoom.game.state, botSeat, ctx.rooms.gameRng(currentRoom));
    if (act !== null) {
      handleGameAction(ctx, null, currentRoom, botSeat, act);
    }
  }, 500);

  botTimers.set(room.code, timer);
}

function isActorAllowed(
  state: Parameters<typeof applyAction>[0],
  action: GameAction,
  seat: number,
): boolean {
  switch (action.type) {
    case 'setupPlace':
      return state.phase === 'setupForward' || state.phase === 'setupReverse'
        ? seat === state.activeSeat
        : false;
    case 'rollDice':
    case 'endTurn':
    case 'tradeOffer':
    case 'tradeCancel':
    case 'buildSettlement':
    case 'buildCity':
    case 'bankTrade':
      return seat === state.activeSeat;
    case 'buildRoad':
    case 'buyDevCard':
      // Special build: the SBP window owner; otherwise active seat.
      if (state.phase === 'specialBuild') {
        return seat === state.specialBuild?.seat;
      }
      return seat === state.activeSeat;
    case 'playDevCard':
      return seat === state.activeSeat;
    case 'moveRobber':
    case 'chooseSteal':
      return seat === state.activeSeat;
    case 'discard': {
      // Any pending discarder may submit their discard.
      return state.pendingDiscards.some((d) => d.seat === seat && !d.received);
    }
    case 'tradeRespond':
    case 'tradeCounter':
      // Any non-proposer may respond during the proposer's turn.
      return seat !== state.activeSeat;
    case 'specialBuildActivate':
      return action.seat === seat && seat !== state.activeSeat;
    case 'specialBuildDone':
      return seat === state.specialBuild?.seat;
    default:
      return false;
  }
}

export function registerSocketHandlers(ctx: ServerContext): void {
  const { io } = ctx;

  io.on('connection', (socket) => {
    let joinedRoom: string | null = null;
    let joinedSeat: number | null = null;

    socket.on('room:create', (raw: unknown) => {
      const parsed = createPayloadSchema.safeParse(raw);
      if (!parsed.success) {
        socket.emit('error', { message: 'BAD_PAYLOAD' });
        return;
      }
      const room = ctx.rooms.createRoom(parsed.data.name);
      room.seats[0]!.connected = true;
      room.seats[0]!.socketId = socket.id;
      socket.join(room.code);
      joinedRoom = room.code;
      joinedSeat = 0;
      socket.emit('room:created', {
        roomCode: room.code,
        seatIndex: 0,
        reconnectToken: room.seats[0]!.reconnectToken,
      });
      socket.emit('room:state', roomStatePayload(room));
    });

    socket.on('room:join', (raw: unknown) => {
      const parsed = joinPayloadSchema.safeParse(raw);
      if (!parsed.success) {
        socket.emit('error', { message: 'BAD_PAYLOAD' });
        return;
      }
      const { code, name, token } = parsed.data;
      let room: Room | undefined;
      let seatIndex: number | undefined;
      let reconnectToken: string | undefined;

      if (token !== undefined || (room === undefined && name !== undefined && ctx.rooms.getRoom(code)?.game !== null)) {
        const res = ctx.rooms.reattachSeat(code, token, name);
        if ('error' in res) {
          socket.emit('error', { message: res.error });
          return;
        }
        room = res.room;
        seatIndex = res.seat.seatIndex;
        reconnectToken = res.seat.reconnectToken;
        res.seat.connected = true;
        res.seat.socketId = socket.id;
        res.seat.disconnectedAt = null;
      } else {
        const res = ctx.rooms.joinRoom(code, name!);
        if ('error' in res) {
          socket.emit('error', { message: res.error });
          return;
        }
        room = res.room;
        seatIndex = res.seat.seatIndex;
        reconnectToken = res.seat.reconnectToken;
        res.seat.connected = true;
        res.seat.socketId = socket.id;
      }

      joinedRoom = room.code;
      joinedSeat = seatIndex;
      socket.join(room.code);
      socket.emit('room:joined', { roomCode: room.code, seatIndex, reconnectToken });
      broadcastRoom(ctx, room);
      if (room.game !== null) {
        socket.emit('game:state', sanitize(room.game.state, seatIndex));
        armTimer(ctx, room);
      }
    });

    socket.on('room:leave', () => {
      if (joinedRoom === null || joinedSeat === null) return;
      const room = ctx.rooms.getRoom(joinedRoom);
      if (room === undefined) return;
      ctx.rooms.leaveRoom(joinedRoom, joinedSeat);
      socket.leave(room.code);
      joinedRoom = null;
      joinedSeat = null;
      broadcastRoom(ctx, room);
    });

    socket.on('room:setReady', (raw: unknown) => {
      const parsed = setReadySchema.safeParse(raw);
      if (!parsed.success || joinedRoom === null || joinedSeat === null) return;
      const room = ctx.rooms.getRoom(joinedRoom);
      if (room === undefined) return;
      const seat = room.seats[joinedSeat];
      if (seat === undefined) return;
      seat.ready = parsed.data.ready;
      broadcastRoom(ctx, room);
    });

    socket.on('room:pickColor', (raw: unknown) => {
      const parsed = pickColorSchema.safeParse(raw);
      if (!parsed.success || joinedRoom === null || joinedSeat === null) return;
      const room = ctx.rooms.getRoom(joinedRoom);
      if (room === undefined) return;
      const res = ctx.rooms.pickColor(joinedRoom, joinedSeat, parsed.data.color as PlayerColor);
      if ('error' in res) {
        socket.emit('error', { message: res.error });
        return;
      }
      broadcastRoom(ctx, room);
    });

    socket.on('room:updateSettings', (raw: unknown) => {
      const parsed = settingsSchema.safeParse(raw);
      if (!parsed.success || joinedRoom === null || joinedSeat === null) return;
      const room = ctx.rooms.getRoom(joinedRoom);
      if (room === undefined) return;
      const res = ctx.rooms.updateSettings(joinedRoom, joinedSeat, parsed.data);
      if ('error' in res) {
        socket.emit('error', { message: res.error });
        return;
      }
      broadcastRoom(ctx, room);
    });

    socket.on('room:regenerateBoard', () => {
      if (joinedRoom === null || joinedSeat === null) return;
      const room = ctx.rooms.getRoom(joinedRoom);
      if (room === undefined) return;
      const res = ctx.rooms.regenerateBoard(joinedRoom, joinedSeat);
      if ('error' in res) {
        socket.emit('error', { message: res.error });
        return;
      }
      broadcastRoom(ctx, room);
    });

    socket.on('room:boardPreview', () => {
      if (joinedRoom === null) return;
      const room = ctx.rooms.getRoom(joinedRoom);
      if (room === undefined) return;
      socket.emit('room:boardPreview', generateBoard(room.settings.maxPlayers as PlayerCount, room.seed));
    });

    socket.on('room:start', () => {
      if (joinedRoom === null || joinedSeat === null) return;
      const room = ctx.rooms.getRoom(joinedRoom);
      if (room === undefined) return;
      const res = ctx.rooms.startGame(joinedRoom, joinedSeat);
      if ('error' in res) {
        socket.emit('error', { message: res.error });
        return;
      }
      const { room: started } = res;
      const startedEvent = started.game!.events[0]!;
      ctx.log.append(started.code, startedEvent);
      ctx.io.to(started.code).emit('game:event', startedEvent);
      ctx.io.to(started.code).emit('room:started', { roomCode: started.code });
      broadcastGame(ctx, started);
      armTimer(ctx, started);
      triggerBotTurnIfNeeded(ctx, started);
    });

    socket.on('room:addBot', () => {
      if (joinedRoom === null || joinedSeat === null) return;
      const room = ctx.rooms.getRoom(joinedRoom);
      if (room === undefined) return;
      const res = ctx.rooms.addBot(joinedRoom, joinedSeat);
      if ('error' in res) {
        socket.emit('error', { message: res.error });
        return;
      }
      broadcastRoom(ctx, room);
    });

    socket.on('room:removeBot', (raw: unknown) => {
      const parsed = z.object({ seatIndex: z.number().int().nonnegative() }).safeParse(raw);
      if (!parsed.success || joinedRoom === null || joinedSeat === null) return;
      const room = ctx.rooms.getRoom(joinedRoom);
      if (room === undefined) return;
      const res = ctx.rooms.removeBot(joinedRoom, joinedSeat, parsed.data.seatIndex);
      if ('error' in res) {
        socket.emit('error', { message: res.error });
        return;
      }
      broadcastRoom(ctx, room);
    });

    socket.on('game:action', (raw: unknown) => {
      const parsed = gameActionSchema.safeParse(raw);
      if (!parsed.success) {
        socket.emit('error', { message: 'BAD_ACTION' });
        return;
      }
      if (joinedRoom === null || joinedSeat === null) {
        socket.emit('error', { message: 'NOT_IN_ROOM' });
        return;
      }
      const room = ctx.rooms.getRoom(joinedRoom);
      if (room === undefined) {
        socket.emit('error', { message: 'ROOM_NOT_FOUND' });
        return;
      }
      handleGameAction(ctx, socket, room, joinedSeat, parsed.data);
    });

    socket.on('game:requestState', () => {
      if (joinedRoom === null || joinedSeat === null) return;
      const room = ctx.rooms.getRoom(joinedRoom);
      if (room?.game === null || room === undefined || room.game === null) return;
      socket.emit('game:state', sanitize(room.game.state, joinedSeat));
    });

    socket.on('disconnect', () => {
      if (joinedRoom === null || joinedSeat === null) return;
      const room = ctx.rooms.getRoom(joinedRoom);
      if (room === undefined) return;
      const seat = room.seats.find((s) => s.seatIndex === joinedSeat);
      if (seat !== undefined && seat.socketId === socket.id) {
        seat.connected = false;
        seat.socketId = null;
        seat.disconnectedAt = Date.now();
        broadcastRoom(ctx, room);
        if (room.game !== null) {
          broadcastGame(ctx, room);
        }
      }
    });
  });
}
