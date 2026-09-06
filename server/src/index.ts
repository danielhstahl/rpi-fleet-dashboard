// Server entrypoint: wires fleet store, probe engine, discovery, REST + WS
// and (in production mode) the built dashboard.

import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from './config.js';
import { Fleet } from './state/fleet.js';
import type { Prober, WsServerMsg } from './types.js';
import { makeProberForPi, startProbeEngine } from './probes/engine.js';
import { startMdnsDiscovery } from './discovery/mdns.js';
import { startMockFleet } from './discovery/mock.js';
import type { MockFleet } from './types.js';
import { attachWs } from './api/ws.js';
import { restRouter } from './api/rest.js';
import type { AddManualPiInput, AddManualPiResult } from './api/rest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(__dirname, '../../web/dist');

const fleet = new Fleet();
const probers = new Map<string, Prober>();

// Attach a prober whenever a Pi joins (real mode only — in mock mode the
// mock fleet installs its own probers).
fleet.onEvent = (ev) => {
  if (ev.type === 'add') {
    if (!config.mock) {
      probers.set(ev.pi.id, makeProberForPi(fleet, config)(ev.pi.id));
    }
  } else {
    probers.get(ev.id)?.stopJournal();
    probers.delete(ev.id);
  }
};

const addManualPi = (input: AddManualPiInput): AddManualPiResult => {
  const pi = fleet.addPi({
    name: input.name,
    ip: input.ip,
    user: input.user,
    sshPort: input.sshPort,
    source: 'manual',
    auth: input.password ? { type: 'password' } : { type: 'key' },
  });
  return { ok: true, pi: { id: pi.id, name: pi.name, ip: pi.ip } };
};

const app = express();
app.use(express.json());
app.get('/api/healthz', (_req, res) => {
  res.json({ ok: true, mode: config.mock ? 'mock' : 'live' });
});
app.use('/api', restRouter(fleet, { probers, addManualPi }));

const server = createServer(app);
const ws = attachWs(server, fleet, probers);
app.locals.ws = ws;

const engine = startProbeEngine(fleet, probers, config);

let mock: MockFleet | null = null;
if (config.mock) {
  mock = startMockFleet({
    fleet,
    probers,
    broadcast: (msg: WsServerMsg) => ws.broadcast(msg),
    config: {
      probeIntervalMs: 4000,
      netIntervalMs: 2500,
      pkgIntervalMs: config.intervals.pkgMs,
      journalIntervalMs: 3000,
      upgradeDelayMs: 400,
    },
  });
} else {
  startMdnsDiscovery({
    fleet,
    config,
    onUp: (d) => {
      if (fleet.get(d.id)) return;
      fleet.addPi({ id: d.id, name: d.name, ip: d.ip, source: 'mdns', user: d.user });
      console.log(`[mdns] added ${d.name} (${d.ip})`);
    },
    onDown: (d) => {
      console.log(`[mdns] gone: ${d.name} (${d.id})`);
    },
  });
}

// Serve the built dashboard (if present).
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/ws')) {
      res.sendFile(path.join(webDist, 'index.html'));
    } else {
      next();
    }
  });
}

server.listen(config.port, () => {
  console.log(`pi-fleet server listening on :${config.port} (${config.mock ? 'mock' : 'live'} mode)`);
  console.log(`  dashboard: http://localhost:${config.port}`);
});

function shutdown(): void {
  console.log('shutting down…');
  engine.close();
  mock?.stop();
  ws.close();
  server.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
