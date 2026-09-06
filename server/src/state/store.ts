// Fleet persistence: an sqlite mirror of the in-memory fleet so Pi
// membership, telemetry history, journal tails and package state survive
// server restarts.
//
// Uses node:sqlite (built into Node — no native dependencies). The store is
// a passive mirror: the in-memory Fleet remains the source of truth while
// the server runs and calls the write side of this interface; on startup,
// `loadAll()` hands a snapshot back to `Fleet.restore()`.
//
// Bounded growth: every append prunes its series to the same capacity the
// in-memory rings use, so the database cannot grow across restart cycles.

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { JournalLine, PiSource } from '../types.js';

export type ScalarSeries = 'cpu' | 'mem' | 'disk' | 'temp' | 'load';

export interface StoredPi {
  id: string;
  name: string;
  ip: string;
  user: string | null;
  sshHost: string | null;
  sshPort: number;
  source: PiSource;
  addedAt: number;
}

/** The membership fields persisted per Pi (a subset of PiState). */
export interface PiMembership {
  id: string;
  name: string;
  ip: string;
  user?: string | null;
  sshHost?: string | null;
  sshPort: number;
  source: PiSource;
  addedAt: number;
}

export interface StoredPoint {
  at: number;
  value: number | null;
}

export interface StoredNetSample {
  at: number;
  rxBps: number;
  txBps: number;
}

export interface StoredPkgs {
  total: number;
  security: number;
  list: string[];
  at: number;
  checked: boolean;
}

export interface StoredFleet {
  pis: StoredPi[];
  /** pi id → series → points, oldest first */
  hist: Record<string, Partial<Record<ScalarSeries, StoredPoint[]>>>;
  /** pi id → interface → samples, oldest first */
  net: Record<string, Record<string, StoredNetSample[]>>;
  /** pi id → retained lines (oldest first; ordering = insertion order) */
  journal: Record<string, JournalLine[]>;
  pkgs: Record<string, StoredPkgs>;
}

/** The capacities the in-memory rings use — the store prunes to these. */
export interface FleetStorageCaps {
  historyPoints: number;
  netHistoryPoints: number;
  journalLines: number;
}

/** Write side of persistence — what the Fleet calls into. */
export interface FleetStorage {
  upsertPi(p: PiMembership): void;
  removePi(id: string): void;
  appendScalar(piId: string, series: ScalarSeries, at: number, value: number | null): void;
  appendNet(piId: string, iface: string, s: StoredNetSample): void;
  appendJournal(piId: string, line: JournalLine): void;
  setPkgs(piId: string, p: StoredPkgs): void;
  close(): void;
}

