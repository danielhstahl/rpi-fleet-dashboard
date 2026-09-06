// Attention engine: turns a Pi's state into a ranked list of things that
// need a human. This is the heart of the dashboard — everything the UI
// "points at" comes from here.
//
// Rules return an AttentionItem or null. The fleet stores the result per
// Pi and a score (sum of severity weights); the UI ranks Pis by score.

import type { AttentionItem, Metrics, Severity } from '../types.js';
import type { JournalCounts } from '../types.js';

const NOW = (): number => Date.now();
const MINUTE = 60_000;

export const WEIGHTS: Record<Severity, number> = {
  critical: 100,
  warning: 25,
  info: 1,
};

/** The slice of Pi state the rules actually read. PiState satisfies this. */
export interface AttentionInput {
  online: boolean;
  probeFailures: number;
  lastProbeError: string | null;
  lastProbeAt?: number;
  addedAt?: number;
  metrics: Metrics | null;
  pkgs: { total: number; security: number };
  journal: JournalCounts;
}

function item(severity: Severity, rule: string, title: string, detail: string, since?: number): AttentionItem {
  return { severity, rule, title, detail, since };
}

// ---------------------------------------------------------------- rules --

function ruleUnreachable(p: AttentionInput): AttentionItem | null {
  if (!p.online && p.probeFailures >= 3) {
    const since = p.lastProbeAt ?? p.addedAt;
    return item('critical', 'unreachable', 'Unreachable',
      `No SSH response after ${p.probeFailures} attempts${p.lastProbeError ? `: ${p.lastProbeError}` : ''}`, since);
  }
  return null;
}

function ruleUnstable(p: AttentionInput): AttentionItem | null {
  if (p.online && p.probeFailures >= 1) {
    return item('warning', 'unstable', 'Intermittent',
      `${p.probeFailures} failed probe(s) recently${p.lastProbeError ? `: ${p.lastProbeError}` : ''}`,
      p.lastProbeAt);
  }
  return null;
}

function ruleStale(p: AttentionInput): AttentionItem | null {
  if (p.online && p.metrics && NOW() - p.metrics.at > 5 * MINUTE) {
    return item('warning', 'stale', 'Stale telemetry',
      `Last metrics ${Math.round((NOW() - p.metrics.at) / MINUTE)} min ago`, p.metrics.at);
  }
  return null;
}

function ruleDisk(p: AttentionInput): AttentionItem | null {
  const m = p.metrics;
  if (!m) return null;
  if (m.diskPct >= 95) {
    return item('critical', 'disk', 'Disk almost full', `root filesystem at ${m.diskPct.toFixed(0)}%`, m.at);
  }
  if (m.diskPct >= 85) {
    return item('warning', 'disk', 'Disk filling up', `root filesystem at ${m.diskPct.toFixed(0)}%`, m.at);
  }
  return null;
}

function ruleMemory(p: AttentionInput): AttentionItem | null {
  const m = p.metrics;
  if (!m) return null;
  if (m.memPct >= 95) {
    return item('warning', 'memory', 'Memory pressure', `${m.memPct.toFixed(0)}% RAM used`, m.at);
  }
  return null;
}

function ruleTemp(p: AttentionInput): AttentionItem | null {
  const m = p.metrics;
  if (!m || m.tempC == null) return null;
  if (m.tempC >= 85) {
    return item('critical', 'temp', 'Thermal throttling', `SoC at ${m.tempC.toFixed(0)} °C — performance capped`, m.at);
  }
  if (m.tempC >= 75) {
    return item('warning', 'temp', 'Running hot', `SoC at ${m.tempC.toFixed(0)} °C`, m.at);
  }
  return null;
}

function ruleLoad(p: AttentionInput): AttentionItem | null {
  const m = p.metrics;
  if (!m) return null;
  const perCore = m.cores > 0 ? m.load1 / m.cores : 0;
  if (perCore >= 6) {
    return item('critical', 'load', 'Overloaded', `load ${m.load1.toFixed(1)} on ${m.cores} cores`, m.at);
  }
  if (perCore >= 3) {
    return item('warning', 'load', 'Under load', `load ${m.load1.toFixed(1)} on ${m.cores} cores`, m.at);
  }
  return null;
}

function rulePackages(p: AttentionInput): AttentionItem | null {
  if (p.pkgs.security > 0) {
    return item('warning', 'security-updates', 'Security updates pending',
      `${p.pkgs.security} security update(s) of ${p.pkgs.total} pending`);
  }
  if (p.pkgs.total > 0) {
    return item('info', 'updates', 'Updates available', `${p.pkgs.total} package update(s) pending`);
  }
  return null;
}

function ruleOom(p: AttentionInput): AttentionItem | null {
  const n = p.journal.oomCount ?? 0;
  if (n > 0) {
    return item('warning', 'oom', 'OOM kills in last hour', `${n} OOM kill event(s)`);
  }
  return null;
}

function ruleJournalErrors(p: AttentionInput): AttentionItem | null {
  const n = p.journal.errorCount ?? 0;
  if (n >= 20) {
    return item('warning', 'journal-errors', 'Journal error flood', `${n} error-level lines in the last hour`);
  }
  return null;
}

const RULES: Array<(p: AttentionInput) => AttentionItem | null> = [
  ruleUnreachable,
  ruleUnstable,
  ruleStale,
  ruleDisk,
  ruleMemory,
  ruleTemp,
  ruleLoad,
  rulePackages,
  ruleOom,
  ruleJournalErrors,
];

/**
 * All attention items for a Pi, sorted by severity name ascending
 * (critical < info < warning) then rule. The UI groups items into
 * severity sections for display; Pi ranking uses scoreItems().
 */
export function evaluateAttention(p: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const rule of RULES) {
    const it = rule(p);
    if (it) items.push(it);
  }
  items.sort((a, b) => a.severity.localeCompare(b.severity) || a.rule.localeCompare(b.rule));
  return items;
}

/** Sum of severity weights — the number the UI ranks Pis by. */
export function scoreItems(items: Array<Pick<AttentionItem, 'severity'>>): number {
  return items.reduce((s, i) => s + WEIGHTS[i.severity], 0);
}
