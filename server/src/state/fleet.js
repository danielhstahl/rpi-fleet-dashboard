import { Ring } from './ring.js';
import { evaluateAttention, scoreItems } from './attention.js';

/**
 * In-memory fleet state. One Pi record per machine; ring buffers hold
 * history; attention items are recomputed on every state mutation.
 */
export class Fleet {
  constructor(opts = {}) {
    this.historyPoints = opts.historyPoints ?? 240;
    this.netHistoryPoints = opts.netHistoryPoints ?? 360;
    this.journalCap = opts.journalLines ?? 500;
    this.journalWindowMs = opts.journalWindowMs ?? 60 * 60 * 1000;
    this.pis = new Map();
    /** id -> listener(pi) called when a Pi is added */
    this.onAdd = null;
    this.onRemove = null;
  }

  addPi({ id, name, ip, user = 'pi', sshPort = 22, source = 'manual', auth }) {
    if (this.pis.has(id)) return this.pis.get(id);
    const pi = {
      id,
      name: name || id,
      ip,
      user,
      sshPort,
      source, // 'mdns' | 'manual' | 'mock'
      auth, // {type:'key'|'password'}
      addedAt: Date.now(),
      online: false,
      probeFailures: 0,
      lastProbeAt: 0,
      lastProbeError: null,
      metrics: null, // {at, uptimeSec, load1, cores, memPct, diskPct, cpuPct, tempC, ip}
      net: {}, // iface -> {rxBps, txBps, at}
      netHistory: {}, // iface -> Ring
      pkgs: { total: 0, security: 0, list: [], at: 0, checked: false },
      upgrading: false,
      journal: { lines: [], oomCount: 0, errorCount: 0, lastOom: null, lastError: null },
      attention: [],
      score: 0,
    };
    const hist = (cap) => new Ring(cap);
    pi.hist = { cpu: hist(this.historyPoints), mem: hist(this.historyPoints), disk: hist(this.historyPoints), temp: hist(this.historyPoints), load: hist(this.historyPoints) };
    this.pis.set(id, pi);
    this.recompute(pi);
    this.onAdd?.(pi);
    return pi;
  }

  removePi(id) {
    const pi = this.pis.get(id);
    if (!pi) return false;
    this.pis.delete(id);
    this.onRemove?.(pi);
    return true;
  }

  get(id) {
    return this.pis.get(id);
  }

  list() {
    return [...this.pis.values()];
  }

  /** Sorted worst-first: highest attention score, then name. */
  sorted() {
    return this.list().sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }

  setProbingResult(id, ok, error = null) {
    const pi = this.get(id);
    if (!pi) return;
    pi.lastProbeAt = Date.now();
    if (ok) {
      pi.online = true;
      pi.probeFailures = 0;
      pi.lastProbeError = null;
    } else {
      pi.probeFailures += 1;
      pi.lastProbeError = String(error || 'probe failed').slice(0, 200);
      if (pi.probeFailures >= 3) pi.online = false;
    }
    this.recompute(pi);
  }

  updateMetrics(id, m) {
    const pi = this.get(id);
    if (!pi) return;
    const at = Date.now();
    pi.metrics = { ...m, at };
    pi.hist.cpu.push(m.cpuPct ?? 0, at);
    pi.hist.mem.push(m.memPct ?? 0, at);
    pi.hist.disk.push(m.diskPct ?? 0, at);
    pi.hist.temp.push(m.tempC ?? null, at);
    pi.hist.load.push(m.load1 ?? 0, at);
    this.recompute(pi);
  }

  /** counters: {iface: {rx, tx}} raw byte counters; bps computed from delta. */
  updateNetwork(id, counters) {
    const pi = this.get(id);
    if (!pi) return;
    const at = Date.now();
    const prev = pi._netPrev || {};
    const next = {};
    for (const [iface, c] of Object.entries(counters)) {
      const ring = (pi.netHistory[iface] ||= new Ring(this.netHistoryPoints));
      const p = prev[iface];
      let rxBps = 0;
      let txBps = 0;
      if (p && at > p.at) {
        const dt = (at - p.at) / 1000;
        rxBps = Math.max(0, (c.rx - p.rx) / dt);
        txBps = Math.max(0, (c.tx - p.tx) / dt);
      }
      ring.push({ rx: rxBps, tx: txBps }, at);
      pi.net[iface] = { rxBps, txBps, at };
      next[iface] = { rx: c.rx, tx: c.tx, at };
    }
    pi._netPrev = next;
  }