/** FleetStorage plus startup loading. */
export interface FleetStore extends FleetStorage {
  loadAll(): StoredFleet;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pis (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ip TEXT NOT NULL,
  user TEXT,
  ssh_host TEXT,
  ssh_port INTEGER NOT NULL,
  source TEXT NOT NULL,
  added_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS hist (
  seq INTEGER PRIMARY KEY,
  pi_id TEXT NOT NULL,
  series TEXT NOT NULL,
  at INTEGER NOT NULL,
  has_value INTEGER NOT NULL,
  v1 REAL,
  v2 REAL
);
CREATE INDEX IF NOT EXISTS hist_pi_series ON hist (pi_id, series, seq);
CREATE TABLE IF NOT EXISTS journal (
  seq INTEGER PRIMARY KEY,
  pi_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  level TEXT NOT NULL,
  unit TEXT NOT NULL,
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS journal_pi ON journal (pi_id, seq);
CREATE TABLE IF NOT EXISTS pkgs (
  pi_id TEXT PRIMARY KEY,
  total INTEGER NOT NULL,
  security INTEGER NOT NULL,
  list_json TEXT NOT NULL,
  at INTEGER NOT NULL,
  checked INTEGER NOT NULL
);
`;

interface HistRow {
  pi_id: string;
  series: string;
  at: number;
  has_value: number;
  v1: number | null;
  v2: number | null;
}
interface JournalRow {
  seq: number;
  pi_id: string;
  at: number;
  level: string;
  unit: string;
  message: string;
}

/**
 * Open (or create) the fleet database. `file` may be a path or ':memory:'.
 * WAL mode keeps membership rows crash-safe; the single-writer (one server
 * process) assumption holds by design.
 */
export function openFleetStore(file: string, caps: FleetStorageCaps): FleetStore {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);

  const st = {
    piUpsert: db.prepare(
      `INSERT INTO pis (id, name, ip, user, ssh_host, ssh_port, source, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, ip = excluded.ip,
         user = excluded.user, ssh_host = excluded.ssh_host, ssh_port = excluded.ssh_port,
         source = excluded.source, added_at = excluded.added_at`,
    ),
    piDelete: db.prepare('DELETE FROM pis WHERE id = ?'),
    histInsert: db.prepare(
      'INSERT INTO hist (pi_id, series, at, has_value, v1, v2) VALUES (?, ?, ?, ?, ?, ?)',
    ),
    histPrune: db.prepare(
      `DELETE FROM hist WHERE pi_id = ? AND series = ? AND seq NOT IN
         (SELECT seq FROM hist WHERE pi_id = ? AND series = ?
          ORDER BY seq DESC LIMIT ?)`,
    ),
    histDeletePi: db.prepare('DELETE FROM hist WHERE pi_id = ?'),
    journalInsert: db.prepare(
      'INSERT INTO journal (pi_id, at, level, unit, message) VALUES (?, ?, ?, ?, ?)',
    ),
    journalPrune: db.prepare(
      `DELETE FROM journal WHERE pi_id = ? AND seq NOT IN
         (SELECT seq FROM journal WHERE pi_id = ? ORDER BY seq DESC LIMIT ?)`,
    ),
    journalDeletePi: db.prepare('DELETE FROM journal WHERE pi_id = ?'),
    pkgsUpsert: db.prepare(
      `INSERT INTO pkgs (pi_id, total, security, list_json, at, checked)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (pi_id) DO UPDATE SET total = excluded.total,
         security = excluded.security, list_json = excluded.list_json,
         at = excluded.at, checked = excluded.checked`,
    ),
    pkgsDeletePi: db.prepare('DELETE FROM pkgs WHERE pi_id = ?'),
    allPis: db.prepare(
      'SELECT id, name, ip, user, ssh_host, ssh_port, source, added_at FROM pis ORDER BY added_at',
    ),
    allHist: db.prepare('SELECT pi_id, series, at, has_value, v1, v2 FROM hist ORDER BY seq'),
    allJournal: db.prepare('SELECT seq, pi_id, at, level, unit, message FROM journal ORDER BY seq'),
    allPkgs: db.prepare('SELECT pi_id, total, security, list_json, at, checked FROM pkgs'),
  };

  return {
    upsertPi(p: PiMembership): void {
      st.piUpsert.run(p.id, p.name, p.ip, p.user ?? null, p.sshHost ?? null, p.sshPort, p.source, p.addedAt);
    },

    removePi(id: string): void {
      st.piDelete.run(id);
      st.histDeletePi.run(id);
      st.journalDeletePi.run(id);
      st.pkgsDeletePi.run(id);
    },

    appendScalar(piId: string, series: ScalarSeries, at: number, value: number | null): void {
      st.histInsert.run(piId, series, at, value === null ? 0 : 1, value ?? 0, null);
      st.histPrune.run(piId, series, piId, series, caps.historyPoints);
    },

    appendNet(piId: string, iface: string, s: StoredNetSample): void {
      const series = `net:${iface}`;
      st.histInsert.run(piId, series, s.at, 1, s.rxBps, s.txBps);
      st.histPrune.run(piId, series, piId, series, caps.netHistoryPoints);
    },

    appendJournal(piId: string, line: JournalLine): void {
      st.journalInsert.run(piId, line.at, line.level, line.unit, line.message);
      st.journalPrune.run(piId, piId, caps.journalLines);
    },

    setPkgs(piId: string, p: StoredPkgs): void {
      st.pkgsUpsert.run(piId, p.total, p.security, JSON.stringify(p.list), p.at, p.checked ? 1 : 0);
    },

    loadAll(): StoredFleet {
      const out: StoredFleet = { pis: [], hist: {}, net: {}, journal: {}, pkgs: {} };
      for (const r of st.allPis.all() as unknown as Array<{
        id: string; name: string; ip: string; user: string | null; ssh_host: string | null;
        ssh_port: number; source: string; added_at: number;
      }>) {
        out.pis.push({
          id: r.id,
          name: r.name,
          ip: r.ip,
          user: r.user,
          sshHost: r.ssh_host,
          sshPort: r.ssh_port,
          source: r.source as PiSource,
          addedAt: r.added_at,
        });
      }
      for (const r of st.allHist.all() as unknown as HistRow[]) {
        if (r.series.startsWith('net:')) {
          const per = (out.net[r.pi_id] ??= {});
          (per[r.series.slice(4)] ??= []).push({ at: r.at, rxBps: r.v1 ?? 0, txBps: r.v2 ?? 0 });
        } else {
          const per = (out.hist[r.pi_id] ??= {});
          (per[r.series as ScalarSeries] ??= []).push({
            at: r.at,
            value: r.has_value ? r.v1 : null,
          });
        }
      }
      for (const r of st.allJournal.all() as unknown as JournalRow[]) {
        (out.journal[r.pi_id] ??= []).push({
          at: r.at,
          level: r.level as JournalLine['level'],
          unit: r.unit,
          message: r.message,
        });
      }
      for (const r of st.allPkgs.all() as unknown as Array<{
        pi_id: string; total: number; security: number; list_json: string; at: number; checked: number;
      }>) {
        out.pkgs[r.pi_id] = {
          total: r.total,
          security: r.security,
          list: JSON.parse(r.list_json) as string[],
          at: r.at,
          checked: r.checked === 1,
        };
      }
      return out;
    },

    close(): void {
      db.close();
    },
  };
}
