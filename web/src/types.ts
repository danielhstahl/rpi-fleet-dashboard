// Wire-protocol types shared between dashboard and server (mirrors
// server/src/types.ts for the messages that cross the ws/REST boundary).

export type Severity = 'critical' | 'warning' | 'info';
export type JournalLevel = 'info' | 'warn' | 'error' | 'oom';

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

export interface NetSample {
  at: number;
  rxBps: number;
  txBps: number;
}

export interface SnapshotPkgs {
  total: number;
  security: number;
  checked: boolean;
}

export interface SparkData {
  cpu: number[];
  mem: number[];
  disk: number[];
  temp: Array<number | null>;
  load: number[];
}

export interface SnapshotPi {
  id: string;
  name: string;
  ip: string;
  source: string;
  online: boolean;
  score: number;
  upgrading: boolean;
  probeFailures: number;
  attention: AttentionItem[];
  metrics: Metrics | null;
  net: Record<string, NetSample>;
  pkgs: SnapshotPkgs;
  spark: SparkData;
}

export interface FleetSnapshot {
  at: number;
  pis: SnapshotPi[];
}

export interface JournalLine {
  at: number;
  level: JournalLevel;
  unit: string;
  message: string;
}

/** Upgrade progress state for one Pi (accumulated from ws 'upgrade' msgs). */
export interface UpgradeState {
  lines: string[];
  /** undefined while running, true/false once finished */
  done: boolean | null;
}

export type WsServerMsg =
  | { type: 'fleet'; data: FleetSnapshot }
  | { type: 'journal'; pi: string; line: JournalLine }
  | { type: 'upgrade'; pi: string; line?: string; done?: boolean; ok?: boolean };

export type WsClientMsg =
  | { type: 'subscribe'; pi: string }
  | { type: 'unsubscribe'; pi: string };

/** [timestamp, value] history point (GET /api/pis/:id). */
export type HistPoint<T = number> = [number, T];

export interface PiDetailData {
  id: string;
  name: string;
  ip: string;
  user: string;
  sshPort: number;
  source: string;
  addedAt: number;
  online: boolean;
  probeFailures: number;
  lastProbeAt: number;
  lastProbeError: string | null;
  metrics: Metrics | null;
  net: Record<string, NetSample>;
  hist: {
    cpu: HistPoint[];
    mem: HistPoint[];
    disk: HistPoint[];
    temp: HistPoint<number | null>[];
    load: HistPoint[];
  };
  netHistory: Record<string, HistPoint<NetSample>[]>;
  pkgs: { total: number; security: number; list: string[]; at: number; checked: boolean };
  upgrading: boolean;
  journal: {
    lines: JournalLine[];
    oomCount: number;
    errorCount: number;
    lastOom: string | null;
    lastError: string | null;
  };
  attention: AttentionItem[];
  score: number;
}
