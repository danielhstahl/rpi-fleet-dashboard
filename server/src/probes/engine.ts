// Probe engine: per-cadence timers over the fleet, plus the real SSH
// prober factory. Probers are attached to the fleet store and to the ws
// hub; the engine only drives cadence.

import { Client } from 'ssh2';
import type { Config } from '../config.js';
import type { Fleet } from '../state/fleet.js';
import type { JournalLine, Prober } from '../types.js';
import { runHealthScript } from './health.js';
import { sampleNetwork } from './network.js';
import { probePackages } from './packages.js';
import { parseJournalLine } from './journal.js';
import { connect } from './ssh.js';
import type { SshOpts } from './ssh.js';

const UPGRADE_CMD =
  'sudo DEBIAN_FRONTEND=noninteractive apt-get update -y && ' +
  'sudo DEBIAN_FRONTEND=noninteractive apt-get full-upgrade -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold"';

interface SshPoolAuth {
  username: string;
  keyPath?: string;
  password?: string;
}

class SshPool {
  private clients: Map<string, Client> = new Map();

  private key(host: string, port: number): string {
    return `${host}:${port}`;
  }

  private async open(host: string, port: number, auth: SshPoolAuth): Promise<Client> {
    return connect({ host, port, ...auth });
  }

  async get(host: string, port: number, auth: SshPoolAuth): Promise<Client> {
    const k = this.key(host, port);
    const existing = this.clients.get(k);
    if (existing) return existing;
    const c = await this.open(host, port, auth);
    c.on('error', () => this.clients.delete(k));
    this.clients.set(k, c);
    return c;
  }

  /** Streaming exec on a pooled client (journal tails, upgrades). */
  async stream(
    host: string,
    port: number,
    auth: SshPoolAuth,
    cmd: string,
    onData: (chunk: string) => void,
    onExit?: (code: number | null) => void,
    timeoutMs?: number,
  ): Promise<() => void> {
    const c = await this.get(host, port, auth);
    return new Promise((resolve, reject) => {
      c.exec(cmd, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }
        let settled = false;
        const stop = (): void => {
          try { stream.close(); } catch { /* already closed */ }
        };
        const finish = (code: number | null): void => {
          if (settled) return;
          settled = true;
          onExit?.(code);
          this.clients.delete(this.key(host, port));
          c.end();
          resolve(stop);
        };
        stream.on('data', (d: Buffer) => onData(d.toString()));
        stream.stderr.on('data', (d: Buffer) => onData(d.toString()));
        stream.on('close', (code: number) => finish(code ?? null));
        // Make the stop function available as soon as exec is running.
        resolve(stop);
        if (timeoutMs) {
          const t = setTimeout(() => {
            stop();
            finish(null);
          }, timeoutMs);
          stream.on('close', () => clearTimeout(t));
        }
      });
    });
  }

  closeAll(): void {
    for (const c of this.clients.values()) {
      try { c.end(); } catch { /* already gone */ }
    }
    this.clients.clear();
  }
}

export interface ProbeEngine {
  stop(): void;
  close(): void;
}

