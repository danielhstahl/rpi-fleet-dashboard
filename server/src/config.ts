// Server configuration. Auth lives in the operator's `~/.ssh/config` (the
// probes shell out to the system `ssh`), so there is no user/key/password
// here — at most a port override for non-standard setups.

export interface SshConfig {
  /** Global fallback SSH port for Pis that don't set their own. */
  port: number;
}

export interface Intervals {
  probeMs: number;
  netMs: number;
  pkgMs: number;
}

export interface Config {
  port: number;
  mock: boolean;
  debug: boolean;
  /** sqlite file for fleet persistence (live mode only) */
  dbPath: string;
  ssh: SshConfig;
  intervals: Intervals;
}

export const config: Config = {
  port: Number(process.env.PORT) || 8787,
  mock: process.env.FLEET_MOCK === '1',
  debug: process.env.DEBUG === '1',
  dbPath: process.env.FLEET_DB ?? './fleet.db',
  ssh: {
    port: Number(process.env.SSH_PORT) || 22,
  },
  intervals: {
    probeMs: Number(process.env.PROBE_INTERVAL_MS) || 15_000,
    netMs: Number(process.env.NET_INTERVAL_MS) || 5_000,
    pkgMs: Number(process.env.PKG_INTERVAL_MS) || 300_000,
  },
};
