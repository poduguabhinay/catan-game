// Server entrypoint: Express + Socket.io + room manager + JSONL log + sweeper.
// In production it also serves the built client (client/dist) so the whole
// game deploys as one Node service with one URL.

import express from 'express';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { GameLog } from './jsonl';
import { RoomManager } from './rooms';
import { registerSocketHandlers, type ServerContext } from './sockets';

const app = express();
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Built client: CLIENT_DIST overrides the monorepo default. Absent in dev
// (Vite serves the client and proxies /socket.io here).
const clientDist = resolve(process.env.CLIENT_DIST ?? join(dirname(fileURLToPath(import.meta.url)), '../../client/dist'));
if (existsSync(join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
  app.get('/{*path}', (_req, res) => {
    res.sendFile(join(clientDist, 'index.html'));
  });
}

// Same-origin when the client is served from here; set CORS_ORIGIN
// (comma-separated) when the client is hosted elsewhere, e.g. on Vercel.
const corsOrigin = process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()).filter(Boolean);

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: corsOrigin && corsOrigin.length > 0 ? corsOrigin : '*' },
});

const rooms = new RoomManager();
const log = new GameLog(join(process.cwd(), 'data', 'games'));

const ctx: ServerContext = {
  io,
  rooms,
  log,
  timers: new Map(),
  timerDeadlines: new Map(),
};

async function main(): Promise<void> {
  await log.init();
  registerSocketHandlers(ctx);

  // Idle sweeper: drop lobbies idle >30min and finished games >30min.
  setInterval(() => rooms.sweep(), 60_000).unref();

  const port = Number(process.env.PORT ?? 3001);
  httpServer.listen(port, () => {
    console.log(`catan-server listening on :${port}`);
  });
}

void main();

export { app, httpServer, io, ctx };
