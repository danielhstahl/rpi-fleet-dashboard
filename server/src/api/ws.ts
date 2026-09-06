// WebSocket hub: 5s fleet snapshots to everyone, per-Pi journal tails only
// while at least one viewer is subscribed, upgrade progress broadcasts.

import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { WebSocket as Ws } from 'ws';
import type { Fleet } from '../state/fleet.js';
import type {
  JournalLine,
  JournalOpts,
  Prober,
  WsClientMsg,
  WsServerMsg,
} from '../types.js';

// Let REST routes reach the broadcaster via app.locals (typed, not `any`).
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      ws?: WsApi;
    }
  }
}

export interface WsApi {
  broadcast(msg: WsServerMsg): void;
  close(): void;
}

const SNAPSHOT_INTERVAL_MS = 5000;
const MAX_JOURNAL_LINES = 500;

export function attachWs(
  server: Server,
  fleet: Fleet,
  probers?: Map<string, Prober>,
): WsApi {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients = new Set<Ws>();
  const journalSubs = new Map<string, Set<Ws>>();
  const journalFollows = new Map<string, () => void>();

  const send = (ws: Ws, msg: WsServerMsg): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  const broadcast = (msg: WsServerMsg): void => {
    const s = JSON.stringify(msg);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(s);
    }
  };

  const startJournalFor = (piId: string): void => {
    const prober = probers?.get(piId);
    if (!prober || journalFollows.has(piId)) return;
    // Register a stop placeholder immediately so rapid sub/unsub cycles
    // can't double-start a tail.
    let realStop: (() => void) | null = null;
    const placeholder = (): void => {
      if (realStop) realStop();
      journalFollows.delete(piId);
    };
    journalFollows.set(piId, placeholder);
    const opts: JournalOpts = {
      onLine: (line: JournalLine): void => broadcast({ type: 'journal', pi: piId, line }),
      onExit: (code: number): void => {
        journalFollows.delete(piId);
        console.warn(`[ws] journal tail for ${piId} exited (code ${code})`);
      },
    };
    prober
      .startJournal(opts)
      .then((stop) => {
        realStop = stop;
      })
      .catch((e: unknown) => {
        journalFollows.delete(piId);
        console.warn(`[ws] journal start failed for ${piId}:`, e);
      });
  };

  const maybeStopJournal = (piId: string): void => {
    if (journalSubs.get(piId)?.size) return;
    const stop = journalFollows.get(piId);
    if (stop) {
      stop();
      journalFollows.delete(piId);
    }
  };

  wss.on('connection', (ws: Ws) => {
    clients.add(ws);
    send(ws, { type: 'fleet', data: fleet.snapshot() });

    ws.on('message', (buf: Buffer | ArrayBuffer | Buffer[]) => {
      let msg: WsClientMsg;
      try {
        msg = JSON.parse(
          Buffer.isBuffer(buf) ? buf.toString() : Buffer.from(buf as ArrayBuffer).toString(),
        ) as WsClientMsg;
      } catch {
        return;
      }
      if (msg.type !== 'subscribe' && msg.type !== 'unsubscribe') return;
      if (typeof msg.pi !== 'string' || !msg.pi) return;

      let set = journalSubs.get(msg.pi);
      if (msg.type === 'subscribe') {
        if (!set) {
          set = new Set();
          journalSubs.set(msg.pi, set);
        }
        set.add(ws);
        startJournalFor(msg.pi);
        // Replay recent history so the tab opens with context.
        for (const line of fleet.tailJournal(msg.pi, 200)) {
          send(ws, { type: 'journal', pi: msg.pi, line });
        }
      } else if (set) {
        set.delete(ws);
        if (set.size === 0) {
          journalSubs.delete(msg.pi);
          maybeStopJournal(msg.pi);
        }
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      for (const [piId, set] of [...journalSubs.entries()]) {
        set.delete(ws);
        if (set.size === 0) {
          journalSubs.delete(piId);
          maybeStopJournal(piId);
        }
      }
    });

    ws.on('error', (err: Error) => {
      console.warn('[ws] client error:', err.message);
    });
  });

  // broadcast fleet snapshot
  const snapshotTimer = setInterval(() => broadcast({ type: 'fleet', data: fleet.snapshot() }), SNAPSHOT_INTERVAL_MS);

  return {
    broadcast,
    close(): void {
      clearInterval(snapshotTimer);
      wss.close();
      for (const stop of journalFollows.values()) stop();
      journalFollows.clear();
    },
  };
}
