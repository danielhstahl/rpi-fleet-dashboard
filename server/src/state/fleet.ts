// In-memory fleet state: one PiState per machine, bounded history rings,
// windowed journal counts, and the attention list recomputed on every
// change.

import type {
  AttentionItem,
  FleetSnapshot,
  JournalLine,
  Metrics,
  MetricsInput,
  PiAuth,
  PiDetail,
  PiSource,
  PiState,
  PkgUpdate,
} from '../types.js';
import { Ring } from './ring.js';
import { evaluateAttention, scoreItems } from './attention.js';

export interface FleetOptions {
  /** health history ring capacity (default: ~3h at 15s cadence) */
  historyPoints?: number;
  /** per-interface network history capacity */
  netHistoryPoints?: number;
  /** journal lines kept per Pi */
  journalLines?: number;
  /** window (ms) for OOM / error counts, relative to the newest line */
  journalWindowMs?: number;
}

export interface AddPiOpts {
  id?: string;
  name: string;
  ip: string;
  user?: string;
  sshPort?: number;
  source?: PiSource;
  auth?: PiAuth;
}

export type FleetEvent =
  | { type: 'add'; pi: PiState }
  | { type: 'remove'; id: string; name: string };

interface NetPrev {
  rx: number;
  tx: number;
  at: number;
}

/** A fresh Pi with all fields in a known state. Shared by the fleet and tests. */
export function blankPi(id: string, name: string, ip: string): PiState {
  return {
    id,
    name,
    ip,
    user: 'pi',
    sshPort: 22,
    source: 'manual',
    addedAt: Date.now(),
    online: false,
    probeFailures: 0,
    lastProbeAt: 0,
    lastProbeError: null,
    metrics: null,
    net: {},
    netHistory: {},
    hist: {
      cpu: new Ring<number>(),
      mem: new Ring<number>(),
      disk: new Ring<number>(),
      temp: new Ring<number | null>(),
      load: new Ring<number>(),
    },
    pkgs: { total: 0, security: 0, list: [], at: 0, checked: false },
    upgrading: false,
    journal: { lines: [], oomCount: 0, errorCount: 0, lastOom: null, lastError: null },
    attention: [],
    score: 0,
  };
}

export class Fleet {
  private pis: Map<string, PiState> = new Map();
  private opts: Required<FleetOptions>;
  onEvent: ((ev: FleetEvent) => void) | null = null;

  constructor(opts: FleetOptions = {}) {
    this.opts = {
      historyPoints: opts.historyPoints ?? 720,
      netHistoryPoints: opts.netHistoryPoints ?? 720,
      journalLines: opts.journalLines ?? 400,
      journalWindowMs: opts.journalWindowMs ?? 3_600_000,
    };
  }

  // ------------------------------------------------------------ identity --

  private genId(name: string, ip: string): string {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'pi';
    // Same IP as an existing Pi → treat as the same machine.
    for (const [existingId, p] of this.pis) {
      if (p.ip === ip) return existingId;
    }
    let id = base;
    let n = 2;
    while (this.pis.has(id)) id = `${base}-${n++}`;
    return id;
  }

  addPi(opts: AddPiOpts): PiState {
    const id = opts.id ?? this.genId(opts.name, opts.ip);
    const existing = this.pis.get(id);
    if (existing) return existing;

    const pi = blankPi(id, opts.name, opts.ip);
    pi.user = opts.user ?? 'pi';
    pi.sshPort = opts.sshPort ?? 22;
    pi.source = opts.source ?? 'manual';
    pi.auth = opts.auth;
    const cap = this.opts.historyPoints;
    pi.hist = {
      cpu: new Ring<number>(cap),
      mem: new Ring<number>(cap),
      disk: new Ring<number>(cap),
      temp: new Ring<number | null>(cap),
      load: new Ring<number>(cap),
    };
    this.pis.set(id, pi);
    this.recompute(pi);
    this.onEvent?.({ type: 'add', pi });
    return pi;
  }

  removePi(id: string): boolean {
    const pi = this.pis.get(id);
    if (!pi) return false;
    this.pis.delete(id);
    this.onEvent?.({ type: 'remove', id, name: pi.name });
    return true;
  }

  get(id: string): PiState | undefined {
    return this.pis.get(id);
  }

  list(): PiState[] {
    return [...this.pis.values()];
  }

  /** All Pis, worst score first. */
  sorted(): PiState[] {
    return this.list().sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }

  recompute(p: PiState): void {
    p.attention = evaluateAttention(p);
    p.score = scoreItems(p.attention);
  }

  // ------------------------------------------------------------ updates --

  /** Health probe result. Success clears failures; 3 straight misses → offline. */
  setProbingResult(id: string, ok: boolean, error?: string): void {
    const p = this.pis.get(id);
    if (!p) return;
    p.lastProbeAt = Date.now();
    if (ok) {
      p.probeFailures = 0;
      p.lastProbeError = null;
      p.online = true;
    } else {
      p.probeFailures += 1;
      p.lastProbeError = error ?? null;
      if (p.probeFailures >= 3) p.online = false;
    }
    this.recompute(p);
  }

