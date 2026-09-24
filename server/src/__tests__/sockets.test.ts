// Socket integration tests: real HTTP server + socket.io-client, ephemeral
// port (official socket.io testing pattern). All waits await emitted events,
// never wall-clock sleeps. socket.io-client is imported statically — the
// client module is a devDep of this exact package.

import { createServer, type Server as HttpServer } from 'node:http';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Server } from 'socket.io';
import { io as clientIo, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GameLog } from '../jsonl';
import { RoomManager } from '../rooms';
import { registerSocketHandlers, type ServerContext } from '../sockets';
import type { PersonalSnapshot } from '../sanitize';

interface Harness {
  io: Server;
  http: HttpServer;
  ctx: ServerContext;
  url: string;
}

let harness: Harness | null = null;

async function startServer(dataDir: string): Promise<Harness> {
  const http = createServer();
  const io = new Server(http, { cors: { origin: '*' } });
  const rooms = new RoomManager();
  const log = new GameLog(dataDir);
  await log.init();
  const ctx: ServerContext = { io, rooms, log, timers: new Map(), timerDeadlines: new Map() };
  registerSocketHandlers(ctx);
  const { promise, resolve } = Promise.withResolvers<void>();
  http.listen(0, () => resolve());
  await promise;
  const address = http.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return { io, http, ctx, url: `http://localhost:${port}` };
}

function makeClient(h: Harness): ClientSocket {
  return clientIo(h.url, { transports: ['websocket'] });
}

function waitFor<T>(socket: ClientSocket, event: string): Promise<T> {
  const { promise, resolve } = Promise.withResolvers<T>();
  socket.once(event, (payload: T) => resolve(payload));
  return promise;
}

/** Await the next game:state broadcast on a socket. */
function nextGameState(socket: ClientSocket): Promise<PersonalSnapshot> {
  return waitFor<PersonalSnapshot>(socket, 'game:state');
}

const TMP_DIR = join(process.cwd(), 'src', '__tests__', 'tmp-data');

beforeAll(async () => {
  await rm(TMP_DIR, { recursive: true, force: true });
  harness = await startServer(TMP_DIR);
});

afterAll(async () => {
  const h = harness;
  if (h !== null) {
    const { promise, resolve } = Promise.withResolvers<void>();
    h.http.close(() => resolve());
    await promise;
    h.io.close();
  }
  await rm(TMP_DIR, { recursive: true, force: true });
});

interface ClientInfo {
  socket: ClientSocket;
  code: string;
  seatIndex: number;
  token: string;
}

interface CreatedPayload {
  roomCode: string;
  seatIndex: number;
  reconnectToken: string;
}

async function createRoom(h: Harness, name: string): Promise<ClientInfo> {
  const socket = makeClient(h);
  const created = await new Promise<CreatedPayload>((resolve) => {
    socket.once('room:created', (p) => resolve(p));
    socket.emit('room:create', { name });
  });
  return { socket, code: created.roomCode, seatIndex: created.seatIndex, token: created.reconnectToken };
}

async function joinRoom(h: Harness, code: string, name: string): Promise<ClientInfo> {
  const socket = makeClient(h);
  const joined = await new Promise<CreatedPayload>((resolve) => {
    socket.once('room:joined', (p) => resolve(p));
    socket.emit('room:join', { code, name });
  });
  return { socket, code, seatIndex: joined.seatIndex, token: joined.reconnectToken };
}

async function createAndJoin(h: Harness, names: string[]): Promise<{ host: ClientInfo; guests: ClientInfo[]; code: string }> {
  const host = await createRoom(h, names[0]!);
  const guests: ClientInfo[] = [];
  for (let i = 1; i < names.length; i++) {
    guests.push(await joinRoom(h, host.code, names[i]!));
  }
  return { host, guests, code: host.code };
}

interface RoomStatePayload {
  roomCode: string;
  host: number;
  players: Array<{ seatIndex: number; name: string; color: string | null; ready: boolean; connected: boolean; isBot?: boolean }>;
  settings: {
    maxPlayers: number;
    turnTimerSec: number;
    diceMode: string;
    victoryPointsToWin: number;
    discardLimit: number;
  };
  seed: string;
  started: boolean;
}

function nextRoomState(socket: ClientSocket): Promise<RoomStatePayload> {
  return waitFor<RoomStatePayload>(socket, 'room:state');
}

