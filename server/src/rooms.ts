// Room manager: in-memory rooms, seats, reconnect tokens, game lifecycle.
// Server-authoritative: all mutations flow through this module.

import { customAlphabet } from 'nanoid';
import {
  boardConfigForPlayers,
  DEFAULT_RULES,
  PLAYER_COLORS,
  type BoardConfigKey,
  type PlayerColor,
  type PlayerCount,
} from '@catan/shared';
import { createGame, type GameState } from '@catan/shared';
import type { GameEvent } from '@catan/shared';
import type { Rng } from '@catan/shared';
import { createRng } from '@catan/shared';
import { BOT_NAMES } from './bot';

const codeAlphabet = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 4);
const tokenAlphabet = customAlphabet('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 21);

export interface RoomSettings {
  maxPlayers: number;
  turnTimerSec: number; // 0 = off
  diceMode: 'random' | 'balanced';
  /** VP needed to win (3..20). */
  victoryPointsToWin: number;
  /** On a 7, seats holding more than this many cards discard half (5..20). */
  discardLimit: number;
}

export const DEFAULT_SETTINGS: RoomSettings = {
  maxPlayers: 4,
  turnTimerSec: 120,
  diceMode: 'random',
  victoryPointsToWin: DEFAULT_RULES.victoryPointsToWin,
  discardLimit: DEFAULT_RULES.discardLimit,
};

export const SETTINGS_LIMITS = {
  maxPlayers: { min: 3, max: 8 },
  victoryPointsToWin: { min: 3, max: 20 },
  discardLimit: { min: 5, max: 20 },
} as const;

function inRange(n: number, lim: { min: number; max: number }): boolean {
  return Number.isInteger(n) && n >= lim.min && n <= lim.max;
}

export interface Seat {
  seatIndex: number;
  name: string;
  color: PlayerColor | null;
  ready: boolean;
  socketId: string | null;
  reconnectToken: string;
  connected: boolean;
  disconnectedAt: number | null;
  isBot?: boolean;
}

export interface StoredGame {
  state: GameState;
  seed: string;
  events: GameEvent[];
}

export interface Room {
  code: string;
  hostSeatIndex: number;
  seats: Seat[];
  settings: RoomSettings;
  game: StoredGame | null;
  seed: string;
  createdAt: number;
  lastActivity: number;
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  createRoom(hostName: string): Room {
    let code = codeAlphabet();
    while (this.rooms.has(code)) code = codeAlphabet();
    const room: Room = {
      code,
      hostSeatIndex: 0,
      seats: [this.makeSeat(0, hostName)],
      settings: { ...DEFAULT_SETTINGS },
      game: null,
      seed: codeAlphabet() + codeAlphabet(),
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };
    this.rooms.set(code, room);
    return room;
  }

  private makeSeat(seatIndex: number, name: string, isBot = false): Seat {
    return {
      seatIndex,
      name,
      color: null,
      ready: isBot,
      socketId: null,
      reconnectToken: tokenAlphabet(),
      connected: isBot,
      disconnectedAt: null,
      isBot,
    };
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  joinRoom(code: string, name: string): { room: Room; seat: Seat } | { error: string } {
    const room = this.getRoom(code);
    if (room === undefined) return { error: 'ROOM_NOT_FOUND' };
    if (room.game !== null) return { error: 'GAME_ALREADY_STARTED' };
    if (room.seats.length >= room.settings.maxPlayers) return { error: 'ROOM_FULL' };
    const nameTaken = room.seats.some((s) => s.name.toLowerCase() === name.toLowerCase());
    if (nameTaken) return { error: 'NAME_TAKEN' };
    room.lastActivity = Date.now();
    const seat = this.makeSeat(room.seats.length, name);
    room.seats.push(seat);
    return { room, seat };
  }

  addBot(code: string, hostSeatIndex: number): { ok: true; seat: Seat } | { error: string } {
    const room = this.getRoom(code);
    if (room === undefined) return { error: 'ROOM_NOT_FOUND' };
    if (room.game !== null) return { error: 'GAME_ALREADY_STARTED' };
    if (room.hostSeatIndex !== hostSeatIndex) return { error: 'NOT_HOST' };
    if (room.seats.length >= room.settings.maxPlayers) return { error: 'ROOM_FULL' };

    const availableColors = RoomManager.availableColors(room);
    if (availableColors.length === 0) return { error: 'NO_COLORS_AVAILABLE' };

    const takenNames = new Set(room.seats.map((s) => s.name));
    const name = BOT_NAMES.find((n) => !takenNames.has(n)) ?? `Bot ${room.seats.length + 1}`;

    const seat = this.makeSeat(room.seats.length, name, true);
    seat.color = availableColors[0]!;
    seat.ready = true;
    room.seats.push(seat);
    room.lastActivity = Date.now();
    return { ok: true, seat };
  }

  removeBot(code: string, hostSeatIndex: number, seatIndex: number): { ok: true } | { error: string } {
    const room = this.getRoom(code);
    if (room === undefined) return { error: 'ROOM_NOT_FOUND' };
    if (room.game !== null) return { error: 'GAME_ALREADY_STARTED' };
    if (room.hostSeatIndex !== hostSeatIndex) return { error: 'NOT_HOST' };
    const seat = room.seats[seatIndex];
    if (seat === undefined || !seat.isBot) return { error: 'NOT_A_BOT' };

    room.seats = room.seats.filter((s) => s.seatIndex !== seatIndex);
    room.seats.forEach((s, i) => {
      s.seatIndex = i;
    });
    room.lastActivity = Date.now();
    return { ok: true };
  }
  /** Reattach a seat by token (or matching name) — works mid-game. */
  reattachSeat(
    code: string,
    token: string | undefined,
    name: string | undefined,
  ): { room: Room; seat: Seat } | { error: string } {
    const room = this.getRoom(code);
    if (room === undefined) return { error: 'ROOM_NOT_FOUND' };
    let seat: Seat | undefined;
    if (token !== undefined) {
      seat = room.seats.find((s) => s.reconnectToken === token);
    }
    if (seat === undefined && name !== undefined) {
      seat = room.seats.find((s) => s.name.toLowerCase() === name.toLowerCase());
    }
    if (seat === undefined) return { error: 'NO_SUCH_SEAT' };
    room.lastActivity = Date.now();
    return { room, seat };
  }

  leaveRoom(code: string, seatIndex: number): void {
    const room = this.getRoom(code);
    if (room === undefined) return;
    room.lastActivity = Date.now();
    if (room.game !== null) {
      // In-game: keep the seat, mark disconnected.
      const seat = room.seats[seatIndex]!;
      seat.connected = false;
      seat.socketId = null;
      seat.disconnectedAt = Date.now();
      return;
    }
    // Lobby: remove seat immediately (60s grace deferred to caller/sweeper).
    room.seats = room.seats.filter((s) => s.seatIndex !== seatIndex);
    room.seats.forEach((s, i) => {
      s.seatIndex = i;
    });
    if (room.seats.length === 0 || room.seats.every((s) => s.isBot)) {
      this.rooms.delete(room.code);
    } else if (room.hostSeatIndex === seatIndex) {
      const nextHuman = room.seats.find((s) => !s.isBot);
      room.hostSeatIndex = nextHuman !== undefined ? nextHuman.seatIndex : room.seats[0]!.seatIndex;
    }
  }

  pickColor(code: string, seatIndex: number, color: PlayerColor): { ok: true } | { error: string } {
    const room = this.getRoom(code);
    if (room === undefined) return { error: 'ROOM_NOT_FOUND' };
    if (room.game !== null) return { error: 'GAME_ALREADY_STARTED' };
    const taken = room.seats.some((s) => s.color === color && s.seatIndex !== seatIndex);
    if (taken) return { error: 'COLOR_TAKEN' };
    const seat = room.seats[seatIndex];
    if (seat === undefined) return { error: 'NO_SUCH_SEAT' };
    seat.color = color;
    room.lastActivity = Date.now();
    return { ok: true };
  }

  updateSettings(
    code: string,
    seatIndex: number,
    patch: Partial<RoomSettings>,
  ): { ok: true } | { error: string } {
    const room = this.getRoom(code);
    if (room === undefined) return { error: 'ROOM_NOT_FOUND' };
    if (room.hostSeatIndex !== seatIndex) return { error: 'NOT_HOST' };
    if (room.game !== null) return { error: 'GAME_ALREADY_STARTED' };
    // Validate the whole patch before applying any field (all-or-nothing).
    if (patch.maxPlayers !== undefined) {
      if (!inRange(patch.maxPlayers, SETTINGS_LIMITS.maxPlayers)) return { error: 'BAD_MAX_PLAYERS' };
      if (patch.maxPlayers < room.seats.length) return { error: 'MAX_BELOW_SEATS' };
    }
    if (
      patch.victoryPointsToWin !== undefined &&
      !inRange(patch.victoryPointsToWin, SETTINGS_LIMITS.victoryPointsToWin)
    ) {
      return { error: 'BAD_VICTORY_POINTS' };
    }
    if (patch.discardLimit !== undefined && !inRange(patch.discardLimit, SETTINGS_LIMITS.discardLimit)) {
      return { error: 'BAD_DISCARD_LIMIT' };
    }
    if (patch.maxPlayers !== undefined) room.settings.maxPlayers = patch.maxPlayers;
    if (patch.turnTimerSec !== undefined) room.settings.turnTimerSec = patch.turnTimerSec;
    if (patch.diceMode !== undefined) room.settings.diceMode = patch.diceMode;
    if (patch.victoryPointsToWin !== undefined) room.settings.victoryPointsToWin = patch.victoryPointsToWin;
    if (patch.discardLimit !== undefined) room.settings.discardLimit = patch.discardLimit;
    room.lastActivity = Date.now();
    return { ok: true };
  }

  regenerateBoard(code: string, seatIndex: number): { ok: true; seed: string } | { error: string } {
    const room = this.getRoom(code);
    if (room === undefined) return { error: 'ROOM_NOT_FOUND' };
    if (room.game !== null) return { error: 'GAME_ALREADY_STARTED' };
    if (room.hostSeatIndex !== seatIndex) return { error: 'NOT_HOST' };
    room.seed = codeAlphabet() + codeAlphabet();
    room.lastActivity = Date.now();
    return { ok: true, seed: room.seed };
  }

  startGame(code: string, seatIndex: number): { ok: true; room: Room } | { error: string } {
    const room = this.getRoom(code);
    if (room === undefined) return { error: 'ROOM_NOT_FOUND' };
    if (room.game !== null) return { error: 'GAME_ALREADY_STARTED' };
    if (room.hostSeatIndex !== seatIndex) return { error: 'NOT_HOST' };
    if (room.seats.length < 3) return { error: 'NEED_THREE_PLAYERS' };
    if (!room.seats.every((s) => s.ready)) return { error: 'NOT_ALL_READY' };
    if (!room.seats.every((s) => s.color !== null)) return { error: 'MISSING_COLORS' };

    const playerCount = room.seats.length as PlayerCount;
    const players = room.seats.map((s) => ({
      seat: s.seatIndex,
      name: s.name,
      color: s.color!,
    }));
    const state = createGame({
      playerCount,
      players,
      seed: room.seed,
      rules: {
        victoryPointsToWin: room.settings.victoryPointsToWin,
        discardLimit: room.settings.discardLimit,
      },
    });
    room.game = { state, seed: room.seed, events: [{ type: 'gameStarted', playerCount, seed: room.seed }] };
    room.lastActivity = Date.now();
    return { ok: true, room };
  }

  /** Room game RNG — deterministic per room+action count. */
  gameRng(room: Room): Rng {
    const seq = room.game?.events.length ?? 0;
    return createRng(`${room.code}:${room.seed}:g${seq}`);
  }

  /** Idle-room sweeper: drop lobbies idle >30min and finished games >30min. */
  sweep(now: number = Date.now()): void {
    for (const [code, room] of this.rooms) {
      const idle = now - room.lastActivity;
      if (idle > 30 * 60 * 1000) {
        if (room.game === null || room.game.state.phase === 'finished') {
          this.rooms.delete(code);
        }
      }
    }
  }

  allRooms(): Room[] {
    return [...this.rooms.values()];
  }

  /** Available colors given current seats (used by lobby UI). */
  static availableColors(room: Room): PlayerColor[] {
    const taken = new Set(room.seats.map((s) => s.color).filter((c): c is PlayerColor => c !== null));
    return PLAYER_COLORS.filter((c) => !taken.has(c));
  }

  /** Config sanity: seat count must fit board config (3-4 base, 5-6 ext56, 7-8 ext78). */
  static configForCount(playerCount: number): BoardConfigKey {
    return boardConfigForPlayers(playerCount).key;
  }
}

export function boardPreviewConfig(playerCount: number): BoardConfigKey {
  return boardConfigForPlayers(playerCount).key;
}
