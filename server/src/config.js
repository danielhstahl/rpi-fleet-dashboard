export const config = {
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || '0.0.0.0',

  // FLEET_MOCK=1 simulates a fleet so the dashboard is usable without hardware
  mock: process.env.FLEET_MOCK === '1' || process.env.FLEET_MOCK === 'true',

  // Probe cadence
  probeIntervalMs: Number(process.env.PROBE_INTERVAL_MS || 15000), // health
  netIntervalMs: Number(process.env.NET_INTERVAL_MS || 5000),      // traffic
  pkgIntervalMs: Number(process.env.PKG_INTERVAL_MS || 300000),    // apt state
  journalWindowMs: 60 * 60 * 1000,                                  // attention window

  ssh: {
    port: Number(process.env.SSH_PORT || 22),
    user: process.env.SSH_USER || 'pi',
    keyPath: process.env.SSH_KEY || `${process.env.HOME || '/root'}/.ssh/id_ed25519`,
    password: process.env.SSH_PASSWORD || undefined,
    timeoutMs: 10000,
  },

  mdns: {
    // The small Pi-side agent advertises this service (see README)
    serviceType: process.env.FLEET_MDNS_TYPE || '_pi-fleet._tcp',
    port: 8787,
  },

  // History ring buffers
  historyPoints: 240,    // ~60 min of 15s health samples
  netHistoryPoints: 360, // ~30 min of 5s traffic samples
  journalLines: 500,
};

export default config;