export function startProbeEngine(
  fleet: Fleet,
  probers: Map<string, Prober>,
  config: Config,
): ProbeEngine {
  const probePi = async (id: string): Promise<void> => {
    const prober = probers.get(id);
    if (!prober) return;
    await prober.probeHealth().catch((e: unknown) => {
      fleet.setProbingResult(id, false, e instanceof Error ? e.message : String(e));
    });
    await prober.probePkgs().catch((e: unknown) => {
      if (config.debug) console.error(`[engine:${id}] pkgs probe failed:`, e);
    });
  };

  const netTick = async (): Promise<void> => {
    for (const pi of fleet.list()) {
      if (!pi.online) continue;
      const prober = probers.get(pi.id);
      if (!prober) continue;
      await prober.probeNet().catch((e: unknown) => {
        if (config.debug) console.error(`[engine:${pi.id}] net probe failed:`, e);
      });
    }
  };

  let healthTimer: NodeJS.Timeout | null = null;
  let netTimer: NodeJS.Timeout | null = null;
  let pkgTimer: NodeJS.Timeout | null = null;

  // initial pass
  for (const pi of fleet.list()) void probePi(pi.id);
  healthTimer = setInterval(() => {
    for (const pi of fleet.list()) void probePi(pi.id);
  }, config.intervals.probeMs);
  netTimer = setInterval(() => void netTick(), config.intervals.netMs);
  pkgTimer = setInterval(() => {
    for (const pi of fleet.list()) {
      if (!pi.online) continue;
      const prober = probers.get(pi.id);
      if (!prober) continue;
      void prober.probePkgs().catch((e: unknown) => {
        if (config.debug) console.error(`[engine:${pi.id}] pkgs probe failed:`, e);
      });
    }
  }, config.intervals.pkgMs);

  return {
    stop(): void {
      if (healthTimer) clearInterval(healthTimer);
      if (netTimer) clearInterval(netTimer);
      if (pkgTimer) clearInterval(pkgTimer);
    },
    close(): void {
      this.stop();
    },
  };
}

/**
 * Factory for the real SSH prober bound to one Pi. Closures (not `this`)
 * keep the stopJournal lifecycle in one place.
 */
export function makeProberForPi(fleet: Fleet, config: Config): (piId: string) => Prober {
  const pool = new SshPool();

  return (piId: string): Prober => {
    const pi = fleet.get(piId);
    if (!pi) throw new Error(`unknown pi: ${piId}`);
    const host = pi.ip;
    const port = pi.sshPort || config.ssh.port;
    const auth: SshPoolAuth = {
      username: pi.user,
      keyPath: config.ssh.key,
      password: config.ssh.password,
    };
    const opts: SshOpts = { host, port, ...auth };

    let stopJournal: (() => void) | null = null;

    const probeHealth = async (): Promise<void> => {
      try {
        await runHealthScript(opts, fleet, piId);
      } catch (e: unknown) {
        fleet.setProbingResult(piId, false, e instanceof Error ? e.message : String(e));
      }
    };

    const probeNet = async (): Promise<void> => {
      try {
        await sampleNetwork(opts, fleet, piId);
      } catch (e: unknown) {
        if (config.debug) console.error(`[prober:${piId}] net sample failed:`, e);
      }
    };

    const probePkgs = async (): Promise<void> => {
      try {
        await probePackages(opts, fleet, piId);
      } catch (e: unknown) {
        if (config.debug) console.error(`[prober:${piId}] pkgs probe failed:`, e);
      }
    };

    return {
      probeHealth,
      probeNet,
      probePkgs,

      async upgrade({ onLine, onDone }): Promise<void> {
        // stream() resolves once the exec is live; onDone fires from the
        // exit callback when the upgrade actually finishes.
        await pool.stream(host, port, auth, UPGRADE_CMD, onLine, (code) => {
          onDone(code === 0);
          fleet.setUpgrading(piId, false);
          void probePkgs().catch((e: unknown) => {
            if (config.debug) console.error(`[prober:${piId}] post-upgrade pkgs probe failed:`, e);
          });
        });
      },

      async startJournal({ onLine, onExit }): Promise<() => void> {
        if (stopJournal) return stopJournal;
        stopJournal = await pool.stream(
          host,
          port,
          auth,
          'journalctl -f --no-pager -n 100 --output=short-iso',
          (chunk: string) => {
            for (const line of chunk.split('\n')) {
              const parsed: JournalLine | null = parseJournalLine(line);
              if (parsed) {
                onLine(parsed);
                fleet.pushJournalLine(piId, parsed);
              }
            }
          },
          (code: number | null) => {
            stopJournal = null;
            if (code !== 0 && code !== null) onExit?.(code);
          },
        );
        return stopJournal;
      },

      stopJournal(): void {
        if (stopJournal) {
          stopJournal();
          stopJournal = null;
        }
      },
    };
  };
}