/** Wait until the room state on this socket satisfies `cond` (skips stale). */
function waitRoomStateWhere(
  socket: ClientSocket,
  cond: (state: RoomStatePayload) => boolean,
): Promise<RoomStatePayload> {
  const { promise, resolve } = Promise.withResolvers<RoomStatePayload>();
  const listener = (state: RoomStatePayload): void => {
    if (cond(state)) {
      socket.off('room:state', listener);
      resolve(state);
    }
  };
  socket.on('room:state', listener);
  return promise;
}

async function pickColors(players: ClientInfo[]): Promise<void> {
  const colors = ['red', 'blue', 'orange', 'white', 'green', 'brown'];
  for (let i = 0; i < players.length; i++) {
    const p = players[i]!;
    const stateP = waitRoomStateWhere(p.socket, (st) =>
      st.players[p.seatIndex]!.color === colors[i],
    );
    p.socket.emit('room:pickColor', { color: colors[i] });
    await stateP;
  }
}

async function readyAll(players: ClientInfo[]): Promise<void> {
  for (const p of players) {
    const stateP = waitRoomStateWhere(p.socket, (st) => st.players[p.seatIndex]!.ready);
    p.socket.emit('room:setReady', { ready: true });
    await stateP;
  }
}

async function startGame(host: ClientInfo, players: ClientInfo[]): Promise<void> {
  const startedP = waitFor<{ roomCode: string }>(host.socket, 'room:started');
  host.socket.emit('room:start');
  await startedP;
  await Promise.all(players.map((p) => requestState(p.socket)));
}

async function requestState(socket: ClientSocket): Promise<PersonalSnapshot> {
  const p = nextGameState(socket);
  socket.emit('game:requestState');
  return p;
}

describe('room lifecycle', () => {
  it('creates a room with a 4-char code and returns a token', async () => {
    const h = harness!;
    const c = await createRoom(h, 'Alice');
    expect(c.code).toMatch(/^[A-Z2-9]{4}$/);
    expect(c.token.length).toBeGreaterThanOrEqual(10);
    c.socket.disconnect();
  });

  it('rejects duplicate names case-insensitively', async () => {
    const h = harness!;
    const { host, guests } = await createAndJoin(h, ['Dup', 'Other']);
    const errP = waitFor<{ message: string }>(guests[0]!.socket, 'error');
    guests[0]!.socket.emit('room:join', { code: host.code, name: 'DUP' });
    const err = await errP;
    expect(err.message).toBe('NAME_TAKEN');
    host.socket.disconnect();
    for (const g of guests) g.socket.disconnect();
  });

  it('start requires all ready + colors; then game begins', async () => {
    const h = harness!;
    console.error('S1');
    const { host, guests } = await createAndJoin(h, ['Cara', 'Dan', 'Eve']);
    console.error('S2');
    const errP = waitFor<{ message: string }>(host.socket, 'error');
    host.socket.emit('room:start');
    expect((await errP).message).toBe('NOT_ALL_READY');
    console.error('S3');

    const players = [host, ...guests];
    await pickColors(players);
    await readyAll(players);
    await startGame(host, players);
    const snap = await requestState(host.socket);
    expect(snap.phase).toBe('setupForward');
    for (const p of players) p.socket.disconnect();
  });
});

