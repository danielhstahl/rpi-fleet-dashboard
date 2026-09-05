/**
 * Real-mode probe engine: schedules health / network / package probes over
 * SSH for each registered Pi and registers a prober (upgrade + journal).
 */
import { HEALTH_CMD, parseHealth } from './health.js';
import { NET_CMD, parseNet } from './network.js';
import { PKG_CMD, parsePkgs, PKG_LIST_CMD, UPGRADE_CMD } from './packages.js';
import { JOURNAL_TAIL, JOURNAL_FOLLOW, parseJournalLine } from './journal.js';

export function makeRealProber({ pool, fleet, config }) {
  return (pi) => {
    const host = pi.ip;
    const port = pi.sshPort || config.ssh.port;
    let stopJournal = null;

    return {
      pi,
      async probeHealth() {
        const { stdout } = await pool.exec(host, HEALTH_CMD, { port });
        const m = parseHealth(stdout);
        fleet.updateMetrics(pi.id, m);
        fleet.setProbingResult(pi.id, true);
      },
      async probeNet() {
        const { stdout } = await pool.exec(host, NET_CMD, { port, timeoutMs: 8000 });
        fleet.updateNetwork(pi.id, parseNet(stdout));
      },
      async probePkgs() {
        const { stdout } = await pool.exec(host, PKG_CMD, { port, timeoutMs: 20000 });
        const { total, security } = parsePkgs(stdout);
        let list = [];
        if (total > 0) {
          try {
            const { stdout: ls } = await pool.exec(host, PKG_LIST_CMD, { port, timeoutMs: 20000 });
            list = ls.trim().split('\n').filter(Boolean);
          } catch { /* best effort */ }
        }
        fleet.setPackages(pi.id, { total, security, list });
      },
      async upgrade({ onLine, onDone }) {
        fleet.setUpgrading(pi.id, true);
        try {
          const stop = await pool.execStream(host, UPGRADE_CMD, {
            port,
            onLine,
            onExit: (code) => {
              onDone(code === 0);
              fleet.setUpgrading(pi.id, false);
              this.probePkgs().catch(() => {});
            },
          });
          // If the upgrade command is killed externally, still clear the flag.
          void stop;
        } catch (e) {
          fleet.setUpgrading(pi.id, false);
          onLine(`upgrade failed to start: ${e.message}`);
          onDone(false);
        }
      },
      async fetchJournalTail({ onLine }) {
        const { stdout } = await pool.exec(host, JOURNAL_TAIL, { port, timeoutMs: 15000 });
        for (const l of stdout.trim().split('\n')) {
          const parsed = parseJournalLine(l);
          if (parsed) {
            fleet.pushJournalLine(pi.id, parsed);
            onLine?.(parsed);
          }
        }
      },
      async startJournal({ onLine, onExit }) {
        if (stopJournal) return stopJournal;
        stopJournal = await pool.execStream(host, JOURNAL_FOLLOW, {
          port,
          onLine: (raw) => {
            const parsed = parseJournalLine(raw);
            if (parsed) {
              fleet.pushJournalLine(pi.id, parsed);
              onLine?.(parsed);
            }
          },
          onExit,
        });
        return stopJournal;
      },
      stopJournal() {
        stopJournal?.();
        stopJournal = null;
      },
    };
  };
}

/**
 * Start per-Pi probe loops. Returns { startPi, stopPi, stop }.
 */
export function startProbing({ pool, fleet, config }) {
  const proberFor = makeRealProber({ pool, fleet, config });
  const timers = new Map();

  function startPi(pi) {
    if (timers.has(pi.id)) return;
    const prober = proberFor(pi);
    const run = async (fn) => {
      try {
        await fn();
      } catch (e) {
        fleet.setProbingResult(pi.id, false, e.message);
      }
    };
    const tHealth = setInterval(() => run(() => prober.probeHealth()), config.probeIntervalMs);
    const tNet = setInterval(() => run(() => prober.probeNet()), config.netIntervalMs);
    const tPkgs = setInterval(() => run(() => prober.probePkgs()), config.pkgIntervalMs);
    timers.set(pi.id, { prober, tHealth, tNet, tPkgs });
    // Kick everything off immediately (first results in < 1s on a warm net)
    run(() => prober.probeHealth());
    run(() => prober.probeNet());
    run(() => prober.probePkgs());
  }

  function stopPi(id) {
    const t = timers.get(id);
    if (!t) return;
    clearInterval(t.tHealth);
    clearInterval(t.tNet);
    clearInterval(t.tPkgs);
    t.prober.stopJournal();
    timers.delete(id);
  }

  return {
    startPi,
    stopPi,
    prober: (id) => timers.get(id)?.prober || null,
    stop() {
      for (const id of [...timers.keys()]) stopPi(id);
    },
  };
}

export default startProbing;
