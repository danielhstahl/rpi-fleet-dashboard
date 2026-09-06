// Mock fleet: four simulated Pis with distinct personalities so the
// dashboard has something to point at without hardware:
//   alpha  healthy
//   bravo  disk filling up + running hot
//   charlie offline (unreachable → critical)
//   delta  OOM storm + security updates + heavy traffic
//
// The mock probers implement the same Prober contract as the real SSH
// probers, so the engine, REST and WS layers are completely agnostic.

import type {
  JournalLine,
  Metrics,
  MockFleet,
  Prober,
  WsServerMsg,
} from '../types.js';
import type { Fleet } from '../state/fleet.js';

type Profile = 'healthy' | 'disk-warn' | 'offline' | 'oom-storm';

export interface MockDef {
  id: string;
  name: string;
  ip: string;
  profile: Profile;
}

/** The four seeded Pis (also used by tests to assert fleet size). */
export const defs: MockDef[] = [
  { id: 'mock-alpha', name: 'pi-alpha', ip: '10.0.0.11', profile: 'healthy' },
  { id: 'mock-bravo', name: 'pi-bravo', ip: '10.0.0.12', profile: 'disk-warn' },
  { id: 'mock-charlie', name: 'pi-charlie', ip: '10.0.0.13', profile: 'offline' },
  { id: 'mock-delta', name: 'pi-delta', ip: '10.0.0.14', profile: 'oom-storm' },
];

export interface MockIntervals {
  probeIntervalMs: number;
  netIntervalMs: number;
  pkgIntervalMs: number;
  journalIntervalMs: number;
}

