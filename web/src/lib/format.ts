// Formatting + status helpers (pure, no React).

import type { SnapshotPi } from '../types';

export function fmtBytes(bps: number | null | undefined): string {
  if (bps == null || Number.isNaN(bps)) return '—';
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let v = bps;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const unit = units[i] ?? 'B/s';
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${unit}`;
}

/** Truncate a percentage for display: 91.05000000000001 -> "91%". */
export function pct(n: number | null | undefined): string {
  return n == null ? '—' : `${Math.trunc(n)}%`;
}

/** Truncate a temperature for display: 79.237 -> "79°C". */
export function tempC(n: number | null | undefined): string {
  return n == null ? '—' : `${Math.trunc(n)}°C`;
}

/** One-decimal-ish load average for display: 0.543219 -> "0.54". */
export function loadFmt(n: number | null | undefined): string {
  return n == null ? '—' : n.toFixed(2);
}

export function fmtUptime(sec: number | null | undefined): string {
  if (sec == null) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function fmtAgo(at: number | null | undefined, now: number = Date.now()): string {
  if (!at) return 'never';
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export type PiStatus = 'offline' | 'degraded' | 'attention' | 'ok';

export function statusOf(pi: Pick<SnapshotPi, 'online' | 'probeFailures' | 'score'>): PiStatus {
  if (!pi.online) return pi.probeFailures >= 3 ? 'offline' : 'degraded';
  if (pi.score > 0) return 'attention';
  return 'ok';
}
