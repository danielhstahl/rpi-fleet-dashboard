/**
 * WebSocket layer: one socket per browser client.
 *  server -> {type:'fleet', data}        5s lightweight snapshot
 *  server -> {type:'journal', pi, line}  live journal (subscribed clients)
 *  server -> {type:'upgrade', pi, line?} upgrade progress / {done, ok}
 *  client -> {type:'subscribe', pi}      start receiving that Pi's journal
 *  client -> {type:'unsubscribe', pi}
 */
import { WebSocketServer, WebSocket } from 'ws';

export function attachWs({ server, fleet, probers, getProber, config }) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const viewers = new Map(); // pi -> Set<client>
  const journalFollows = new Map(); // pi -> stop fn

  function send(ws, msg) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function journalViewers(pi) {
    return viewers.get(pi) || new Set();
  }

  async function maybeStartJournal(pi) {
    if (journalViewers(pi).size === 0 || journalFollows.has(pi)) return;
    const prober = getProber?.(pi) || probers?.get(pi);
    if (!prober?.startJournal) return;
    try {
      const stop = await prober.startJournal({
        onLine: (line) => {
          for (const client of journalViewers(pi)) send(client, { type: 'journal', pi, line });
        },
        onExit: (code) => {
          journalFollows.delete(pi);
          if (code && code !== 0) {
            console.warn(`[ws] journal follow for ${pi} exited (${code}); will retry`);
            setTimeout(() => maybeStartJournal(pi), 5000);
          }
        },
      });
      if (stop) journalFollows.set(pi, stop);
    } catch (e) {
      console.warn(`[ws] journal follow for ${pi} failed: ${e.message}`);
      setTimeout(() => maybeStartJournal(pi), 5000);
    }
  }

  function maybeStopJournal(pi) {
    if (journalViewers(pi).size > 0) return;
    const stop = journalFollows.get(pi);
    if (stop) {
      stop();
      journalFollows.delete(pi);
    }
    const p = probers?.get(pi);
    p?.stopJournal?.();
  }

  wss.on('connection', (ws) => {
    // Immediately push current snapshot, then keep the client on the 5s feed.
    send(ws, { type: 'fleet', data: fleet.snapshot() });
    ws.on('message', (buf) => {
      let msg;
      try {
        msg = JSON.parse(buf.toString());
      } catch {
        return;
      }
      if (!msg.pi || !fleet.get(msg.pi)) return;
      if (msg.type === 'subscribe') {
        const set = (viewers.get(msg.pi) || new Set());
        set.add(ws);
        viewers.set(msg.pi, set);
        maybeStartJournal(msg.pi);
      } else if (msg.type === 'unsubscribe') {
        const set = viewers.get(msg.pi);
        set?.delete(ws);
        maybeStopJournal(msg.pi);
      }
    });
    ws.on('close', () => {
      for (const [pi, set] of viewers) {
        set.delete(ws);
        if (set.size === 0) maybeStopJournal(pi);
      }
    });
  });

  // Periodic lightweight fleet broadcast
  const timer = setInterval(() => {
    const data = fleet.snapshot();
    const payload = JSON.stringify({ type: 'fleet', data });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }, 5000);
  timer.unref?.();

  return {
    wss,
    broadcast(msg) {
      const payload = JSON.stringify(msg);
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) client.send(payload);
      }
    },
    stop() {
      clearInterval(timer);
      for (const stop of journalFollows.values()) {
        try { stop(); } catch { /* ignore */ }
      }
      wss.close();
    },
  };
}

export default attachWs;
