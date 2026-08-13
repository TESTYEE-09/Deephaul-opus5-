import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '@shared/protocol.ts';
import { GameRoom, type Connection } from './room.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 5181);
const STATIC_DIR = process.env.DEEPHAUL_STATIC ? path.resolve(ROOT, process.env.DEEPHAUL_STATIC) : null;
const SAVE_DIR = path.resolve(ROOT, '.saves');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.svg': 'image/svg+xml',
};

const rooms = new Map<string, GameRoom>();

async function loadRoom(id: string): Promise<GameRoom> {
  const existing = rooms.get(id);
  if (existing) return existing;

  const room = new GameRoom(id);
  const savePath = path.join(SAVE_DIR, `${sanitiseRoom(id)}.json`);
  if (existsSync(savePath)) {
    try {
      room.restore(JSON.parse(await readFile(savePath, 'utf8')));
      console.log(`[deephaul] restored save for room "${id}"`);
    } catch (err) {
      console.warn(`[deephaul] could not restore "${id}":`, (err as Error).message);
    }
  }
  room.setSaveHook((r) => {
    void persist(r);
  });
  room.setOnEmpty(() => {
    void persist(room);
    room.stop();
    rooms.delete(id);
    console.log(`[deephaul] room "${id}" closed`);
  });
  rooms.set(id, room);
  console.log(`[deephaul] room "${id}" opened`);
  return room;
}

async function persist(room: GameRoom): Promise<void> {
  try {
    await mkdir(SAVE_DIR, { recursive: true });
    await writeFile(
      path.join(SAVE_DIR, `${sanitiseRoom(room.id)}.json`),
      JSON.stringify(room.serialise(), null, 1),
    );
  } catch (err) {
    console.warn('[deephaul] save failed:', (err as Error).message);
  }
}

function sanitiseRoom(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'default';
}

// --------------------------------------------------------------------- http

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, version: PROTOCOL_VERSION, rooms: rooms.size }));
    return;
  }

  if (url.pathname === '/api/rooms') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify(
        [...rooms.values()].map((r) => ({ id: r.id, players: r.playerCount, phase: r.phase, day: r.run.day })),
      ),
    );
    return;
  }

  if (!STATIC_DIR) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('deephaul server: run the vite dev server for the client');
    return;
  }

  // Assets are never copied into the bundle - they are hundreds of megabytes
  // of CC0 art that would make every build unbearable. Serve them in place.
  if (url.pathname.startsWith('/assets/') && !url.pathname.startsWith('/assets/index')) {
    const assetPath = path.join(ROOT, 'client', 'public', decodeURIComponent(url.pathname));
    if (assetPath.startsWith(path.join(ROOT, 'client', 'public')) && existsSync(assetPath)) {
      res.writeHead(200, {
        'content-type': MIME[path.extname(assetPath)] ?? 'application/octet-stream',
        'cache-control': 'public, max-age=86400',
      });
      res.end(readFileSync(assetPath));
      return;
    }
  }

  let filePath = path.join(STATIC_DIR, decodeURIComponent(url.pathname));
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = path.join(STATIC_DIR, 'index.html');
  }
  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  res.end(readFileSync(filePath));
});

// ----------------------------------------------------------------- sockets

const wss = new WebSocketServer({ server, maxPayload: 1 << 20 });

wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
  let room: GameRoom | null = null;
  let playerId = -1;
  let alive = true;

  const conn: Connection = {
    send(message: ServerMessage) {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    },
    close() {
      socket.close();
    },
  };

  socket.on('message', async (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (msg.t === 'hello') {
      if (room) return;
      if (msg.version !== PROTOCOL_VERSION) {
        conn.send({
          t: 'chat',
          from: 'SYSTEM',
          fromId: -1,
          text: `Version mismatch: server ${PROTOCOL_VERSION}, client ${msg.version}. Reload the page.`,
          channel: 'system',
        });
        socket.close();
        return;
      }
      room = await loadRoom(sanitiseRoom(msg.room || 'default'));
      playerId = room.join(conn, msg.name, msg.skin);
      return;
    }

    if (!room || playerId < 0) return;
    room.handle(playerId, msg);
  });

  socket.on('pong', () => {
    alive = true;
  });

  const heartbeat = setInterval(() => {
    if (!alive) {
      socket.terminate();
      return;
    }
    alive = false;
    if (socket.readyState === socket.OPEN) socket.ping();
  }, 15000);

  socket.on('close', () => {
    clearInterval(heartbeat);
    if (room && playerId >= 0) room.leave(playerId);
  });

  socket.on('error', () => {
    clearInterval(heartbeat);
  });
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[deephaul] port ${PORT} is already in use — is another game server running?`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`[deephaul] server listening on :${PORT}`);
  if (STATIC_DIR) console.log(`[deephaul] serving client from ${STATIC_DIR}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log('\n[deephaul] shutting down, saving rooms...');
    void Promise.all([...rooms.values()].map((r) => persist(r))).then(() => process.exit(0));
  });
}
