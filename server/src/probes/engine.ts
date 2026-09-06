// Probe engine: per-cadence timers over the fleet, plus the real SSH
// prober factory. Probers are attached to the fleet store and to the ws
// hub; the engine only drives cadence.

import type { Config } from '../config.js';
import type { Fleet } from '../state/fleet.js';
import type { JournalLine, Prober } from '../types.js';
import { runHealthScript } from './health.js';
import { sampleNetwork } from './network.js';
import { probePackages } from './packages.js';
import { parseJournalLine } from './journal.js';
import { runStream } from './ssh.js';
import type { SshTarget } from './ssh.js';

const JOURNAL_FOLLOW_CMD = 'journalctl -f --no-pager -n 100 --output=short-iso';

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
  return (piId: string): Prober => {
    const pi = fleet.get(piId);
    if (!pi) throw new Error(`unknown pi: ${piId}`);
    // Connection = the operator's local ssh: target is the ssh-config
    // alias (if set) or the IP; user/port fall through to ~/.ssh/config
    // unless explicitly set per Pi (or globally via SSH_PORT).
    const target: SshTarget = {
      host: pi.sshHost || pi.ip,
      user: pi.user,
      port: pi.sshPort || config.ssh.port,
    };

    let stopJournal: (() => void) | null = null;

    const probeHealth = async (): Promise<void> => {
      try {
        await runHealthScript(target, fleet, piId);
      } catch (e: unknown) {
        fleet.setProbingResult(piId, false, e instanceof Error ? e.message : String(e));
      }
    };

    const probeNet = async (): Promise<void> => {
      try {
        await sampleNetwork(target, fleet, piId);
      } catch (e: unknown) {
        if (config.debug) console.error(`[prober:${piId}] net sample failed:`, e);
      }
    };

    const probePkgs = async (): Promise<void> => {
      try {
        await probePackages(target, fleet, piId);
      } catch (e: unknown) {
        if (config.debug) console.error(`[prober:${piId}] pkgs probe failed:`, e);
      }
    };

    return {
      probeHealth,
      probeNet,
      probePkgs,

      async startJournal({ onLine, onExit }): Promise<() => void> {
        if (stopJournal) return stopJournal;
        stopJournal = await runStream(
          target,
          JOURNAL_FOLLOW_CMD,
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
