/**
 * Mock fleet: simulates four Pis with seeded personalities so the dashboard
 * (and the attention engine) is fully demoable without hardware.
 *
 *   pi-alpha   healthy
 *   pi-bravo   degraded: disk ~92%, warm temps, high load
 *   pi-charlie offline: every probe fails -> critical "unreachable"
 *   pi-delta   trouble: OOM kills, error flood, security updates, heavy traffic
 */
import { parseJournalLine, line } from '../probes/journal.js';

const defs = [
  { id: 'mock-alpha', name: 'pi-alpha', ip: '192.168.1.11', profile: 'healthy' },
  { id: 'mock-bravo', name: 'pi-bravo', ip: '192.168.1.12', profile: 'degraded' },
  { id: 'mock-charlie', name: 'pi-charlie', ip: '192.168.1.13', profile: 'offline' },
  { id: 'mock-delta', name: 'pi-delta', ip: '192.168.1.14', profile: 'trouble' },
];

const seed = {
  healthy: { cpu: 14, mem: 46, disk: 61, temp: 51, load: 0.6, rx: 420_000, tx: 90_000, uptime: 12 * 86400 },
  degraded: { cpu: 64, mem: 78, disk: 92, temp: 79, load: 2.2, rx: 900_000, tx: 250_000, uptime: 3 * 86400 },
  offline: null,
  trouble: { cpu: 58, mem: 91, disk: 74, temp: 66, load: 1.7, rx: 5_200_000, tx: 800_000, uptime: 18 * 3600 },
};

const walk = (v, min, max, step = 1) => Math.min(max, Math.max(min, v + (Math.random() - 0.5) * 2 * step));

export function startMockFleet({ fleet, config, probers, broadcast }) {
  const state = new Map();

  for (const d of defs) {
    fleet.addPi({ id: d.id, name: d.name, ip: d.ip, source: 'mock', user: 'pi' });
    state.set(d.id, { ...seed[d.profile], baseRx: seed[d.profile]?.rx ?? 0 });
    probers.set(d.id, mockProber({ pi: fleet.get(d.id), profile: d.profile, state: state.get(d.id), fleet, config, broadcast }));
  }

  // Charlie fails every probe from the start -> immediate critical
  for (let i = 0; i < 3; i++) fleet.setProbingResult('mock-charlie', false, 'connect ECONNREFUSED 192.168.1.13:22');

  // Initial package state
  fleet.setPackages('mock-alpha', { total: 0, security: 0 });
  fleet.setPackages('mock-bravo', {
    total: 3,
    security: 0,
    list: ['libc6/updates 2.39-0ubuntu8.5 amd64', 'libssl3t64/updates 3.0.13 amd64', 'tzdata/updates 2026a amd64'],
  });
  fleet.setPackages('mock-delta', {
    total: 12,
    security: 8,
    list: [
      'openssh-server/security 1:9.6p1 amd64',
      'linux-raspi/security 6.6.87-raspi amd64',
      'curl/security 8.5.0 amd64',
      'openssl/security 3.0.13 amd64',
      'sudo/security 1.9.15p5 amd64',
      'apt/security 2.7.14 amd64',
      'bash/security 5.2.21 amd64',
      'coreutils/security 9.4 amd64',
      'libc6/updates 2.39-0ubuntu8.5 amd64',
      'libssl3t64/updates 3.0.13 amd64',
      'systemd/updates 255.4 amd64',
      'tzdata/updates 2026a amd64',
    ],
  });

  // --- health tick (probe cadence) ---
  const healthTick = () => {
    for (const d of defs) {
      if (d.profile === 'offline') {
        fleet.setProbingResult(d.id, false, 'connect ECONNREFUSED 192.168.1.13:22');
        continue;
      }
      const s = state.get(d.id);
      s.cpu = walk(s.cpu, 2, 97, 4);
      s.mem = walk(s.mem, 8, 98, 2);
      s.disk = walk(s.disk, d.profile === 'degraded' ? 90.5 : 55, d.profile === 'degraded' ? 94 : 80, 0.2);
      s.temp = walk(s.temp, 42, d.profile === 'degraded' ? 84 : 70, 1.5);
      s.load = walk(s.load, 0.1, d.profile === 'degraded' ? 3.4 : 2.0, 0.2);
      s.uptime += config.probeIntervalMs / 1000;
      fleet.updateMetrics(d.id, {
        uptimeSec: Math.round(s.uptime),
        load1: +s.load.toFixed(2),
        cores: 4,
        memPct: +s.mem.toFixed(1),
        diskPct: +s.disk.toFixed(1),
        cpuPct: +s.cpu.toFixed(1),
        tempC: Math.round(s.temp),
        ip: d.ip,
      });
      fleet.setProbingResult(d.id, true);
    }
  };
  healthTick();
  const tHealth = setInterval(healthTick, config.probeIntervalMs);

  // --- network tick (traffic cadence) ---
  const netTick = () => {
    for (const d of defs) {
      if (d.profile === 'offline') continue;
      const s = state.get(d.id);
      const jitter = 0.75 + Math.random() * 0.5;
      const dt = config.netIntervalMs / 1000;
      s.rx += s.baseRx * jitter * dt;
      s.tx += s.baseRx * 0.22 * jitter * dt;
      fleet.updateNetwork(d.id, { eth0: { rx: s.rx, tx: s.tx } });
    }
  };
  const tNet = setInterval(netTick, config.netIntervalMs);

  // --- journal tick ---
  const tJournal = setInterval(() => {
    const now = new Date().toISOString().replace(/\.\d+Z$/, '+0000');
    for (const d of defs) {
      if (d.profile === 'offline') continue;
      const s = state.get(d.id);
      if (d.profile === 'trouble' && s.errTick === undefined) s.errTick = 0;
      const emit = [];
      if (d.profile === 'trouble') {
        s.errTick = (s.errTick ?? 0) + 1;
        if (s.errTick % 3 === 1) emit.push(line(now, d.name, 'kernel', 'oom-killer: Killed process 1834 (chromium) total-vm:2048000kB, anon-rss:1503000kB'));
        if (s.errTick % 3 === 2) emit.push(line(now, d.name, 'systemd[1]', 'getty@tty1.service: Failed with result exit-code.'));
      } else if (Math.random() < 0.25) {
        emit.push(line(now, d.name, 'CRON[912]', '(root) CMD (cd / && run-parts --report /etc/cron.hourly)'));
      }
      for (const l of emit) fleet.pushJournalLine(d.id, parseJournalLine(l));
    }
  }, config.journalIntervalMs || 7000);

  return {
    stop() {
      clearInterval(tHealth);
      clearInterval(tNet);
      clearInterval(tJournal);
    },
  };
}

