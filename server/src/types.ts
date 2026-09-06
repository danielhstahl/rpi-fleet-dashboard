// Shared domain types for the fleet manager.

import { Ring } from './state/ring.js';

export type Severity = 'critical' | 'warning' | 'info';

export interface AttentionItem {
  severity: Severity;
  rule: string;
  title: string;
  detail: string;
  since?: number;
}

export interface Metrics {
  at: number;
  uptimeSec: number;
  load1: number;
  cores: number;
  memPct: number;
  diskPct: number;
  cpuPct: number;
  tempC: number | null;
  ip: string | null;
}

/** Metrics as reported by a probe: `at`/`ip` filled in by the fleet. */
export type MetricsInput = Omit<Metrics, 'at' | 'ip'> & { at?: number; ip?: string | null };

export interface PkgUpdate {
  total: number;
  security: number;
  list: string[];
}

export interface PkgState {
  total: number;
  security: number;
  list: string[];
  at: number;
  checked: boolean;
}

export type JournalLevel = 'info' | 'warn' | 'error' | 'oom';

export interface JournalLine {
  at: number;
  level: JournalLevel;
  unit: string;
  message: string;
}

/** Journal counts are windowed (see Fleet.journalWindowMs). */
export interface JournalCounts {
  oomCount?: number;
  errorCount?: number;
}

export interface JournalState {
  lines: JournalLine[];
  oomCount: number;
  errorCount: number;
  lastOom: string | null;
  lastError: string | null;
}

export interface NetSample {
  rxBps: number;
  txBps: number;
  at: number;
}

interface NetPrev {
  rx: number;
  tx: number;
  at: number;
}

export type PiSource = 'mdns' | 'manual' | 'mock';

export interface PiState {
  id: string;
  name: string;
  ip: string;
  /** Explicit SSH user; when unset, `~/.ssh/config` decides. */
  user?: string;
  /** Optional ssh-config host alias used instead of the IP for connecting. */
  sshHost?: string;
  sshPort: number;
  source: PiSource;
  addedAt: number;
  online: boolean;
  probeFailures: number;
  lastProbeAt: number;
  lastProbeError: string | null;
  metrics: Metrics | null;
  net: Record<string, NetSample>;
  netHistory: Record<string, Ring<NetSample>>;
  hist: {
    cpu: Ring<number>;
    mem: Ring<number>;
    disk: Ring<number>;
    temp: Ring<number | null>;
    load: Ring<number>;
  };
  pkgs: PkgState;
  journal: JournalState;
  attention: AttentionItem[];
  score: number;
  /** internal: previous raw byte counters for traffic deltas. Never serialized to clients. */
  _netPrev?: Record<string, NetPrev>;
}

export interface SnapshotAttention {
  severity: Severity;
  rule: string;
  title: string;
  detail: string;
  since?: number;
}

export interface SnapshotMetrics {
  at: number;
  uptimeSec: number;
  load1: number;
  cores: number;
  memPct: number;
  diskPct: number;
  cpuPct: number;
  tempC: number | null;
  ip: string | null;
}

export interface SnapshotPi {
  id: string;
  name: string;
  ip: string;
  source: PiSource;
  online: boolean;
  score: number;
  probeFailures: number;
  attention: SnapshotAttention[];
  metrics: SnapshotMetrics | null;
  net: Record<string, NetSample>;
  pkgs: { total: number; security: number; checked: boolean };
  spark: {
    cpu: number[];
    mem: number[];
    temp: Array<number | null>;
    load: number[];
    disk: number[];
  };
}

export interface FleetSnapshot {
  at: number;
  pis: SnapshotPi[];
}

export interface PiHistSeries {
  cpu: Array<[number, number]>;
  mem: Array<[number, number]>;
  disk: Array<[number, number]>;
  temp: Array<[number, number | null]>;
  load: Array<[number, number]>;
}

/** Full Pi detail as served by GET /api/pis/:id (rings expanded to series). */
export interface PiDetail extends Omit<PiState, 'hist' | 'netHistory' | '_netPrev'> {
  hist: PiHistSeries;
  netHistory: Record<string, Array<[number, NetSample]>>;
}

export interface JournalOpts {
  onLine: (line: JournalLine) => void;
  onExit?: (code: number) => void;
}

/**
 * Contract every Pi back-end (real SSH prober, mock prober) must satisfy.
 * The engine and API only ever speak this interface, so mocks and real
 * Pis are interchangeable.
 */
export interface Prober {
  probeHealth(): Promise<void>;
  probeNet(): Promise<void>;
  probePkgs(): Promise<void>;
  /** Starts a live journal tail; resolves with a function that stops it. */
  startJournal(opts: JournalOpts): Promise<() => void>;
  stopJournal(): void;
}

export interface MockFleet {
  stop(): void;
}

export type WsServerMsg =
  | { type: 'fleet'; data: FleetSnapshot }
  | { type: 'journal'; pi: string; line: JournalLine };

export type WsClientMsg = { type: 'subscribe' | 'unsubscribe'; pi: string };
