import { GameRoom, type Connection } from '../server/room.ts';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '@shared/protocol.ts';

/**
 * The authoritative game server, hosted inside a web worker.
 *
 * The Node server and this worker run the exact same GameRoom. GitHub Pages
 * cannot run Node, so the client spawns this worker and speaks to it over
 * postMessage with the identical wire protocol — solo crews get the same
 * simulation, the same creatures, the same quota, entirely in the tab.
 */

const conn: Connection = {
  send(message: ServerMessage) {
    self.postMessage({ data: message });
  },
  close() {
    self.close();
  },
};

let room: GameRoom | null = null;
let playerId = -1;

function sanitiseRoom(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'default';
}

self.onmessage = (ev: MessageEvent<{ data: ClientMessage }>) => {
  const msg = ev.data?.data;
  if (!msg) return;

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
      conn.close();
      return;
    }
    room = new GameRoom(sanitiseRoom(msg.room || 'default'));
    playerId = room.join(conn, msg.name, msg.skin);
    return;
  }

  if (!room || playerId < 0) return;
  room.handle(playerId, msg);
};

// The worker is alive the moment this module evaluates; the client flushes
// its message queue on first contact.
self.postMessage({ data: { t: 'worker-ready' } });