  pushJournalLine(id, line) {
    const pi = this.get(id);
    if (!pi || !line) return;
    const j = pi.journal;
    const at = line.at || Date.now();
    j.lines.push(line);
    if (j.lines.length > this.journalCap) j.lines.splice(0, j.lines.length - this.journalCap);
    this.pruneJournal(pi);
    this.recompute(pi);
  }

  pruneJournal(pi) {
    const j = pi.journal;
    // Window is relative to the newest log event (deterministic, and correct
    // even if the server was idle while the Pi kept logging).
    let maxAt = 0;
    for (const l of j.lines) if (l.at > maxAt) maxAt = l.at;
    const cutoff = maxAt - this.journalWindowMs;
    while (j.lines.length && j.lines[0].at < cutoff) j.lines.shift();
    let oom = 0;
    let errs = 0;
    let lastOom = null;
    let lastErr = null;
    for (const l of j.lines) {
      if (l.level === 'oom') { oom++; lastOom = l.message; }
      if (l.level === 'error') { errs++; lastErr = `${l.unit}: ${l.message}`.slice(0, 200); }
    }
    j.oomCount = oom;
    j.errorCount = errs;
    j.lastOom = lastOom;
    j.lastError = lastErr;
  }

  setPackages(id, { total = 0, security = 0, list = [] }) {
    const pi = this.get(id);
    if (!pi) return;
    pi.pkgs = { total, security, list: list.slice(0, 200), at: Date.now(), checked: true };
    this.recompute(pi);
  }

  setUpgrading(id, upgrading) {
    const pi = this.get(id);
    if (!pi) return;
    pi.upgrading = !!upgrading;
    this.recompute(pi);
  }

  recompute(pi) {
    const prev = pi.attention || [];
    const items = evaluateAttention(pi);
    const now = Date.now();
    for (const it of items) {
      const p = prev.find((x) => x.rule === it.rule);
      it.since = p ? p.since : now;
    }
    pi.attention = items;
    pi.score = scoreItems(items);
    return items;
  }

  /** Lightweight payload for the 5s ws broadcast. */
  snapshot() {
    const last24 = (r) => r.series().slice(-24);
    return {
      at: Date.now(),
      pis: this.list().map((pi) => ({
        id: pi.id,
        name: pi.name,
        ip: pi.ip,
        source: pi.source,
        online: pi.online,
        score: pi.score,
        upgrading: pi.upgrading,
        probeFailures: pi.probeFailures,
        attention: pi.attention.map((a) => ({ severity: a.severity, rule: a.rule, title: a.title, detail: a.detail, since: a.since })),
        metrics: pi.metrics
          ? {
              at: pi.metrics.at,
              cpuPct: pi.metrics.cpuPct,
              memPct: pi.metrics.memPct,
              diskPct: pi.metrics.diskPct,
              tempC: pi.metrics.tempC,
              load1: pi.metrics.load1,
              cores: pi.metrics.cores,
              uptimeSec: pi.metrics.uptimeSec,
            }
          : null,
        net: Object.fromEntries(
          Object.entries(pi.net).map(([iface, v]) => [iface, { rxBps: Math.round(v.rxBps), txBps: Math.round(v.txBps), at: v.at }])
        ),
        pkgs: { total: pi.pkgs.total, security: pi.pkgs.security, checked: pi.pkgs.checked },
        spark: { cpu: last24(pi.hist.cpu), mem: last24(pi.hist.mem), disk: last24(pi.hist.disk), temp: last24(pi.hist.temp) },
      })),
    };
  }

  /** Full detail payload (with history) for /api/pis/:id. */
  detail(id) {
    const pi = this.get(id);
    if (!pi) return null;
    return {
      ...pi,
      hist: {
        cpu: pi.hist.cpu.series(),
        mem: pi.hist.mem.series(),
        disk: pi.hist.disk.series(),
        temp: pi.hist.temp.series(),
        load: pi.hist.load.series(),
      },
      netHistory: Object.fromEntries(Object.entries(pi.netHistory).map(([iface, r]) => [iface, r.series()])),
    };
  }
}

export default Fleet;