/** Mock prober: upgrade simulates apt output; journal streams profile lines. */
function mockProber({ pi, profile, state, fleet, config, broadcast }) {
  let journalTimer = null;
  const pkgs = () => {
    const p = fleet.get(pi.id)?.pkgs;
    return p && p.total > 0;
  };

  return {
    async upgrade({ onLine, onDone }) {
      const steps = [
        'Reading package lists... Done',
        'Building dependency tree... Done',
        'Calculating upgrade... Done',
        'The following packages will be upgraded: openssl openssh-server apt sudo',
        'Fetched 12.4 MB in 2s (6.2 MB/s)',
        'Preparing to unpack .../openssl_3.0.13-0ubuntu3.7_amd64.deb ...',
        'Unpacking openssl (3.0.13-0ubuntu3.7) over (3.0.13-0ubuntu3.4) ...',
        'Setting up openssh-server (1:9.6p1-3ubuntu13.1) ...',
        'Setting up apt (2.7.14build2) ...',
        'Processing triggers for man-db (2.11.2-3) ...',
      ];
      const delay = config.upgradeDelayMs ?? 600;
      for (const s of steps) {
        onLine(s);
        await new Promise((r) => setTimeout(r, delay + Math.random() * delay));
      }
      onDone(true);
      fleet.setPackages(pi.id, { total: 0, security: 0, list: [] });
    },
    startJournal({ onLine, onExit }) {
      let tick = 0;
      journalTimer = setInterval(() => {
        tick++;
        const now = new Date().toISOString().replace(/\.\d+Z$/, '+0000');
        if (profile === 'trouble' && tick % 4 === 1) {
          onLine(parseJournalLine(line(now, pi.name, 'kernel', 'oom-killer: Killed process 1834 (chromium) total-vm:2048000kB, anon-rss:1503000kB')));
        } else if (profile === 'degraded' && tick % 5 === 1) {
          onLine(parseJournalLine(line(now, pi.name, 'systemd[1]', 'thermal-monitor.service: Temperature threshold reached, throttling likely')));
        } else {
          onLine(parseJournalLine(line(now, pi.name, 'systemd[1]', 'Started Session 1 of user pi.')));
        }
      }, 2500);
      onExit?.(0);
      return () => clearInterval(journalTimer);
    },
  };
}

export { defs };
export default startMockFleet;