interface MockState {
  cpu: number;
  mem: number;
  disk: number;
  temp: number;
  load: number;
  diskTrend: number;
  tempTrend: number;
  cpuTrend: number;
  oomEvery: number;
  rx: number;
  tx: number;
  rxBytes: number;
  txBytes: number;
  offline: boolean;
  lastUp: number;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function initState(profile: Profile): MockState {
  const base = {
    rxBytes: 0,
    txBytes: 0,
    offline: false,
    lastUp: 0,
  };
  switch (profile) {
    case 'disk-warn':
      return {
        ...base,
        cpu: 15, mem: 45, disk: 91, temp: 72, load: 0.5,
        diskTrend: 0.05, tempTrend: 0.8, cpuTrend: 0.1,
        oomEvery: 0, rx: 250_000, tx: 40_000,
      };
    case 'offline':
      return {
        ...base,
        cpu: 0, mem: 0, disk: 50, temp: 0, load: 0,
        diskTrend: 0, tempTrend: 0, cpuTrend: 0,
        oomEvery: 0, rx: 0, tx: 0,
        offline: true,
      };
    case 'oom-storm':
      return {
        ...base,
        cpu: 70, mem: 92, disk: 55, temp: 71, load: 2.4,
        diskTrend: 0.01, tempTrend: 0.15, cpuTrend: 0.3,
        oomEvery: 9, rx: 600_000, tx: 90_000,
      };
    case 'healthy':
      return {
        ...base,
        cpu: 8, mem: 35, disk: 42, temp: 47, load: 0.3,
        diskTrend: 0.002, tempTrend: 0, cpuTrend: 0.05,
        oomEvery: 0, rx: 120_000, tx: 30_000,
      };
  }
}

interface MockProberDeps {
  broadcast: (msg: WsServerMsg) => void;
  fleet: Fleet;
  timers: NodeJS.Timeout[];
  config: MockIntervals;
}

function makeMockProber(id: string, st: MockState, deps: MockProberDeps): Prober {
  const { broadcast, fleet, timers, config } = deps;

  const currentMetrics = (): Metrics => ({
    at: Date.now(),
    uptimeSec: st.lastUp ? Math.max(1, Math.floor((Date.now() - st.lastUp) / 1000)) : 0,
    load1: st.load,
    cores: 4,
    memPct: st.mem,
    diskPct: st.disk,
    cpuPct: st.cpu,
    tempC: st.temp,
    ip: '10.0.0.1',
  });

  const push = (line: JournalLine): void => {
    fleet.pushJournalLine(id, line);
    broadcast({ type: 'journal', pi: id, line });
  };

  const tick = (): void => {
    if (st.offline) return;
    st.cpu = clamp(st.cpu + rand(-st.cpuTrend * 4, st.cpuTrend * 4) + (st.cpu < 5 ? 1 : 0), 2, 99);
    st.mem = clamp(st.mem + rand(-1, 1.2) + (st.mem > 90 ? 0.5 : 0), 5, 99);
    st.disk = clamp(st.disk + st.diskTrend, 1, 99.9);
    st.temp = clamp(st.temp + st.tempTrend + rand(-0.5, 0.5), 35, 97);
    st.load = clamp(st.load + rand(-0.3, 0.4), 0.05, 8);
  };

  // health tick
  timers.push(setInterval(() => {
    if (st.offline) {
      fleet.setProbingResult(id, false, 'mock: host offline');
      return;
    }
    if (st.lastUp === 0) {
      // Pretend it booted a while ago; announce the boot once.
      st.lastUp = Date.now() - randInt(20_000, 90_000) * 1000;
      push({ at: Date.now() - 40_000, level: 'info', unit: 'systemd', message: 'Started Mock Fleet Agent.' });
    }
    tick();
    fleet.updateMetrics(id, currentMetrics());
  }, config.probeIntervalMs));

  // network traffic (cumulative counters; the fleet derives bps)
  timers.push(setInterval(() => {
    if (st.offline) return;
    const dtSec = config.netIntervalMs / 1000;
    const burst = Math.random() < 0.15 ? rand(3, 8) : 1;
    st.rxBytes += st.rx * burst * dtSec;
    st.txBytes += st.tx * burst * dtSec;
    fleet.updateNetwork(id, { wlan0: { rx: st.rxBytes, tx: st.txBytes } });
  }, config.netIntervalMs));

  // package state (slow cadence; seeded immediately at startup below)
  const probePkgs = (): void => {
    if (st.offline) return;
    if (id === 'mock-delta' && st.oomEvery > 0) {
      fleet.setPackages(id, {
        total: 12,
        security: 8,
        list: [
          'openssl:bookworm-security 3.0.13-1~deb12u2',
          'libc6:bookworm-security 2.36-9+deb12u9',
          'bash:bookworm-security 5.2.15-2+b7',
        ],
      });
    } else if (id === 'mock-bravo') {
      fleet.setPackages(id, {
        total: 5,
        security: 0,
        list: ['curl:bookworm 7.88.1-10+deb12u5', 'git:bookworm 2.39.2-1.1'],
      });
    } else {
      fleet.setPackages(id, { total: 0, security: 0, list: [] });
    }
  };
  timers.push(setInterval(probePkgs, config.pkgIntervalMs));

  // journal chatter (OOM storm for delta)
  let oomCounter = 0;
  timers.push(setInterval(() => {
    if (st.offline) return;
    if (st.oomEvery > 0) {
      oomCounter += 1;
      if (oomCounter % st.oomEvery === 0) {
        const procs = ['python3', 'camd', 'gphoto2', 'node', 'ffmpeg'];
        const proc = procs[randInt(0, procs.length - 1)] ?? 'python3';
        push({
          at: Date.now(),
          level: 'oom',
          unit: 'kernel',
          message: `oom-killer: Killed process ${randInt(1000, 9000)} (${proc}) total-vm:201324kB, anon-rss:154884kB`,
        });
      }
    }
    if (Math.random() < 0.2) {
      push({
        at: Date.now(),
        level: 'info',
        unit: 'mockd',
        message: `heartbeat ok (mock ${id})`,
      });
    }
  }, config.journalIntervalMs));

  return {
    async probeHealth(): Promise<void> {
      if (st.offline) {
        fleet.setProbingResult(id, false, 'mock: host offline');
        return;
      }
      tick();
      fleet.updateMetrics(id, currentMetrics());
    },

    async probeNet(): Promise<void> {
      // traffic is driven by the net interval above
    },

    async probePkgs(): Promise<void> {
      probePkgs();
    },

    async startJournal({ onLine }): Promise<() => void> {
      // The shared journal interval already pushes + broadcasts lines for
      // every Pi; a subscribed viewer additionally gets a heartbeat so the
      // live tail visibly moves even on quiet Pis.
      const t = setInterval(() => {
        if (st.offline) return;
        onLine({
          at: Date.now(),
          level: 'info',
          unit: 'mockd',
          message: `live tail tick for ${id}`,
        });
      }, Math.max(500, config.journalIntervalMs * 10));
      timers.push(t);
      return () => clearInterval(t);
    },

    stopJournal(): void {
      // no per-viewer stream to stop in the mock
    },
  };
}

export function startMockFleet(opts: {
  fleet: Fleet;
  probers: Map<string, Prober>;
  broadcast: (msg: WsServerMsg) => void;
  config: MockIntervals;
}): MockFleet {
  const timers: NodeJS.Timeout[] = [];

  for (const seed of defs) {
    opts.fleet.addPi({
      id: seed.id,
      name: seed.name,
      ip: seed.ip,
      source: 'mock',
    });
    const st = initState(seed.profile);
    const prober = makeMockProber(seed.id, st, {
      broadcast: opts.broadcast,
      fleet: opts.fleet,
      timers,
      config: opts.config,
    });
    opts.probers.set(seed.id, prober);
  }

  // Seed package state immediately so the UI isn't empty, and give every
  // online Pi a first health sample so the dashboard isn't blank.
  for (const seed of defs) {
    const prober = opts.probers.get(seed.id);
    if (prober) {
      void prober.probePkgs();
      void prober.probeHealth();
    }
  }

  return {
    stop(): void {
      for (const t of timers) clearInterval(t);
    },
  };
}
