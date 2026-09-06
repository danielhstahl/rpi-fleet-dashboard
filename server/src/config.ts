import os from 'node:os';
import path from 'node:path';

export interface SshConfig {
  user: string;
  key: string;
  password?: string;
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
  ssh: SshConfig;
  intervals: Intervals;
}

export const config: Config = {
  port: Number(process.env.PORT) || 8787,
  mock: process.env.FLEET_MOCK === '1',
  debug: process.env.DEBUG === '1',
  ssh: {
    user: process.env.SSH_USER ?? 'pi',
    key: process.env.SSH_KEY ?? path.join(os.homedir(), '.ssh', 'id_ed25519'),
    password: process.env.SSH_PASSWORD,
    port: Number(process.env.SSH_PORT) || 22,
  },
  intervals: {
    probeMs: Number(process.env.PROBE_INTERVAL_MS) || 15_000,
    netMs: Number(process.env.NET_INTERVAL_MS) || 5_000,
    pkgMs: Number(process.env.PKG_INTERVAL_MS) || 300_000,
  },
};