describe('full 3-player scripted game', () => {
  it(
    'plays setup, turns, robber, and writes the JSONL log',
    { timeout: 30000 },
    async () => {
      const h = harness!;
      const { host, guests, code } = await createAndJoin(h, ['Alice', 'Bob', 'Carol']);
      const players = [host, ...guests];
      await pickColors(players);
      await readyAll(players);
      await startGame(host, players);

      // Authoritative snapshot cache: every socket records its latest push.
      const latest = new Map<ClientSocket, PersonalSnapshot>();
      const seed = await Promise.all(players.map((p) => requestState(p.socket)));
      players.forEach((p, i) => latest.set(p.socket, seed[i]!));
      for (const p of players) {
        p.socket.on('game:state', (snap: PersonalSnapshot) => latest.set(p.socket, snap));
      }
      const view = (): PersonalSnapshot => latest.get(host.socket)!;

      /** Emit an action from `actor` and wait until the HOST view advanced. */
      const send = async (actor: ClientInfo, action: unknown): Promise<void> => {
        const before = view().version;
        const { promise, resolve } = Promise.withResolvers<void>();
        const listener = (snap: PersonalSnapshot): void => {
          if (snap.version > before) {
            host.socket.off('game:state', listener);
            resolve();
          }
        };
        host.socket.on('game:state', listener);
        actor.socket.emit('game:action', action);
        await promise;
      };

      // --- Setup draft: 6 placements, one per active seat. ---
      for (let i = 0; i < 6; i++) {
        const actor = players[view().activeSeat]!;
        const mine = await requestState(actor.socket);
        const topo = mine.board.topology;
        const vertex = topo.vertices.find(
          (v) =>
            mine.buildings[v] === undefined &&
            (topo.adjacentVertices[v] ?? []).every((n) => mine.buildings[n] === undefined),
        );
        expect(vertex).toBeDefined();
        const edge = (topo.vertexEdges[vertex!] ?? []).find((e) => mine.roads[e] === undefined);
        expect(edge).toBeDefined();
        await send(actor, {
          type: 'setupPlace',
          settlementVertex: vertex,
          roadEdge: edge,
        });
      }
      expect(view().phase).toBe('turnPreroll');
      expect(view().turn).toBe(1);

      // --- Play 3 full turns: roll, resolve robber/discard, end. ---
      for (let t = 0; t < 3; t++) {
        await send(players[view().activeSeat]!, { type: 'rollDice' });

        let guard = 0;
        while (view().phase !== 'turnMain' && guard++ < 12) {
          const s2 = view();
          if (s2.phase === 'discard') {
            const pending = s2.pendingDiscards.find((d) => !d.received);
            expect(pending).toBeDefined();
            if (pending === undefined) break;
            const discarder = players[pending.seat]!;
            const mine = await requestState(discarder.socket);
            const res: Record<string, number> = {};
            let left = pending.count;
            for (const r of ['wood', 'brick', 'sheep', 'wheat', 'ore'] as const) {
              const have = mine.you.resources[r] ?? 0;
              const take = Math.min(have, left);
              if (take > 0) {
                res[r] = take;
                left -= take;
              }
            }
            await send(discarder, { type: 'discard', resources: res });
          } else if (s2.phase === 'robberMove') {
            const hex = s2.board.topology.hexes.find((hx) => hx !== s2.robber)!;
            await send(players[s2.activeSeat]!, { type: 'moveRobber', hex });
          } else if (s2.phase === 'robberSteal') {
            await send(players[s2.activeSeat]!, {
              type: 'chooseSteal',
              victimSeat: (s2.activeSeat + 1) % 3,
            });
          } else {
            break;
          }
        }

        await send(players[view().activeSeat]!, { type: 'endTurn' });
      }

      // --- JSONL log: written, sequential, starts with gameStarted. ---
      const logPath = join(TMP_DIR, `${code}.jsonl`);
      const content = await readFile(logPath, 'utf8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBeGreaterThan(15);
      const firstLine = JSON.parse(lines[0]!) as { type: string };
      expect(firstLine.type).toBe('gameStarted');

      for (const p of players) p.socket.disconnect();
    },
  );
});

describe('reconnect', () => {
  it(
    'disconnect marks seat; token rejoin restores the same seat',
    { timeout: 20000 },
    async () => {
      const h = harness!;
      const { host, guests, code } = await createAndJoin(h, ['ReA', 'ReB', 'ReC']);
      const players = [host, ...guests];
      await pickColors(players);
      await readyAll(players);
      await startGame(host, players);

      const bob = guests[0]!;
      bob.socket.disconnect();

      // Alice re-emits room state via her own rejoin → sees Bob disconnected.
      const stateP = nextRoomState(host.socket);
      host.socket.emit('room:join', { code, name: 'ReA', token: host.token });
      const roomState = await stateP;
      expect(roomState.players[1]!.connected).toBe(false);

      // Bob rejoins with his token: same seat, full hand resync.
      const bob2 = makeClient(h);
      const joinedP = waitFor<CreatedPayload>(bob2, 'room:joined');
      bob2.emit('room:join', { code, token: bob.token });
      const joined = await joinedP;
      expect(joined.seatIndex).toBe(bob.seatIndex);
      const snap = await requestState(bob2);
      expect(snap.you.seat).toBe(bob.seatIndex);

      for (const p of players) p.socket.disconnect();
      bob2.disconnect();
    },
  );
});

describe('anti-trust', () => {
  it(
    'rejects out-of-turn actions with no state change',
    { timeout: 20000 },
    async () => {
      const h = harness!;
      const { host, guests } = await createAndJoin(h, ['SecA', 'SecB', 'SecC']);
      const players = [host, ...guests];
      await pickColors(players);
      await readyAll(players);
      await startGame(host, players);

      // Seat 1 attempts to place during seat 0's setup window.
      const errP = waitFor<{ message: string }>(guests[0]!.socket, 'error');
      guests[0]!.socket.emit('game:action', {
        type: 'setupPlace',
        settlementVertex: 3,
        roadEdge: '3-4',
      });
      const err = await errP;
      expect(err.message).toBe('NOT_YOUR_ACTION');

      const versionSnap = await requestState(host.socket);
      expect(versionSnap.version).toBe(1); // unchanged

      for (const p of players) p.socket.disconnect();
    },
  );
});

describe('sanitizer', () => {
  it(
    'snapshots expose counts, not other hands',
    { timeout: 20000 },
    async () => {
      const h = harness!;
      const { host, guests } = await createAndJoin(h, ['SnA', 'SnB', 'SnC']);
      const players = [host, ...guests];
      await pickColors(players);
      await readyAll(players);
      await startGame(host, players);

      const snap = await requestState(host.socket);
      // Public players expose counts only; own seat keeps the full hand.
      for (const p of snap.players) {
        const publicPlayer = JSON.stringify(p);
        expect(publicPlayer).not.toContain('devHand');
        expect(publicPlayer).not.toContain('"resources"');
      }
      expect(snap.you.seat).toBe(0);
      expect(snap.you.resources).toBeDefined();
      expect(snap.you.devHand).toBeDefined();

      for (const p of players) p.socket.disconnect();
    },
  );
});

describe('bot players & lifecycle', () => {
  it(
    'adds bots, starts game with bots, and bots take turns automatically',
    { timeout: 25000 },
    async () => {
      const h = harness!;
      const host = await createRoom(h, 'SoloHost');

      // Add bot 1
      const s1Promise = waitFor<RoomStatePayload>(host.socket, 'room:state');
      host.socket.emit('room:addBot');
      const s1 = await s1Promise;
      expect(s1.players).toHaveLength(2);
      expect(s1.players[1]!.isBot).toBe(true);
      expect(s1.players[1]!.ready).toBe(true);
      expect(s1.players[1]!.color).not.toBeNull();

      // Add bot 2
      const s2Promise = waitFor<RoomStatePayload>(host.socket, 'room:state');
      host.socket.emit('room:addBot');
      const s2 = await s2Promise;
      expect(s2.players).toHaveLength(3);
      expect(s2.players[2]!.isBot).toBe(true);

      // Host picks remaining color and readies
      const available = ['red', 'blue', 'orange', 'white'].find(
        (c) => c !== s2.players[1]!.color && c !== s2.players[2]!.color,
      )!;
      const cPromise = waitFor<RoomStatePayload>(host.socket, 'room:state');
      host.socket.emit('room:pickColor', { color: available });
      await cPromise;

      const rPromise = waitFor<RoomStatePayload>(host.socket, 'room:state');
      host.socket.emit('room:setReady', { ready: true });
      await rPromise;

      // Start game
      const startPromise = waitFor<{ roomCode: string }>(host.socket, 'room:started');
      const initialSnapPromise = nextGameState(host.socket);
      host.socket.emit('room:start');
      await startPromise;
      const initialSnap = await initialSnapPromise;

      expect(initialSnap.phase).toBe('setupForward');
      expect(initialSnap.activeSeat).toBe(0);

      // Host places first settlement and road
      const vertex = Object.keys(initialSnap.board.topology.vertexPos).map(Number)[0]!;
      const edge = initialSnap.board.topology.vertexEdges[vertex]![0]!;

      const afterHostSnapPromise = nextGameState(host.socket);
      host.socket.emit('game:action', {
        type: 'setupPlace',
        settlementVertex: vertex,
        roadEdge: edge,
      });
      const afterHostSnap = await afterHostSnapPromise;
      expect(afterHostSnap.buildings[vertex]).toBeDefined();

      // Now activeSeat is bot 1. Bot should take turn automatically!
      const bot1Snap = await nextGameState(host.socket);
      expect(Object.keys(bot1Snap.buildings).length).toBeGreaterThan(1);

      host.socket.disconnect();
    },
  );
});

describe('room settings: player count and rule variants', () => {
  it('RoomManager validates ranges all-or-nothing and seats up to 8 bots with distinct colours', () => {
    const rooms = new RoomManager();
    const room = rooms.createRoom('Host');
    expect(room.settings).toMatchObject({ maxPlayers: 4, victoryPointsToWin: 10, discardLimit: 7 });

    expect(rooms.updateSettings(room.code, 0, { maxPlayers: 9 })).toEqual({ error: 'BAD_MAX_PLAYERS' });
    expect(rooms.updateSettings(room.code, 0, { maxPlayers: 2 })).toEqual({ error: 'BAD_MAX_PLAYERS' });
    expect(rooms.updateSettings(room.code, 0, { victoryPointsToWin: 2 })).toEqual({ error: 'BAD_VICTORY_POINTS' });
    expect(rooms.updateSettings(room.code, 0, { victoryPointsToWin: 21 })).toEqual({ error: 'BAD_VICTORY_POINTS' });
    expect(rooms.updateSettings(room.code, 0, { discardLimit: 4 })).toEqual({ error: 'BAD_DISCARD_LIMIT' });
    expect(rooms.updateSettings(room.code, 0, { discardLimit: 21 })).toEqual({ error: 'BAD_DISCARD_LIMIT' });
    // A bad field rejects the whole patch.
    expect(rooms.updateSettings(room.code, 0, { maxPlayers: 8, discardLimit: 30 })).toEqual({ error: 'BAD_DISCARD_LIMIT' });
    expect(room.settings).toMatchObject({ maxPlayers: 4, victoryPointsToWin: 10, discardLimit: 7 });

    expect(rooms.updateSettings(room.code, 0, { maxPlayers: 8, victoryPointsToWin: 20, discardLimit: 5 })).toEqual({ ok: true });
    for (let i = 0; i < 7; i++) expect(rooms.addBot(room.code, 0)).toMatchObject({ ok: true });
    expect(rooms.addBot(room.code, 0)).toEqual({ error: 'ROOM_FULL' });
    const botColors = room.seats.slice(1).map((st) => st.color);
    expect(new Set(botColors).size).toBe(7);
    expect(RoomManager.availableColors(room)).toHaveLength(1);
    expect(rooms.updateSettings(room.code, 0, { maxPlayers: 7 })).toEqual({ error: 'MAX_BELOW_SEATS' });
  });

  it(
    'room:state exposes rule settings, drops out-of-range patches, and the game uses them',
    { timeout: 20000 },
    async () => {
      const h = harness!;
      const host = await createRoom(h, 'RulesHost');

      const setP = waitRoomStateWhere(host.socket, (st) => st.settings.maxPlayers === 8);
      host.socket.emit('room:updateSettings', { maxPlayers: 8, victoryPointsToWin: 6, discardLimit: 9 });
      const set = await setP;
      expect(set.settings).toMatchObject({ maxPlayers: 8, victoryPointsToWin: 6, discardLimit: 9 });

      // Out-of-range patches fail schema validation; a later valid patch
      // proves they were processed (in order) without effect.
      host.socket.emit('room:updateSettings', { victoryPointsToWin: 21 });
      host.socket.emit('room:updateSettings', { discardLimit: 4 });
      host.socket.emit('room:updateSettings', { maxPlayers: 9 });
      const afterP = waitRoomStateWhere(host.socket, (st) => st.settings.turnTimerSec === 60);
      host.socket.emit('room:updateSettings', { turnTimerSec: 60 });
      const after = await afterP;
      expect(after.settings).toMatchObject({ maxPlayers: 8, victoryPointsToWin: 6, discardLimit: 9 });

      for (let i = 0; i < 2; i++) {
        const botP = waitRoomStateWhere(host.socket, (st) => st.players.length === i + 2);
        host.socket.emit('room:addBot');
        await botP;
      }
      const colorP = waitRoomStateWhere(host.socket, (st) => st.players[0]!.color === 'pink');
      host.socket.emit('room:pickColor', { color: 'pink' });
      await colorP;
      const readyP = waitRoomStateWhere(host.socket, (st) => st.players[0]!.ready);
      host.socket.emit('room:setReady', { ready: true });
      await readyP;

      const snapP = nextGameState(host.socket);
      host.socket.emit('room:start');
      const snap = await snapP;
      expect(snap.rules).toEqual({ victoryPointsToWin: 6, discardLimit: 9 });
      expect(snap.config).toBe('base');

      host.socket.disconnect();
    },
  );

  it('room:boardPreview uses the ext78 board when maxPlayers is 7-8', { timeout: 10000 }, async () => {
    const h = harness!;
    const host = await createRoom(h, 'PreviewHost');
    const setP = waitRoomStateWhere(host.socket, (st) => st.settings.maxPlayers === 7);
    host.socket.emit('room:updateSettings', { maxPlayers: 7 });
    await setP;
    const previewP = waitFor<{ config: string; hexes: Record<string, unknown> }>(host.socket, 'room:boardPreview');
    host.socket.emit('room:boardPreview');
    const preview = await previewP;
    expect(preview.config).toBe('ext78');
    expect(Object.keys(preview.hexes)).toHaveLength(37);
    host.socket.disconnect();
  });
});
