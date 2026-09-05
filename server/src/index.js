import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from './config.js';
import { Fleet } from './state/fleet.js';
import { startMdnsDiscovery, mdnsId } from './discovery/mdns.js';
import { startMockFleet } from './discovery/mock.js';
import { SshPool } from './probes/ssh.js';
import { startProbing } from './probes/engine.js';
import { restRouter } from './api/rest.js';
import { attachWs } from './api/ws.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');

const fleet = new Fleet(config);
const probers = new Map(); // pi id -> prober (mock or real)
const pool = new SshPool(config.ssh);
let probing = null;

// --- wire up discovery / mock -------------------------------------------------

let addCounter = 0;
function addManualPi({ name, ip, user, sshPort, password }) {
  if (!ip || !/^[0-9a-fA-F:.\[]+$/.test(ip)) throw new Error('invalid ip/hostname');
  const id = password ? `pw-${mdnsId(name || ip)}` : mdnsId(name || ip);
  const existing = fleet.get(id);
  if (existing) return existing;
  const pi = fleet.addPi({
    id,
    name: name || ip,
    ip,
    user,
    sshPort,
    source: 'manual',
    auth: { type: password ? 'password' : 'key' },
  });
  addCounter++;
  return pi;
}

let discovery = { stop() {} };
let mock = null;

if (config.mock) {
  console.log('[fleet] FLEET_MOCK=1 — running simulated fleet (4 Pis)');
  mock = startMockFleet({
    fleet,
    config,
    probers,
    broadcast: (msg) => ws?.broadcast(msg),
  });
} else {
  probing = startProbing({ pool, fleet, config });
  fleet.onAdd = (pi) => probing.startPi(pi);
  fleet.onRemove = (pi) => probing.stopPi(pi.id);
  discovery = startMdnsDiscovery({
    serviceType: config.mdns.serviceType,
    onFound: ({ id, name, ip }) => {
      if (fleet.get(id)) return;
      const pi = fleet.addPi({ id, name, ip, source: 'mdns', user: config.ssh.user, sshPort: config.ssh.port });
      console.log(`[discovery] found ${pi.name} at ${ip}`);
    },
  });
}

// --- http: express + ws -------------------------------------------------------

const app = express();
app.use(express.json());

let ws;
const server = http.createServer(app);
ws = attachWs({ server, fleet, probers, getProber: (id) => probers.get(id), config });
app.locals.ws = ws;

app.use('/api', restRouter({ fleet, getProber: (id) => probers.get(id), addPi: addManualPi, config }));

// Serve the built dashboard if present (production mode)
const dist = path.join(root, 'web', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/ws')) {
      return res.sendFile(path.join(dist, 'index.html'));
    }
    next();
  });
  console.log(`[fleet] serving dashboard from ${dist}`);
} else {
  app.get('/', (_req, res) =>
    res.type('text/plain').send('pi-fleet server running. Start the web dev server (npm run dev:web) or build (npm run build) for the dashboard.')
  );
}

server.listen(config.port, config.host, () => {
  console.log(`[fleet] listening on http://${config.host}:${config.port} (mode: ${config.mock ? 'mock' : 'live'})`);
});

// --- shutdown -----------------------------------------------------------------

async function shutdown() {
  console.log('[fleet] shutting down');
  discovery.stop();
  mock?.stop();
  probing?.stop();
  ws?.stop();
  await pool.closeAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