  updateMetrics(id: string, m: MetricsInput): void {
    const p = this.pis.get(id);
    if (!p) return;
    const at = m.at ?? Date.now();
    const metrics: Metrics = {
      uptimeSec: m.uptimeSec,
      load1: m.load1,
      cores: m.cores,
      memPct: m.memPct,
      diskPct: m.diskPct,
      cpuPct: m.cpuPct,
      tempC: m.tempC,
      ip: m.ip ?? null,
      at,
    };
    p.metrics = metrics;
    p.probeFailures = 0;
    p.lastProbeError = null;
    p.online = true;
    p.lastProbeAt = Date.now();
    p.hist.cpu.push(metrics.cpuPct, at);
    p.hist.mem.push(metrics.memPct, at);
    p.hist.disk.push(metrics.diskPct, at);
    p.hist.temp.push(metrics.tempC, at);
    p.hist.load.push(metrics.load1, at);
    this.recompute(p);
  }

  /**
   * Raw per-interface byte counters → bps via delta against the previous
   * sample. Counters that moved backwards (reboot/interface reset) restart
   * the baseline.
   */
  updateNetwork(id: string, counters: Record<string, { rx: number; tx: number }>): void {
    const p = this.pis.get(id);
    if (!p) return;
    const prev = p._netPrev ?? (p._netPrev = {});
    const nowMs = Date.now();
    for (const [iface, c] of Object.entries(counters)) {
      const pr = prev[iface];
      if (pr && c.rx >= pr.rx && c.tx >= pr.tx && nowMs > pr.at) {
        const dt = (nowMs - pr.at) / 1000;
        const sample = { rxBps: (c.rx - pr.rx) / dt, txBps: (c.tx - pr.tx) / dt, at: nowMs };
        p.net[iface] = sample;
        let ring = p.netHistory[iface];
        if (!ring) {
          ring = new Ring<{ rxBps: number; txBps: number; at: number }>(this.opts.netHistoryPoints);
          p.netHistory[iface] = ring;
        }
        ring.push(sample, nowMs);
      }
      prev[iface] = { rx: c.rx, tx: c.tx, at: nowMs };
    }
  }

  pushJournalLine(id: string, line: JournalLine): void {
    const p = this.pis.get(id);
    if (!p) return;
    const j = p.journal;
    j.lines.push(line);
    if (j.lines.length > this.opts.journalLines) {
      j.lines.splice(0, j.lines.length - this.opts.journalLines);
    }
    if (line.level === 'oom') j.lastOom = line.message;
    else if (line.level === 'error') j.lastError = line.message;
    // Counts are windowed relative to the newest line we have (works for
    // real journals and mock journals alike, and is deterministic).
    const newest = line.at;
    j.oomCount = j.lines.filter((l) => l.level === 'oom' && newest - l.at <= this.opts.journalWindowMs).length;
    j.errorCount = j.lines.filter((l) => l.level === 'error' && newest - l.at <= this.opts.journalWindowMs).length;
    this.recompute(p);
  }

  tailJournal(id: string, n = 200): JournalLine[] {
    const p = this.pis.get(id);
    if (!p) return [];
    return p.journal.lines.slice(-n);
  }

  setPackages(id: string, pkgs: PkgUpdate): void {
    const p = this.pis.get(id);
    if (!p) return;
    p.pkgs = { ...pkgs, at: Date.now(), checked: true };
    this.recompute(p);
  }

  setUpgrading(id: string, v: boolean): void {
    const p = this.pis.get(id);
    if (!p) return;
    p.upgrading = v;
    this.recompute(p);
  }

  // ------------------------------------------------------------- outputs --

  snapshot(): FleetSnapshot {
    return {
      at: Date.now(),
      pis: this.list().map((p) => {
        const net: PiState['net'] = {};
        for (const [iface, s] of Object.entries(p.net)) net[iface] = s;
        const pk = p.pkgs;
        return {
          id: p.id,
          name: p.name,
          ip: p.ip,
          source: p.source,
          online: p.online,
          score: p.score,
          upgrading: p.upgrading,
          probeFailures: p.probeFailures,
          attention: p.attention.map((a) => ({
            severity: a.severity,
            rule: a.rule,
            title: a.title,
            detail: a.detail,
            since: a.since,
          })),
          metrics: p.metrics
            ? {
                at: p.metrics.at,
                uptimeSec: p.metrics.uptimeSec,
                load1: p.metrics.load1,
                cores: p.metrics.cores,
                memPct: p.metrics.memPct,
                diskPct: p.metrics.diskPct,
                cpuPct: p.metrics.cpuPct,
                tempC: p.metrics.tempC,
                ip: p.metrics.ip,
              }
            : null,
          net,
          pkgs: { total: pk.total, security: pk.security, checked: pk.checked },
          spark: {
            cpu: p.hist.cpu.spark(24).map((x) => x[1]),
            mem: p.hist.mem.spark(24).map((x) => x[1]),
            temp: p.hist.temp.spark(24).map((x) => x[1]),
            load: p.hist.load.spark(24).map((x) => x[1]),
            disk: p.metrics ? [p.metrics.diskPct] : [],
          },
        };
      }),
    };
  }

  detail(id: string): PiDetail | null {
    const p = this.pis.get(id);
    if (!p) return null;
    const { _netPrev: _internal, ...rest } = p;
    const netHistory: PiDetail['netHistory'] = {};
    for (const [iface, ring] of Object.entries(p.netHistory)) netHistory[iface] = ring.series();
    return {
      ...rest,
      hist: {
        cpu: p.hist.cpu.series(),
        mem: p.hist.mem.series(),
        disk: p.hist.disk.series(),
        temp: p.hist.temp.series(),
        load: p.hist.load.series(),
      },
      netHistory,
    };
  }
}
